import { escapeHtml } from './util.js';

export async function sendVerificationEmail(env, to, link) {
  if (!env.RESEND_API_KEY) {
    if (env.MAIL_DEBUG === '1') {
      console.log(`[mail-debug] verification link for ${to}: ${link}`);
      return;
    }
    throw new Error('RESEND_API_KEY is not configured');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject: 'Confirm your access to Liz Mathew\u2019s site',
      text: `Confirm your access by opening this link (valid for 30 minutes):\n\n${link}\n\nIf you did not request this, ignore this email.`,
      html: `<p>Confirm your access to Liz Mathew\u2019s site (link valid for 30 minutes):</p>
<p><a href="${escapeHtml(link)}">Confirm access</a></p>
<p>If you did not request this, you can ignore this email.</p>`,
    }),
  });

  if (!res.ok) throw new Error(`Resend responded with ${res.status}`);
}
