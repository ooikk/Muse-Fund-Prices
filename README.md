# Unit Trust Fund Tracker

A small website that displays unit trust funds with their latest price,
currency, price date and source link — the same 17 DollarDex funds that were
previously tracked in the "Muse unit trust price update" Google Sheet.

**Live site: https://muse-fund-prices.vercel.app/**

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
and Refresh on [the live site](https://muse-fund-prices.vercel.app/) is confirmed
working. Use the live site, not the `*.github.io` one, for anything that needs
Refresh.

### Option B — Vercel CLI

```bash
npm install -g vercel
cd unit-trust-tracker
vercel
```

Follow the prompts (accept the defaults). `vercel --prod` deploys to production.

## How GitHub and Vercel share files

GitHub stores the files; Vercel serves them. They are two separate
jobs, and that is why the files cannot be found inside Vercel.

**The flow, one way only (GitHub → Vercel):**

1. A change is pushed to GitHub — for example a commit changing
   `api/refresh.js` in `ooikk/Muse-Fund-Prices`.
2. GitHub tells Vercel that the `main` branch changed.
3. Vercel downloads that exact commit from GitHub and puts it live.
   This project has no build step, so the files are served as-is:
   `index.html`, `app.js` and `styles.css` as the website, and
   `api/refresh.js` as a serverless function at `/api/refresh`.
4. The live site updates, usually within about a minute.

Nothing flows back the other way. Changing a setting in Vercel never
edits a file on GitHub, and Vercel has no file editor for the
repository's files — a file must be edited on GitHub (or locally and
then pushed to GitHub) for Vercel to pick it up.

**Where to find things:**

- **The files themselves: GitHub, not Vercel.** The repository at
  github.com/ooikk/Muse-Fund-Prices is the only place the files live
  (`index.html`, `app.js`, `api/refresh.js`, `lib/parsers/`, `gas/`).
- **In Vercel, what you can find:** open vercel.com, go to the project
  `muse-fund-prices`, then:
  - **Deployments** — a list of every deploy, each labelled with the
    GitHub commit message and short SHA (for example `a57103c`,
    `d0938c7`), branch, time and status. Click one to see its URL and
    build logs. This is how you check that Vercel is running the
    latest GitHub commit — match the SHA shown there to the latest
    commit on GitHub.
  - **Settings → Git** — shows the connected repository
    (`ooikk/Muse-Fund-Prices`), the production branch (`main`), and
    that auto-deploy on push is on.
  - **Settings → Domains** — where `muse-fund-prices.vercel.app`
    is listed.

**Two things that trip people up:**

- Deleting the Vercel project would not delete the GitHub repository,
  and deleting the GitHub repository would not delete the last Vercel
  deployment — they are linked, but separate.
- A push to a different branch (or a pull request) creates a preview
  deployment with its own URL; only pushes to `main` update the
  production site.

Rule of thumb: to see or change a file, go to GitHub. To check
whether the live site has the latest version, go to Vercel →
Deployments and match the commit SHA to GitHub.

## What is Vercel for?

Vercel's main purpose is to take website code and put it live on the
internet, without anyone having to manage a server. You push code to
GitHub, Vercel turns it into a working website that anyone can open
in a browser. That is its core job; everything else is built around
it.

Its main functions:

- **Hosting** — it serves the website files (HTML, CSS, JavaScript,
  images) from servers around the world, so the site loads fast
  wherever the visitor is. That is what it does here with
  `index.html`, `app.js` and `styles.css`.
- **Automatic deploys from Git** — every push to GitHub redeploys the
  site automatically. A push to another branch (or a pull request)
  makes a separate preview link, so a change can be tested before it
  goes live.
- **Serverless functions** — small bits of backend code that run only
  when called, with no server to look after. That is what
  `api/refresh.js` is: it does not run all the time, it only runs when
  someone clicks Refresh, fetches the DollarDex page, and returns the
  price.
- **Domains and HTTPS** — it gives the site a `*.vercel.app` address,
  handles the security certificate, and can connect a custom domain.
- **Previews and rollbacks** — every deploy is kept, so if a new
  version breaks something the previous one can be restored in a
  couple of clicks.

What it is *not*: it is not a file store like GitHub or Google Drive,
and it is not a database. It does not keep the files for editing, and
it does not remember anything between visits — that is why the fund
list lives in the browser's localStorage and the prices live in the
Google Sheet, not on Vercel.

In one line: GitHub is where the code lives, Vercel is what puts it
on the web.

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
  hand from the source page. Since 18 Nov 2026 the headers include the
  `Sec-Fetch-*` navigation headers a real browser sends (`Sec-Fetch-Dest:
  document`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Site: same-origin`,
  `Sec-Fetch-User: ?1`) — those were the deciding headers: without them
  DollarDex (Akamai Bot Manager) returned 403 even with a browser
  User-Agent, with them it returned 200. Verified live on Vercel the
  same day: Refresh all returned 17 updated, 0 blocked, 0 failed.

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
  localStorage (or in the shared Redis list, if one is active — see
  "Shared fund lists" below), not in a scheduled server job, so there is
  nothing for a background job to update. If the page is not open at the chosen time, that day's run
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

## Shared fund lists (Upstash Redis)

By default the fund list lives only in one browser's localStorage. "Create
my list" (in the "Shared list" card) turns it into a shared list that
loads on any device:

- Clicking it stores the current list — for a fresh browser that is the
  17 seed funds — in Upstash Redis under a fresh random 16-character
  code (lowercase letters and digits), and shows a personal link of the
  form `https://muse-fund-prices.vercel.app/?u=<code>`.
- Opening that link on any device loads the same list. The browser
  remembers the code, so the link is only needed the first time; the
  "Open a list by code" box does the same thing from a typed code.
  "Use this browser only" stops this browser using the shared list (the
  Redis copy stays saved under its code).
- Every change (add, delete, refresh, edit, import, reset) saves to
  Redis a moment later (debounced) and to this browser immediately.
  If Redis cannot be reached, the change is still saved locally and the
  page says so — a failed shared save never loses local data.
- The Compare page's fund list is shared under the same code (a second
  key, `compare:<code>`). "Create my list" snapshots this browser's
  compare list along with the main list; the first device to open the
  Compare page with a code that has no shared compare list yet uploads
  its own list once, so it becomes the shared one. The same rules apply:
  the link is the key, and last write wins.

Stated plainly:

- The link is the key: anyone with the link or the code can open and
  edit the list. There is no password. Keep it private.
- Lose the link and the list is lost, unless a browser still remembers
  the code.
- Two devices editing at once: last write wins. There is no merging.
- The Compare page list is shared under the same code too; localStorage
  stays its local copy, as with the main list.

Deleting a shared list: there is no delete button on the site — delete
the keys from the Upstash console. Vercel dashboard → Storage →
`upstash-kv-cerulean-blanket` → REPL, then run:

- `DEL funds:<code>`
- `DEL compare:<code>` (only if the list has a Compare list)

Each answers `1` when the key existed. Two gotchas: the data browser
has no per-key delete button in this UI, and the REPL's **Safe Mode**
toggle (top right, on by default) blocks all write commands — `DEL` is
refused with `NOPERM` while it is on, so switch it off first; it turns
itself back on each time the REPL is opened. Deleting the keys removes
the shared copy only: each browser keeps its own local copy, and a
browser that still remembers the code will share its list again on the
next change (the Compare page re-uploads its local list on its next
visit) — so on every device that used the list, click "Use this browser
only" on the main page to unlink it.

Setup: the Redis database is `upstash-kv-cerulean-blanket` (Singapore
region, Free plan: 500,000 commands/month, 250 MB storage, 1 database
per account), created through Vercel Storage → Upstash. The integration
sets these env vars on the project (Production and Preview):

- `UPSTASH_REDIS_KV_REST_API_URL`
- `UPSTASH_REDIS_KV_REST_API_TOKEN`

The serverless functions (`api/lists.js`, `api/generate.js`, via
`lib/upstash.js`) read those names, falling back to
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` if the `_KV_`
names are absent. The token never reaches the browser — only the
serverless functions read it. If Redis is not configured, the page shows
a plain error and behaves exactly as before (local list only).

## Supported sites

`/api/refresh` picks a parser by the link's domain, so the same endpoint
works for any of these sites. A link from any other site returns
`{ error: 'No parser registered...' }` with this list.

| Site | Domain | How the price is read | Example link |
| --- | --- | --- | --- |
| DollarDex | `dollardex.com` | Page HTML. Needs Sec-Fetch navigation headers to get past Akamai Bot Manager (a plain fetch gets HTTP 403) — see "DollarDex bot detection" below. Prices are indicative and usually lag 2–4 dealing days. | A DollarDex fund overview link, e.g. the Allianz Europe Equity Growth link in the seed data |
| Fidelity | `fidelity.co.uk` | Page HTML from the fund's factsheet page — the short form `/factsheet-data/factsheet/<ISIN>` works, no fund-name slug or `/portfolio` suffix needed (see "Finding a Fidelity fund's link" below). | https://www.fidelity.co.uk/factsheet-data/factsheet/LU0099574567-global-technology-fund/portfolio |
| Fundsupermart (FSM Global) | `fsm.global` | The site's own REST API, not the page: the factsheet page is a JavaScript app whose HTML has no fund data, so the parser calls `get-factsheet-price-date-data` for the price and `get-active-fund-info` for the name and currency, using the fund code from the link (`/sg/funds/factsheet/<CODE>/...`). No login or key needed. Caveat: this is FSM's undocumented internal API, so it could change or gain login requirements without notice; if it does, the parser returns no price rather than a guess. | https://fsm.global/sg/funds/factsheet/FITECH/Fidelity-Global-Technology-A-EUR |
| Singlife (FE fundinfo) | `digital.feprecisionplus.com` | The site's own data service, not the page: the factsheet page is a JavaScript app whose HTML has no fund data, so the parser calls the FE fundinfo FundDataService `GetUnitList` endpoint for the price, name and currency, using the fund code from the link's `TypeCode` parameter (`?TypeCode=FSG:<CODE>`). No login or key needed. Caveat: this is FE fundinfo's internal data service for Singlife, so it could change without notice; if it does, the parser returns no price rather than a guess. | https://digital.feprecisionplus.com/singlifesimnav2/factsheethtml/en-gb/singlife/?TypeCode=FSG:Z867&specialunittype=CHDG&MPCategoryCode=&Category=&priipproductcode=&documentcountry=&Category2=public |
| FundSingapore | `fundsingapore.com` | Page data: the detail page is a Next.js page with the fund data server-rendered inside `__NEXT_DATA__` (`ssrFundDetails.LastPrice` gives the price, currency and date; `Name` and `Isin` confirm the fund). No login or key needed. The site is a joint initiative of IMAS and LIA. | https://www.fundsingapore.com/fund-library/fund-details?id=F0HKG06XT2 |
| Janus Henderson | `janushenderson.com` | Page HTML: the fund's NAV is server-rendered on the product page (the "NAV" label followed by `<strong>` with `<CURRENCY> <price>`, plus an "As of YYYY/MM/DD" date). Each share class is its own page keyed by ISIN in the `?identifier=` parameter; the selected share class comes from the page's share-class selector. No login or key needed. | https://www.janushenderson.com/en-sg/investor/product/janus-henderson-horizon-global-technology-leaders-fund/?identifier=LU1316542783 |
| Allianz GI | `sg.allianzgi.com` | Page HTML: the fund's Unit NAV is server-rendered (visible text "Unit NAV `<price>` `<CURRENCY>`" plus "Valuation Date: DD/MM/YYYY", also in the page's JSON-LD). Quirk: the site 302-redirects on the first request and only serves the page when the request carries the cookies the site itself set on the redirect responses, so the parser follows redirects manually with a cookie jar (the site's own session cookies, no login or key). No JavaScript needed. | https://sg.allianzgi.com/en-sg/retail/products-solutions/authorised-fund/allianz-global-high-payout-fund-class-am-sgd-dis?nav=overview |

### Compare funds (`compare.html`)

The **Compare funds** button on the main page opens a chart that plots several funds' performance over a period (1M, 3M, 6M, 1Y, 3Y, 5Y, YTD), each line rebased to 100 at the start of the period. History comes from FundSingapore's own timeseries API through the same-origin `/api/timeseries` proxy (`api/timeseries.js`) — a plain GET, no login or key. Add funds by FundSingapore fund ID, several at once separated by commas, or paste a FundSingapore fund link and the ID is taken from it; each listed fund has a Remove button, and the list is kept in this browser's localStorage. Two things to know: each fund's line is in its own currency (no currency conversion), and a fund FundSingapore has stopped updating has no history — Janus (F00000WJQK) currently returns an empty series and shows as "No data". FundSingapore's API is undocumented, so it could change without notice; if it does, the page shows an error instead of a wrong chart.

Tuning the Compare page (edit, push to `main`, Vercel redeploys in about a minute):

- **Maximum number of funds:** `api/timeseries.js`, `MAX_IDS` (currently 20). The page itself has no limit — the chart colours just cycle past 10 funds.
- **Timeouts:** `api/timeseries.js`, `AbortSignal.timeout(25000)` — 25 seconds for the server's fetch from FundSingapore; and `compare.js`, the 30-second `setTimeout` that aborts a hung request in the browser. The server timeout must stay below the browser one, or the page gives up before the server answers — raise both together if needed. A 5-fund cold-start call took ~11 seconds and an 11-fund cold-start call 18 seconds, so a much higher fund limit will likely need longer timeouts too. The page retries a failed series load automatically (up to 3 attempts) before showing an error.

### Finding a Fidelity fund's link

To track a Fidelity fund, find its ISIN on the Fidelity Singapore fund
list (`https://www.fidelity.com.sg/funds/mutual-fund/`), then use the UK
factsheet short link `https://www.fidelity.co.uk/factsheet-data/factsheet/<ISIN>`
— no fund-name slug or `/portfolio` suffix is needed, and the tracker
reads the short link the same way. Examples verified 25 Nov 2026: China
Focus Fund A-SGD (LU0287142896, 1.694 SGD, 24 Nov 2026) and China Focus
Fund SR-Acc-SGD (LU1235261390, 2.047 SGD, 24 Nov 2026).

Do not use Fidelity UK's fund-prices page (`fidelity.co.uk/fund-prices`)
to find a share class: it has no text search (only Fund type / Fund
provider dropdowns) and it lists only the share classes Fidelity UK
offers, so SGD classes do not appear there at all — the China Focus Fund
shows only A-GBP, A-USD, Y-ACC-Euro, Y-ACC-USD, Y-GBP and Y-USD. The
direct factsheet link above is the way to track an SGD class.

### Not supported: Morningstar

Morningstar (`global.morningstar.com`) was tried and removed. Its fund
pages answer every server fetch with an AWS WAF JavaScript challenge that
only a real browser can pass, so no server-side parser can read them. Use
the fund provider's own page instead — for the Fidelity Global Technology
fund, the Fidelity and Fundsupermart links above are the working backups.

### Not supported: Fidelity Singapore

`fidelity.com.sg` cannot be used as a source. Its fund pages sit behind
Akamai Bot Manager (a server fetch gets HTTP 403 even with the Sec-Fetch
headers that work for DollarDex), the price is JavaScript-rendered behind
a Personal Investors role gate, and no JSON API endpoint was found — the
`?role=private` parameter and the Fidelity Hong Kong site (`fidelity.com.hk`)
do not get around it either. Use the UK factsheet link above instead:
the same fund's price is published there (e.g. Global Technology A-EUR
€90.83, 24 Nov 2026, matching the SG page). The SG site is still useful
for finding a fund's ISIN — see "Finding a Fidelity fund's link" above.

## Adding a new site parser (for GAS backup links)

`GET /api/refresh?url=...` no longer assumes DollarDex. It looks at the
URL's domain and picks a parser from `lib/parsers/index.js`. That is how
GAS backup links work: GAS sends any fund link (primary or backup) to the
same endpoint, Vercel picks the right parser, and GAS gets back the same
JSON shape either way.

To add a site (Morningstar or any other):

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

Currently registered parsers: DollarDex, Fidelity, Fundsupermart, Singlife, FundSingapore, Janus Henderson and Allianz GI —
see the Supported sites section above for how each one works. No
Morningstar parser is implemented yet — each new parser must be written
from a real page, not guessed.

## Seed data

The 17 seed funds, with prices and dates as of 28–29 Oct 2026, are in
`app.js` (`SEED_FUNDS`). They come from the Google Sheet
"Muse unit trust price update" (Sheet1). Refresh them after deploying;
prices are indicative and usually lag 2–4 dealing days on DollarDex.

## Local test

```bash
# Syntax-check the crawler and parsers:
node --check api/refresh.js
node --check api/lists.js
node --check api/generate.js
node --check lib/upstash.js
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
| `app.js` | Fund list, add/delete/refresh UI, localStorage, seed data, daily auto-refresh, shared lists (Upstash Redis) |
| `api/refresh.js` | Vercel serverless handler: fetch, bot-check, domain-routed parsing |
| `api/lists.js` | Vercel serverless handler: load/save a shared fund list in Upstash Redis by code |
| `api/generate.js` | Vercel serverless handler: create a shared fund list under a fresh random code |
| `lib/upstash.js` | Shared Upstash REST client + code/funds validation for the list endpoints |
| `api/timeseries.js` | Vercel serverless handler: FundSingapore history proxy for the Compare page |
| `compare.html` | Compare page: fund list, period buttons, chart, returns table |
| `compare.js` | Compare page logic: fund list in localStorage, period ranges, canvas chart |
| `lib/parsers/index.js` | Parser registry — which parser handles which domain |
| `lib/parsers/dollardex.js` | DollarDex parser |
| `lib/parsers/fidelity.js` | Fidelity parser |
| `lib/parsers/fundsupermart.js` | Fundsupermart parser (API-based) |
| `lib/parsers/singlife.js` | Singlife parser (API-based) |
| `lib/parsers/fundsingapore.js` | FundSingapore parser (Next.js __NEXT_DATA__ LastPrice) |
| `lib/parsers/janushenderson.js` | Janus Henderson parser (server-rendered NAV) |
| `lib/parsers/allianzgi.js` | Allianz GI parser (server-rendered Unit NAV; cookie-aware redirects) |
| `lib/parsers/helpers.js` | Shared parser helpers (text, name, date, currency) |
| `lib/parsers/_template.js` | Copy-me template for a new site's parser (not registered) |
| `gas/refresh-from-vercel.gs` | Example GAS script: daily Sheet refresh via Vercel, primary then backup |
| `gas/vercel-fund-prices.gs` | GAS script for the "VercelFundPrices" tab: refresh fund prices from the URLs in column A via Vercel |
| `vercel.json` | Vercel configuration (no build step needed) |
