// Manage access tokens through the gate's admin API.
//   SITE_URL=https://lizmathew.com ADMIN_KEY=... node scripts/token.mjs create "Acme Recruiting"
//   node scripts/token.mjs list | reset <id> | revoke <id> | users | remove-user <email>
const [command, arg] = process.argv.slice(2);
const site = (process.env.SITE_URL || 'http://localhost:8788').replace(/\/$/, '');
const key = process.env.ADMIN_KEY;

if (!key) {
  console.error('Set ADMIN_KEY (and SITE_URL) before running this command.');
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${site}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Request failed (${res.status}): ${text}`);
    process.exit(1);
  }
  return JSON.parse(text);
}

const actions = {
  create: () => (arg ? call('POST', '/admin/tokens', { label: arg }) : Promise.reject(new Error('Usage: create "<label>"'))),
  list: () => call('GET', '/admin/tokens'),
  reset: () => call('POST', `/admin/tokens/${arg}/reset`),
  revoke: () => call('DELETE', `/admin/tokens/${arg}`),
  users: () => call('GET', '/admin/users'),
  'remove-user': () => call('DELETE', `/admin/users/${encodeURIComponent(arg || '')}`),
};

if (!actions[command]) {
  console.error('Commands: create "<label>" | list | reset <id> | revoke <id> | users | remove-user <email>');
  process.exit(1);
}

try {
  console.log(JSON.stringify(await actions[command](), null, 2));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
