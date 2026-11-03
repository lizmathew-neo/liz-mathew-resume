import { escapeHtml } from './util.js';

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: #0b1220; color: #e6edf6; font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif; }
  main { width: 100%; max-width: 460px; background: #101c33; border: 1px solid rgba(255,255,255,.08);
    border-left: 3px solid #d4a017; border-radius: 14px; padding: 28px; }
  h1 { margin: 0 0 12px; font-size: 1.35rem; }
  p { color: #9fb0c8; line-height: 1.55; }
  label { display: block; margin: 18px 0 6px; font-size: .9rem; }
  input[type=email] { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.18);
    background: #0b1220; color: #e6edf6; font-size: 1rem; }
  button { margin-top: 16px; width: 100%; padding: 12px; border: 0; border-radius: 10px; background: #d4a017;
    color: #0b1220; font-weight: 700; font-size: 1rem; cursor: pointer; }
`;

export function page(title, bodyHtml, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${bodyHtml}</main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}

export const restrictedPage = () =>
  page(
    'Access restricted',
    `<h1>Access restricted</h1>
     <p>This site is available by invitation. Please open the personal link you were given.</p>`,
    403
  );

export const notConfiguredPage = () =>
  page('Unavailable', `<h1>Temporarily unavailable</h1><p>Please try again later.</p>`, 503);

export const requestAccessPage = (token, max, notice = '') =>
  page(
    'Request access',
    `<h1>Request access</h1>
     <p>This link has reached its limit of ${max} visits. Enter your email address and we will send you a
     confirmation link that registers you for continued access.</p>
     ${notice ? `<p><strong>${escapeHtml(notice)}</strong></p>` : ''}
     <form method="post" action="/request-access">
       <input type="hidden" name="t" value="${escapeHtml(token)}">
       <label for="email">Email address</label>
       <input id="email" name="email" type="email" required autocomplete="email" maxlength="254">
       <button type="submit">Email me a confirmation link</button>
     </form>`,
    403
  );

export const checkInboxPage = () =>
  page(
    'Check your email',
    `<h1>Check your email</h1>
     <p>If that address is valid, a confirmation link is on its way. It expires in 30 minutes.</p>`
  );

export const confirmPage = (verifyId) =>
  page(
    'Confirm access',
    `<h1>Confirm your access</h1>
     <p>Click below to complete your registration.</p>
     <form method="post" action="/verify">
       <input type="hidden" name="v" value="${escapeHtml(verifyId)}">
       <button type="submit">Confirm and continue</button>
     </form>`
  );

export const invalidLinkPage = () =>
  page('Link expired', `<h1>Link expired</h1><p>This confirmation link is invalid or has expired.</p>`, 400);
