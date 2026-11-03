const encoder = new TextEncoder();

export function toBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function randomId(bytes = 18) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function hmacKey(secret, usages) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

export async function signPayload(payload, secret) {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

// Returns the payload only if the signature is valid and it has not expired.
export async function verifyPayload(value, secret) {
  if (!value || typeof value !== 'string') return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret, ['verify']),
      fromBase64Url(sig),
      encoder.encode(body)
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function safeEqual(a, b) {
  const key = await hmacKey('compare', ['sign']);
  const [x, y] = await Promise.all([
    crypto.subtle.sign('HMAC', key, encoder.encode(a)),
    crypto.subtle.sign('HMAC', key, encoder.encode(b)),
  ]);
  const xa = new Uint8Array(x);
  const ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function cookie(name, value, { maxAgeSeconds, secure }) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
