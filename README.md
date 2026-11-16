# Liz Mathew — Resume Website

Personal research and portfolio site for Liz Mathew, Technical Architect transitioning to AI research.

Live site: https://lizmathew.com/

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

Deployed via GitHub Pages from the `main` branch (root). Any push to `main` updates the live site automatically.

The custom domain is configured with GitHub Pages HTTPS enforcement enabled. Keep the
`CNAME` file in the repository so GitHub can issue and renew the certificate for
`lizmathew.com`. The page also includes a restrictive Content Security Policy and
referrer policy in [`index.html`](./index.html); if an external integration is added,
update that policy deliberately rather than allowing all sources.

## Contact

- Email: lizlizamathew@gmail.com
- LinkedIn: https://www.linkedin.com/in/liz-mathew04
