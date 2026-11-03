# Liz Mathew — Resume Website

Personal resume/portfolio site for Liz Mathew, targeting Senior Delivery Manager roles.

Live site: _added after first deploy_

## Stack

Plain HTML, CSS and JavaScript — no build step required.

```
.
├── index.html
├── css/styles.css
├── js/script.js
└── assets/Liz-Mathew-Resume.pdf
```

## Run locally

Open `index.html` directly in a browser, or serve it:

```powershell
python -m http.server 8080
```

Then visit http://localhost:8080

## Deployment

Currently deployed via GitHub Pages from the `main` branch (root). Any push to `main` updates the live site.

## Private access (invite links) on Cloudflare Pages

The `gate/` and `functions/` folders add an access gate for the site when it is hosted on Cloudflare Pages
(GitHub Pages ignores them). Don't switch DNS to Cloudflare until the setup below is done.

How it works:

- You create a unique link per person or organization: `https://lizmathew.com/?t=<token>`.
- Each time the link is opened it counts as one visit (re-opening it within the same 60-minute visit does not count again; link-preview bots are ignored). A link works for **8 visits** (`MAX_VISITS`).
- On the next attempt the visitor is asked for an email address. A confirmation link is emailed through Resend; confirming it registers the email and keeps access for 90 days (`SESSION_DAYS`) on that browser.
- Only holders of a used-up invite link can register. Everyone else sees "Access restricted".

### One-time setup

1. **Cloudflare:** create a free account, then Workers & Pages > Create > Pages > connect this GitHub repo. Build command `npm run build`, output directory `dist`.
2. **KV:** Storage & Databases > KV > create a namespace (e.g. `liz-access`). In the Pages project: Settings > Bindings > add a KV namespace binding named `ACCESS`.
3. **Resend:** create an account at resend.com, add and verify the domain `lizmathew.com` (Resend shows DNS records; add them in Cloudflare DNS), then create an API key (sending access only).
4. **Variables and secrets** (Pages project > Settings > Variables and Secrets, Production):

   | Name | Type | Value |
   |---|---|---|
   | `SESSION_SECRET` | Secret | long random string (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
   | `ADMIN_KEY` | Secret | another long random string, used to create tokens |
   | `RESEND_API_KEY` | Secret | the Resend API key |
   | `MAIL_FROM` | Text | e.g. `Liz Mathew <access@lizmathew.com>` |
   | `MAX_VISITS`, `VISIT_MINUTES`, `SESSION_DAYS` | Text, optional | defaults `8`, `60`, `90` |

5. **Domain:** add `lizmathew.com` as a custom domain on the Pages project, then deploy. Also set `ADMIN_KEY`/secrets before the first deploy; with no `SESSION_SECRET` or `ACCESS` binding the site refuses to serve anything.

### Managing links

```powershell
$env:SITE_URL = "https://lizmathew.com"; $env:ADMIN_KEY = "<your admin key>"
npm run token -- create "Acme Recruiting"   # prints the unique link to send
npm run token -- list                       # visits used per link
npm run token -- reset <id>                 # give a link 8 fresh visits
npm run token -- revoke <id>                # disable a link
npm run token -- users                      # registered visitors
npm run token -- remove-user <email>        # revoke a registered visitor
```

### Local development

```powershell
npm install
npm test        # unit tests for the gate
npm run dev     # http://127.0.0.1:8788 with a local KV store
```

Create a `.dev.vars` file (gitignored) with `SESSION_SECRET=...`, `ADMIN_KEY=...` and `MAIL_DEBUG=1`; with `MAIL_DEBUG=1` and no Resend key, confirmation links are printed to the terminal instead of emailed.

Note: KV is eventually consistent, so two simultaneous opens of a link could occasionally count as one.

## Contact

- Email: lizlizamathew@gmail.com
- LinkedIn: https://www.linkedin.com/in/liz-mathew04
