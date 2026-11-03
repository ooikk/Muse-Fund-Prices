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

## Daily auto-refresh

Manual refresh is unchanged: "Refresh all" refreshes every fund, and each
row's "Refresh" refreshes just that one fund. In addition, ticking
"Auto-refresh daily while this page is open" and picking a time (default
09:00, browser local time) adds one automatic "Refresh all" per day at
that time. The checkbox and time are saved in the browser, so they
survive a reload on the same device, and the page shows the next
scheduled refresh.

Limitations, stated plainly:

- It only runs while the page is open in a tab. Closing the tab, the
  browser, or the device stops it — the fund list lives in the browser's
  localStorage, not on a server, so there is nothing for a background job
  to update. If the page is not open at the chosen time, that day's run
  is skipped and the next run is the following day.
- Blocked funds (DollarDex bot detection) keep their last price on each
  auto-refresh, exactly as a manual refresh does; they are not silently
  replaced with a guessed price.
- Each auto-refresh calls the crawler once per fund, with the same
  ~1.2-second gap between funds, so a 17-fund refresh takes about 20
  seconds of crawling.

For a true background refresh (prices updated daily even with the page
closed), the site would need server-side storage — for example Vercel KV
or Upstash Redis to hold the fund list, plus a Vercel Cron job to refresh
it — and the page would read from that store instead of localStorage.
That is a bigger change with a hosted-service account to set up; say the
word if you want it, and it can be added on top of this version.

## Adding a new site parser (for GAS backup links)

`GET /api/refresh?url=...` no longer assumes DollarDex. It looks at the
URL's domain and picks a parser from `lib/parsers/index.js`. That is how
GAS backup links work: GAS sends any fund link (primary or backup) to the
same endpoint, Vercel picks the right parser, and GAS gets back the same
JSON shape either way.

To add a site (Fundsupermart, Morningstar, or any other):

1. Copy `lib/parsers/_template.js` to `lib/parsers/<site>.js` and fill in
   `id` and `domains`.
2. Open one real fund page from that site, View Source, and write regexes
   for the fund name and the price first — those are the only two fields
   that must be right. Use the shared helpers in `lib/parsers/helpers.js`
   (`toText`, `cleanName`, `findDate`, `findCurrency`) instead of
   re-implementing them.
3. Register the parser in `lib/parsers/index.js` (one import, one line in
   the `parsers` list). The `_template.js` file itself is never
   registered, so it does nothing until copied.
4. Deploy (push to GitHub → Vercel redeploys automatically), then test:
   `https://<your-site>.vercel.app/api/refresh?url=<encoded fund URL>`
5. Before trusting it as a backup in your sheet, verify the returned price
   against the page itself: same share class, same currency, and a price
   that matches within the site's own price-date lag. A price from the
   wrong share class looks plausible and is still wrong.

Rules for every parser: never return a guessed price (return `price: ''`
when unsure), always return price as a plain number string without commas
or currency symbols, and set `lowConfidence: true` for any fallback guess.
If no parser is registered for a domain, the endpoint returns
`{ error: 'No parser registered...' }` with the list of supported parsers
— GAS should treat that like a failed source and try the next link.

A ready-to-adapt GAS example lives in `gas/refresh-from-vercel.gs`: a
time trigger calls `refreshAllFunds()`, which tries each fund's primary
URL first and its backup URL only if Vercel answers blocked/error, and
never writes a blocked result over a good price.

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
