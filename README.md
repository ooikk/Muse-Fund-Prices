# Unit Trust Fund Tracker

A small website that displays unit trust funds with their latest price,
currency, price date and source link — the same 17 DollarDex funds that were
previously tracked in the "Muse unit trust price update" Google Sheet.

Users can:
- **Add** a fund by pasting its link (name and currency are optional on add;
  a refresh tries to read the name from the page).
- **Delete** any fund.
- **Refresh** one fund, or all funds in turn.
- **Edit a price manually** when a site blocks automated crawling.
- **Export / import** the fund list as JSON (the list lives in the browser's
  localStorage, so export is the backup when moving devices).

## Deploy (recommended: Vercel)

Vercel is the right host for this project because the price crawler runs as
a serverless function (`api/refresh.js`). Plain static hosting (GitHub Pages,
Netlify Drop without functions) will show the table and let you add/delete
and manually edit prices, but the Refresh button will fail — there is no
server to run the crawler.

### Option A — GitHub + Vercel (no terminal needed)

1. Create a new GitHub repository and upload this folder's files
   (`index.html`, `styles.css`, `app.js`, `api/refresh.js`, `vercel.json`).
2. Go to [vercel.com](https://vercel.com) → Add New → Project → Import the
   repository. Accept the defaults (no build command, no framework preset).
3. Click Deploy. Your site is live at the `*.vercel.app` address Vercel gives
   you. Every push to GitHub redeploys automatically.

### Option B — Vercel CLI

```bash
npm install -g vercel
cd unit-trust-tracker
vercel
```

Follow the prompts (accept the defaults). `vercel --prod` deploys to production.

## DollarDex bot detection — read this

DollarDex actively blocks automated requests. What we know from experience:

- A plain server fetch (curl, a simple scraper) gets **HTTP 403**.
- The same pages open fine in a real browser, and a browser-driven crawl on
  1 Nov 2026 read all 17 funds without sign-in.
- So the crawler in `api/refresh.js` sends real-browser headers and, if the
  site still returns 403/429 or a bot-check page, it reports **blocked**
  instead of inventing a price. The fund keeps its last price and the UI
  shows "Blocked — open link", with an "Edit price" button to enter the
  price by hand from the source page.

If blocking gets worse, the honest upgrades in order are:

1. **Manual entry** (already built in) — open the link, copy the price/date.
2. **A browser-based refresh**: run the crawl from your own browser
   (e.g. a small bookmarklet or a Playwright script on your computer), then
   import the resulting JSON. A server crawler cannot reliably beat a
   bot-detection system that fingerprints browsers, and trying to evade it
   with headless-browser tricks will keep breaking.
3. **A paid/proxied data source** for fund prices, if one becomes available
   for these funds.

Do not add credentials, session cookies or headless-browser evasion to this
project to get around the block — that would break the site's terms of use
and is fragile by design.

## Seed data

The 17 seed funds, with prices and dates as of 28–29 Oct 2026, are in
`app.js` (`SEED_FUNDS`). They come from the Google Sheet
"Muse unit trust price update" (Sheet1). Refresh them after deploying;
prices are indicative and usually lag 2–4 dealing days on DollarDex.

## Local test

```bash
# Syntax-check the crawler:
node --check api/refresh.js
# Serve the static files (refresh will 404 locally — that is expected,
# because /api/refresh only exists on Vercel):
python3 -m http.server 8000
# Open http://localhost:8000
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and add-fund form |
| `styles.css` | Styling |
| `app.js` | Fund list, add/delete/refresh UI, localStorage, seed data |
| `api/refresh.js` | Vercel serverless crawler + price/date parser |
| `vercel.json` | Vercel configuration (no build step needed) |
