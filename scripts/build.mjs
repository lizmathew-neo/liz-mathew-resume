import { cpSync, mkdirSync, rmSync } from 'node:fs';

// Only the public site is copied, so gate/, scripts/ and config files are never served.
const SITE = ['index.html', 'css', 'js', 'assets'];

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const entry of SITE) cpSync(entry, `dist/${entry}`, { recursive: true });
console.log(`Built dist/ with: ${SITE.join(', ')}`);
