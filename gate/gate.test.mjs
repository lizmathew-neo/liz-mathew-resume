import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequest } from './gate.js';

const ORIGIN = 'https://example.test';

function makeKv() {
  const store = new Map();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
    list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  };
}

function makeSite(extraEnv = {}) {
  const env = { ACCESS: makeKv(), SESSION_SECRET: 'test-secret', ADMIN_KEY: 'admin-key', MAIL_DEBUG: '1', ...extraEnv };
  const sent = [];
  const origLog = console.log;

  async function request(path, { method = 'GET', headers = {}, form, cookies = '' } = {}) {
    const init = { method, headers: { ...headers } };
    if (cookies) init.headers.Cookie = cookies;
    if (form) {
      init.body = new URLSearchParams(form);
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    console.log = (msg) => {
      const m = /verification link for (.+?): (\S+)/.exec(String(msg));
      if (m) sent.push({ to: m[1], link: m[2] });
    };
    try {
      return await onRequest({
        request: new Request(`${ORIGIN}${path}`, init),
        env,
        next: async () => new Response('SITE CONTENT', { status: 200 }),
      });
    } finally {
      console.log = origLog;
    }
  }

  const admin = (path, method = 'GET') =>
    request(path, { method, headers: { Authorization: 'Bearer admin-key', 'Content-Type': 'application/json' } });

  async function createToken(label = 'Acme') {
    const res = await onRequest({
      request: new Request(`${ORIGIN}/admin/tokens`, {
        method: 'POST',
        headers: { Authorization: 'Bearer admin-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      }),
      env,
      next: async () => new Response('x'),
    });
    return res.json();
  }

  return { env, sent, request, admin, createToken };
}

const cookieFrom = (res, name) => {
  const header = res.headers.get('Set-Cookie') || '';
  const m = new RegExp(`${name}=([^;]+)`).exec(header);
  return m ? `${name}=${m[1]}` : '';
};

test('blocks visitors without a token', async () => {
  const site = makeSite();
  const res = await site.request('/');
  assert.equal(res.status, 403);
  assert.ok(!(await res.text()).includes('SITE CONTENT'));
});

test('fails closed when not configured', async () => {
  const site = makeSite({ SESSION_SECRET: undefined });
  assert.equal((await site.request('/')).status, 503);
});

test('valid token grants a visit, counts once, and unlocks assets', async () => {
  const site = makeSite();
  const { id } = await site.createToken();
  const res = await site.request(`/?t=${id}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `${ORIGIN}/`);
  const visit = cookieFrom(res, 'visit');
  assert.ok(visit);

  const page = await site.request('/', { cookies: visit });
  assert.equal(await page.text(), 'SITE CONTENT');

  // Re-opening the same link inside the same visit does not burn another attempt.
  await site.request(`/?t=${id}`, { cookies: visit });
  const record = JSON.parse(site.env.ACCESS.store.get(`token:${id}`));
  assert.equal(record.uses, 1);
});

test('allows 8 visits then requires registration on the 9th', async () => {
  const site = makeSite();
  const { id } = await site.createToken();
  for (let i = 1; i <= 8; i++) {
    const res = await site.request(`/?t=${id}`);
    assert.equal(res.status, 302, `visit ${i} should succeed`);
  }
  const ninth = await site.request(`/?t=${id}`);
  assert.equal(ninth.status, 403);
  const html = await ninth.text();
  assert.match(html, /request-access/);
  assert.ok(!html.includes('SITE CONTENT'));
});

test('invalid tokens and link-preview bots are rejected without counting', async () => {
  const site = makeSite();
  const { id } = await site.createToken();
  assert.equal((await site.request('/?t=not-a-real-token-value')).status, 403);
  const bot = await site.request(`/?t=${id}`, { headers: { 'User-Agent': 'Slackbot-LinkExpanding 1.0' } });
  assert.equal(bot.status, 403);
  assert.equal(JSON.parse(site.env.ACCESS.store.get(`token:${id}`)).uses, 0);
});

test('registration is refused until a token is exhausted', async () => {
  const site = makeSite();
  const { id } = await site.createToken();
  const res = await site.request('/request-access', { method: 'POST', form: { t: id, email: 'a@b.com' } });
  assert.equal(res.status, 403);
  assert.equal(site.sent.length, 0);
});

test('exhausted token holder can register by email and then browse freely', async () => {
  const site = makeSite();
  const { id } = await site.createToken('Acme Recruiting');
  for (let i = 0; i < 8; i++) await site.request(`/?t=${id}`);

  const bad = await site.request('/request-access', { method: 'POST', form: { t: id, email: 'nope' } });
  assert.match(await bad.text(), /valid email/);

  const ok = await site.request('/request-access', { method: 'POST', form: { t: id, email: 'Person@Example.com' } });
  assert.equal(ok.status, 200);
  assert.equal(site.sent.length, 1);
  assert.equal(site.sent[0].to, 'person@example.com');

  const link = new URL(site.sent[0].link);
  const confirm = await site.request(link.pathname + link.search);
  assert.match(await confirm.text(), /Confirm and continue/);
  const v = link.searchParams.get('v');

  const done = await site.request('/verify', { method: 'POST', form: { v } });
  assert.equal(done.status, 303);
  const session = cookieFrom(done, 'session');
  assert.ok(session);

  assert.equal(await (await site.request('/', { cookies: session })).text(), 'SITE CONTENT');
  const user = JSON.parse(site.env.ACCESS.store.get('user:person@example.com'));
  assert.equal(user.label, 'Acme Recruiting');

  // The confirmation link is single use.
  assert.equal((await site.request('/verify', { method: 'POST', form: { v } })).status, 400);

  // Removing the user revokes the session.
  await site.admin('/admin/users/person%40example.com', 'DELETE');
  assert.equal((await site.request('/', { cookies: session })).status, 403);
});

test('tampered cookies are rejected', async () => {
  const site = makeSite();
  const { id } = await site.createToken();
  const visit = cookieFrom(await site.request(`/?t=${id}`), 'visit');
  const tampered = visit.slice(0, -2) + 'xx';
  assert.equal((await site.request('/', { cookies: tampered })).status, 403);
});

test('admin API requires the key and manages tokens', async () => {
  const site = makeSite();
  assert.equal((await site.request('/admin/tokens')).status, 404);
  const { id } = await site.createToken('Org A');
  const list = await (await site.admin('/admin/tokens')).json();
  assert.equal(list.tokens.length, 1);
  assert.equal(list.tokens[0].label, 'Org A');
  assert.equal(list.maxVisits, 8);

  await site.request(`/?t=${id}`);
  await site.admin(`/admin/tokens/${id}/reset`, 'POST');
  assert.equal(JSON.parse(site.env.ACCESS.store.get(`token:${id}`)).uses, 0);

  await site.admin(`/admin/tokens/${id}`, 'DELETE');
  assert.equal((await site.request(`/?t=${id}`)).status, 403);
});

test('limits verification emails per address', async () => {
  const site = makeSite();
  const { id } = await site.createToken();
  for (let i = 0; i < 8; i++) await site.request(`/?t=${id}`);
  for (let i = 0; i < 4; i++) {
    await site.request('/request-access', { method: 'POST', form: { t: id, email: 'spam@example.com' } });
  }
  assert.equal(site.sent.length, 3);
});
