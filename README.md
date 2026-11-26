# Argus website (`website` branch)

Static product page for [Argus](https://github.com/RohiRIK/argus), the self-hosted Microsoft 365 reporting app.
This orphan branch contains only the site, no application code.

- Plain HTML, CSS and a small JS file. No build step, no framework, no third-party requests.
- Deployed on Vercel from this branch. Security headers and caching live in `vercel.json`.
- Screenshots in `assets/` come from a local Argus v0.4.0 run with seed data (no tenant data).
- Fonts: Inter (SIL OFL 1.1, see `fonts/OFL-LICENSE.txt`), self-hosted.

## Preview locally

```bash
python3 -m http.server -b 127.0.0.1 -d . 8090
# open http://127.0.0.1:8090
```

## Regenerate the Open Graph image

`tools/og.html` is the source for `og.png` (1200x630). Render it with any headless Chromium at 1200x630, for example with Playwright (`tools/og.mjs <abs path to tools/>`).

## Editing rules

Every claim on the page must be traceable to the Argus repository (README, INSTALL, docs, source). No invented metrics, customers or testimonials.
