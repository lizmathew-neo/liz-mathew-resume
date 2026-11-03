import { cookie, normalizeEmail, parseCookies, randomId, safeEqual, signPayload, TOKEN_PATTERN, verifyPayload } from './util.js';
import { checkInboxPage, confirmPage, invalidLinkPage, notConfiguredPage, requestAccessPage, restrictedPage } from './pages.js';
import { sendVerificationEmail } from './mail.js';

const VERIFY_TTL_SECONDS = 30 * 60;
const PREVIEW_BOTS = /bot|crawl|spider|preview|slurp|facebookexternalhit|whatsapp|telegram|slack|discord|skype|linkedin/i;

function config(env) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  return {
    max: num(env.MAX_VISITS, 8),
    visitMs: num(env.VISIT_MINUTES, 60) * 60 * 1000,
    sessionMs: num(env.SESSION_DAYS, 90) * 24 * 60 * 60 * 1000,
  };
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const getJson = async (kv, key) => {
  const raw = await kv.get(key);
  return raw ? JSON.parse(raw) : null;
};

// Allows at most `limit` hits per window; used to stop email abuse.
async function withinRateLimit(kv, key, limit, ttlSeconds) {
  const count = Number(await kv.get(key)) || 0;
  if (count >= limit) return false;
  await kv.put(key, String(count + 1), { expirationTtl: ttlSeconds });
  return true;
}

async function passThrough(next) {
  const res = await next();
  const headers = new Headers(res.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Cache-Control', 'private, no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function handleVisitToken(request, env, url, cfg, tokenId, cookies) {
  const secure = url.protocol === 'https:';
  const record = TOKEN_PATTERN.test(tokenId) ? await getJson(env.ACCESS, `token:${tokenId}`) : null;
  if (!record) return restrictedPage();

  // Link previews and crawlers must not use up a visit.
  if (request.method !== 'GET' || PREVIEW_BOTS.test(request.headers.get('User-Agent') || '')) return restrictedPage();

  const cleanUrl = new URL(url);
  cleanUrl.searchParams.delete('t');

  const existing = await verifyPayload(cookies.visit, env.SESSION_SECRET);
  if (existing && existing.t === tokenId) {
    return new Response(null, { status: 302, headers: { Location: cleanUrl.toString() } });
  }

  if (record.uses >= cfg.max) return requestAccessPage(tokenId, cfg.max);

  record.uses += 1;
  record.lastUsedAt = new Date().toISOString();
  await env.ACCESS.put(`token:${tokenId}`, JSON.stringify(record));

  const visit = await signPayload({ t: tokenId, exp: Date.now() + cfg.visitMs }, env.SESSION_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      Location: cleanUrl.toString(),
      'Set-Cookie': cookie('visit', visit, { maxAgeSeconds: cfg.visitMs / 1000, secure }),
      'Cache-Control': 'no-store',
    },
  });
}

async function handleRequestAccess(request, env, url, cfg) {
  if (request.method !== 'POST') return restrictedPage();

  const form = await request.formData();
  const tokenId = String(form.get('t') || '');
  const email = normalizeEmail(form.get('email'));
  const record = TOKEN_PATTERN.test(tokenId) ? await getJson(env.ACCESS, `token:${tokenId}`) : null;

  // Only people holding an exhausted invitation link can register.
  if (!record || record.uses < cfg.max) return restrictedPage();
  if (!email) return requestAccessPage(tokenId, cfg.max, 'Please enter a valid email address.');

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed =
    (await withinRateLimit(env.ACCESS, `rl:email:${email}`, 3, 3600)) &&
    (await withinRateLimit(env.ACCESS, `rl:ip:${ip}`, 10, 3600));
  if (!allowed) return requestAccessPage(tokenId, cfg.max, 'Too many requests. Please try again later.');

  const verifyId = randomId(24);
  await env.ACCESS.put(`verify:${verifyId}`, JSON.stringify({ email, tokenId, label: record.label }), {
    expirationTtl: VERIFY_TTL_SECONDS,
  });

  try {
    await sendVerificationEmail(env, email, `${url.origin}/verify?v=${verifyId}`);
  } catch (err) {
    console.error('Failed to send verification email:', err.message);
    await env.ACCESS.delete(`verify:${verifyId}`);
    return requestAccessPage(tokenId, cfg.max, 'We could not send the email right now. Please try again later.');
  }
  return checkInboxPage();
}

async function handleVerify(request, env, url, cfg) {
  const secure = url.protocol === 'https:';
  let verifyId;
  if (request.method === 'POST') verifyId = String((await request.formData()).get('v') || '');
  else verifyId = url.searchParams.get('v') || '';

  const pending = TOKEN_PATTERN.test(verifyId) ? await getJson(env.ACCESS, `verify:${verifyId}`) : null;
  if (!pending) return invalidLinkPage();

  // A GET only shows a button so email scanners that pre-fetch links cannot consume the confirmation.
  if (request.method !== 'POST') return confirmPage(verifyId);

  await env.ACCESS.delete(`verify:${verifyId}`);
  const key = `user:${pending.email}`;
  const now = new Date().toISOString();
  const user = (await getJson(env.ACCESS, key)) || { registeredAt: now, tokenId: pending.tokenId, label: pending.label };
  user.lastLoginAt = now;
  await env.ACCESS.put(key, JSON.stringify(user));

  const session = await signPayload({ e: pending.email, exp: Date.now() + cfg.sessionMs }, env.SESSION_SECRET);
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/',
      'Set-Cookie': cookie('session', session, { maxAgeSeconds: cfg.sessionMs / 1000, secure }),
      'Cache-Control': 'no-store',
    },
  });
}

async function handleAdmin(request, env, url, cfg) {
  const notFound = new Response('Not found', { status: 404 });
  if (!env.ADMIN_KEY) return notFound;
  const auth = request.headers.get('Authorization') || '';
  if (!(await safeEqual(auth, `Bearer ${env.ADMIN_KEY}`))) return notFound;

  const parts = url.pathname.split('/').filter(Boolean); // ['admin', 'tokens', id?, 'reset'?]
  const [, resource, id, action] = parts;
  const kv = env.ACCESS;

  if (resource === 'tokens' && !id) {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const label = String(body.label || '').trim().slice(0, 120);
      if (!label) return json({ error: 'label is required' }, 400);
      const tokenId = randomId(18);
      await kv.put(`token:${tokenId}`, JSON.stringify({ label, uses: 0, createdAt: new Date().toISOString() }));
      return json({ id: tokenId, label, maxVisits: cfg.max, link: `${url.origin}/?t=${tokenId}` }, 201);
    }
    if (request.method === 'GET') {
      const { keys } = await kv.list({ prefix: 'token:' });
      const tokens = await Promise.all(
        keys.map(async ({ name }) => ({ id: name.slice(6), ...(await getJson(kv, name)) }))
      );
      return json({ maxVisits: cfg.max, tokens });
    }
  }

  if (resource === 'tokens' && id && TOKEN_PATTERN.test(id)) {
    if (request.method === 'DELETE' && !action) {
      await kv.delete(`token:${id}`);
      return json({ deleted: id });
    }
    if (request.method === 'POST' && action === 'reset') {
      const record = await getJson(kv, `token:${id}`);
      if (!record) return notFound;
      record.uses = 0;
      await kv.put(`token:${id}`, JSON.stringify(record));
      return json({ id, uses: 0 });
    }
  }

  if (resource === 'users') {
    if (request.method === 'GET' && !id) {
      const { keys } = await kv.list({ prefix: 'user:' });
      const users = await Promise.all(
        keys.map(async ({ name }) => ({ email: name.slice(5), ...(await getJson(kv, name)) }))
      );
      return json({ users });
    }
    if (request.method === 'DELETE' && id) {
      const email = normalizeEmail(decodeURIComponent(id));
      if (!email) return json({ error: 'invalid email' }, 400);
      await kv.delete(`user:${email}`);
      return json({ deleted: email });
    }
  }

  return notFound;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Fail closed: never serve the site if the gate is not fully configured.
  if (!env.ACCESS || !env.SESSION_SECRET) return notConfiguredPage();

  const cfg = config(env);

  if (url.pathname.startsWith('/admin/')) return handleAdmin(request, env, url, cfg);
  if (url.pathname === '/request-access') return handleRequestAccess(request, env, url, cfg);
  if (url.pathname === '/verify') return handleVerify(request, env, url, cfg);

  const cookies = parseCookies(request.headers.get('Cookie'));

  const session = await verifyPayload(cookies.session, env.SESSION_SECRET);
  if (session && (await env.ACCESS.get(`user:${session.e}`))) return passThrough(next);

  const tokenId = url.searchParams.get('t');
  if (tokenId) return handleVisitToken(request, env, url, cfg, tokenId, cookies);

  const visit = await verifyPayload(cookies.visit, env.SESSION_SECRET);
  if (visit) return passThrough(next);

  return restrictedPage();
}
