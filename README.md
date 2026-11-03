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

The same Vercel crawler that powers the website's Refresh button can also
be driven from Google Apps Script (GAS) to update a Google Sheet — see
"GAS + Vercel refresh (Option A)" below. That is the recommended way to
get a daily, hands-off price update.

## Deploy (recommended: Vercel)

Vercel is the right host for this project because the price crawler runs as
a serverless function (`api/refresh.js`). Plain static hosting (GitHub Pages,
Netlify Drop without functions) will show the table and let you add/delete
and manually edit prices, but the Refresh button will fail — there is no
server to run the crawler.

### Option A — GitHub + Vercel (no terminal needed)

1. Create a new GitHub repository and upload this folder's files
   (`index.html`, `styles.css`, `app.js`, `api/refresh.js`, `lib/`,
   `vercel.json`, and optionally `gas/`).
2. Go to [vercel.com](https://vercel.com) → Add New → Project → Import the
   repository. Accept the defaults (no build command, no framework preset).
3. Click Deploy. Your site is live at the `*.vercel.app` address Vercel gives
   you. Every push to GitHub redeploys automatically.

This project is already deployed this way (repo `ooikk/Muse-Fund-Prices`),
and Refresh on the Vercel address is confirmed working. Use the
`*.vercel.app` address, not the `*.github.io` one, for anything that needs
Refresh.

### Option B — Vercel CLI

```bash
npm install -g vercel
cd unit-trust-tracker
vercel
```

Follow the prompts (accept the defaults). `vercel --prod` deploys to production.

## How the crawler works

`GET /api/refresh?url=<fund page URL>` fetches ONE fund page and returns
the same JSON shape whatever site the link belongs to:

```json
{ "name": "...", "price": "16.576", "currency": "SGD", "date": "29-Oct-2026", "parser": "dollardex", "source": "<the URL>" }
```

When no price can be returned, it does not invent one. Instead it returns
one of these, and the caller must treat it as "keep the old price":

- `{ "blocked": true, ... }` — the site refused the automated request
  (bot detection / rate limit) or returned a bot-check page.
- `{ "error": "..." }` — no parser is registered for that site, the page
  was unreachable, or no price could be parsed from the page.

The domain of the URL picks the parser (see "Adding a new site parser"
below), so a caller never needs to know which site a link belongs to.

## GAS + Vercel refresh (Option A)

This is the simplest hands-off design, and the one currently chosen for
the long term:

```
GAS time trigger (once a day)
  → Vercel /api/refresh?url=<primary link>   (per fund, one at a time)
  → if blocked/error, Vercel /api/refresh?url=<backup link>
  → GAS writes price + date to the Google Sheet
```

- **GAS stays the orchestrator.** It owns the schedule, the fund list, and
  the Sheet. Vercel stays dumb: it crawls one URL and returns one JSON
  object. That keeps both halves simple and testable on their own.
- **Sheet layout (suggested).** One row per fund: fund name, primary URL
  (DollarDex), backup URL (a site you have verified — see below), price,
  price date, and a source/status column recording which source the price
  came from (primary, backup, or "blocked/failed — old price kept").
- **Backup links live in the sheet, not in code.** GAS sends whichever
  link it is trying to Vercel; Vercel detects the domain and uses the
  matching parser. Adding a backup for a fund is therefore just adding a
  URL to its row — no code change — as long as a parser for that site
  already exists (see "Adding a new site parser").
- **A ready-to-adapt GAS example** lives in `gas/refresh-from-vercel.gs`:
  `refreshAllFunds()` tries each fund's primary URL first and its backup
  URL only if Vercel answers blocked/error, and never writes a blocked
  result over a good price. Adapt the sheet name and column letters to
  your own sheet, set `VERCEL_BASE` to your deployment, and add a
  time-driven trigger for `refreshAllFunds()`.
- **Be gentle.** Call one fund at a time with a pause between calls
  (the example uses 2 seconds). Aggressive crawling gets rate-limited,
  and a 17-fund run still fits comfortably inside GAS's per-run time
  limit when done this way.
- **Long-term backup sources.** Fundsupermart, Morningstar, and similar
  sites can be added as backup sources over time. Each one needs its own
  parser, and each backup URL must be verified once before it is trusted:
  same share class, same currency, and a price that matches within the
  site's own price-date lag. A price from the wrong share class looks
  plausible and is still wrong.

### Limitations of Option A, stated plainly

- **Bot detection is the ceiling.** Moving the crawl from GAS to Vercel
  does not solve it — it only changes the IP address doing the crawling.
  GAS runs from Google datacenter IPs and Vercel functions from AWS
  datacenter IPs, and both are often flagged. If Vercel answers blocked
  for a fund on all its sources, the honest result is the old price with
  a blocked status, not a guessed price.
- **Vercel functions are stateless.** A function cannot store a price on
  Vercel for later — there is no persistent file to overwrite. That is
  why the price is written back to the Sheet by GAS, and why the website
  itself still keeps its fund list in the browser's localStorage.
- **Prices lag.** DollarDex prices are indicative and usually lag 2–4
  dealing days. A daily refresh is plenty; more frequent crawling only
  increases the chance of being rate-limited.
- **For a website that is current even when nobody opens it**, Option A
  is not enough — that would need server-side storage (for example
  Vercel KV / Upstash Redis to hold the fund list, plus a scheduled job
  to refresh it) and the page reading from that store instead of
  localStorage. That is a bigger change with a hosted-service account to
  set up, and it is deliberately not built here. The GitHub repository
  is also not a good price store: every update would be a git commit,
  with commit spam, merge conflicts, redeploy lag, and a write token to
  protect.

## DollarDex bot detection — read this

DollarDex actively blocks automated requests. What we know from experience:

- A plain server fetch (curl, a simple scraper) gets **HTTP 403**.
- The same pages open fine in a real browser, and a browser-driven crawl on
  1 Nov 2026 read all 17 funds without sign-in.
- So the crawler sends real-browser headers and, if the site still returns
  403/429 or a bot-check page, it reports **blocked** instead of inventing
  a price. The fund keeps its last price and the UI shows
  "Blocked — open link", with an "Edit price" button to enter the price by
  hand from the source page.

If blocking gets worse, the honest upgrades in order are:

1. **Manual entry** (already built in) — open the link, copy the price/date.
2. **A backup source** (see "GAS + Vercel refresh" and "Adding a new site
   parser") — try a different site for the same fund.
3. **A browser-based refresh**: run the crawl from your own browser
   (e.g. a small bookmarklet or a Playwright script on your computer), then
   import the resulting JSON. A server crawler cannot reliably beat a
   bot-detection system that fingerprints browsers, and trying to evade it
   with headless-browser tricks will keep breaking.
4. **A paid/proxied data source** for fund prices, if one becomes available
   for these funds.

Do not add credentials, session cookies or headless-browser evasion to this
project to get around the block — that would break the site's terms of use
and is fragile by design.

## Daily auto-refresh (website only)

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

This is not the same as the GAS daily refresh above: the website option
refreshes the copy in one browser, while GAS refreshes the shared Sheet.
Use GAS for the Sheet, and the website option only if you leave the page
open.

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

Currently registered parsers: DollarDex only. No Fundsupermart or
Morningstar parser is implemented yet — each one must be written from a
real page, not guessed.

## Seed data

The 17 seed funds, with prices and dates as of 28–29 Oct 2026, are in
`app.js` (`SEED_FUNDS`). They come from the Google Sheet
"Muse unit trust price update" (Sheet1). Refresh them after deploying;
prices are indicative and usually lag 2–4 dealing days on DollarDex.

## Local test

```bash
# Syntax-check the crawler and parsers:
node --check api/refresh.js
node --check lib/parsers/index.js
node --check lib/parsers/dollardex.js
node --check app.js
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
| `app.js` | Fund list, add/delete/refresh UI, localStorage, seed data, daily auto-refresh |
| `api/refresh.js` | Vercel serverless handler: fetch, bot-check, domain-routed parsing |
| `lib/parsers/index.js` | Parser registry — which parser handles which domain |
| `lib/parsers/dollardex.js` | DollarDex parser |
| `lib/parsers/helpers.js` | Shared parser helpers (text, name, date, currency) |
| `lib/parsers/_template.js` | Copy-me template for a new site's parser (not registered) |
| `gas/refresh-from-vercel.gs` | Example GAS script: daily Sheet refresh via Vercel, primary then backup |
| `vercel.json` | Vercel configuration (no build step needed) |
