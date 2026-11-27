// Fund comparison page — plots FundSingapore history for several funds,
// rebased to 100 at the start of the chosen period.
// The fund list lives in localStorage on this device. When the page is
// opened with a shared-list link (?u=<code>), the list is shared through
// Upstash Redis under that code — same scheme as the main tracker page —
// and localStorage stays the local copy. History is fetched live from
// FundSingapore through the same-origin /api/timeseries proxy each time
// the period changes or Refresh is pressed. Each series is in that fund's
// own currency — there is no currency conversion.
const STORAGE_KEY = 'unit-trust-compare-funds-v1';

// Shared lists (Upstash Redis), same scheme as the main tracker page: a
// list code is 16 lowercase letters/digits, remembered in localStorage
// under the same key the main page uses (unit-trust-list-code-v1). When a
// code is active, the compare list is shared under that code; localStorage
// stays the local copy and the fallback when Redis is unreachable — a
// failed shared save never loses local data.
const CODE_KEY = 'unit-trust-list-code-v1';
const CODE_RE = /^[a-z0-9]{16}$/;
let listCode = null;
let compareSaveTimer = null;
// Warnings that must survive the series load that follows them. The
// ?u= path sets its warning before fetchSeries runs, and fetchSeries
// would overwrite it with its own status — so the next fetchSeries
// captures it at the start and re-applies it once, at the end.
// (Captured at the start, so a later user action can never resurrect
// a stale warning.)
let pendingWarning = null;
// Set when a background shared-list load fails while a series load is in
// flight: the load's final status would overwrite the warning, so it is
// re-applied once — but only by the request that was in flight when the
// failure happened (a newer request clears it as stale).
let stickyListError = null; // { msg, controller }

function rememberedCode() {
  try {
    const code = localStorage.getItem(CODE_KEY);
    return code && CODE_RE.test(code) ? code : null;
  } catch (e) { return null; }
}

function rememberCode(code) {
  try { localStorage.setItem(CODE_KEY, code); } catch (e) { /* storage blocked */ }
}

// Pre-filled from the funds that already have FundSingapore rows in the
// "Muse unit trust price update" sheet. Janus has no history on
// FundSingapore (its price there is also stale since 29 Oct 2026), so it
// shows as "No data" — that is FundSingapore's data, not a page error.
const SEED_FUNDS = [
  { id: 'F0HKG06XT2', name: 'Allianz Global High Payout Fund AM SGD Dis' },
  { id: 'F0HKG062P2', name: 'Infinity US 500 Stock Index Fund' },
  { id: 'F0GBR04D20', name: 'Fidelity Global Technology Fund A-EUR' },
  { id: 'F0HKG062MZ', name: 'FSSA Dividend Advantage Fund' },
  { id: 'F00000WJQK', name: 'Janus Henderson Horizon Global Technology Leaders Fund A2 SGD' },
];

const PERIODS = {
  '1M': { months: 1 }, '3M': { months: 3 }, '6M': { months: 6 },
  '1Y': { years: 1 }, '3Y': { years: 3 }, '5Y': { years: 5 },
  'YTD': { ytd: true },
};

const COLORS = ['#0b5fff', '#067647', '#b54708', '#b42318', '#6941c6', '#175cd3', '#027a48', '#c01048', '#dc6803', '#363f72'];

let funds = load();
let period = '1Y';
let series = {}; // id -> [{ date, value }]
// Funds hidden from the chart, by fund id. Temporary and in-memory only:
// never written to localStorage, never sent to /api/lists. A fresh page
// load shows every fund again. The table row stays visible (dimmed) so
// the fund can be ticked back on.
const hiddenFunds = new Set();
// Latest price per fund, by fund id. Temporary and in-memory only, like
// hiddenFunds: NEVER written to localStorage or Redis, so save() can never
// persist a stale price. Prices come from /api/fund-name (FundSingapore's
// LastPrice) and are fetched on page load, when funds are added, and when
// Refresh is pressed — never on a period change, since the price does not
// depend on the period.
const fundPrices = new Map(); // id -> { price, currency, date }
const CURRENCY_PREFIX = { SGD: 'S$', USD: 'USD', EUR: '€', GBP: '£', HKD: 'HK$', AUD: 'A$', JPY: '¥' };
function formatPrice(info) {
  if (!info || typeof info.price !== 'number') return '—';
  const prefix = CURRENCY_PREFIX[info.currency] || info.currency || '';
  return prefix + String(info.price);
}
// { start, end } of the last loaded period, for the status line.
let lastRange = null;
// Identity token for the current fetchSeries call. A new fetchSeries
// replaces it, and every step of an older call bails out when it sees
// the token has changed — so a superseded request never touches the
// status line, the chart, or a retry.
let seriesController = null;
// The AbortController of the attempt currently in flight. It is
// per-attempt, not per-request: a timeout abort ends that attempt only,
// so the retry gets a fresh controller (an aborted controller stays
// aborted forever and would fail every retry at once).
let seriesAttemptController = null;
let loading = false;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(f => f && /^[A-Za-z0-9]+$/.test(f.id || ''));
    }
  } catch (e) { /* fall through to seed */ }
  return SEED_FUNDS.map(f => ({ ...f }));
}

function saveLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(funds)); } catch (e) { /* storage full/blocked */ }
}

// Every change writes the local copy immediately, and — when a shared
// list is active — writes through to Redis after a short pause (debounced,
// so quick successive edits make one write, not one per edit). A failed
// Redis write only shows a warning; the local copy is already saved.
function save() {
  saveLocal();
  if (listCode) scheduleCompareSave();
}

function scheduleCompareSave() {
  clearTimeout(compareSaveTimer);
  compareSaveTimer = setTimeout(saveCompareToRedis, 500);
}

async function saveCompareToRedis() {
  if (!listCode) return;
  try {
    const res = await fetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: listCode, kind: 'compare', funds }),
    });
    const data = await res.json();
    if (!data || data.error) throw new Error((data && data.error) || 'save failed');
  } catch (e) {
    setStatus("Couldn't save the compare list to the shared list — it is still saved in this browser.");
  }
}

// Loads the shared compare list for a code. Returns { funds }, or
// { error, notFound } when no shared list exists yet for the code, or
// { error } when the store could not be reached. Never throws.
async function loadSharedCompare(code) {
  try {
    const res = await fetch('/api/lists?u=' + encodeURIComponent(code) + '&kind=compare');
    const data = await res.json();
    if (data && Array.isArray(data.funds)) return { funds: data.funds };
    if (data && data.notFound) return { error: data.error || 'No saved list for that code.', notFound: true };
    return { error: (data && data.error) || 'Could not load the shared compare list.' };
  } catch (e) {
    return { error: 'Could not reach the shared-list store.' };
  }
}

// Use a remote compare list: normalise ids to uppercase, keep the local
// copy in step. Callers re-render and re-fetch afterwards.
function applyRemoteCompare(list) {
  funds = list.map(f => ({ id: String(f.id).toUpperCase(), name: typeof f.name === 'string' ? f.name : '' }));
  // A remote list replaces the local one, but hiding is this browser's
  // display choice: keep it for funds that are still listed, drop ids
  // that no longer exist.
  for (const id of [...hiddenFunds]) {
    if (!funds.some(f => f.id === id)) hiddenFunds.delete(id);
  }
  for (const id of [...fundPrices.keys()]) {
    if (!funds.some(f => f.id === id)) fundPrices.delete(id);
  }
  saveLocal();
}

// First device to open the Compare page with a code that has no shared
// compare list yet uploads its local list once, so it becomes the shared
// one. A failed upload only warns inside saveCompareToRedis.
function migrateLocalCompare() {
  if (funds.length) saveCompareToRedis();
}

function setStatus(msg) { document.getElementById('status').textContent = msg || ''; }

function esc(s) {
  return String(s ?? '').replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function label(f) { return f.name || f.id; }

// --- add funds -----------------------------------------------------------

// Split the input into tokens, pull a fund ID out of each one. A token may
// be a bare ID ("F0HKG06XT2") or a full FundSingapore link, from which the
// id= value is taken. Anything else is reported as skipped, never guessed.
function parseTokens(input) {
  const added = [];
  const skipped = [];
  const seen = new Set(funds.map(f => f.id));
  for (const raw of String(input || '').split(/[\s,;]+/)) {
    const token = raw.trim();
    if (!token) continue;
    let id = '';
    const m = token.match(/[?&]id=([A-Za-z0-9]+)/i);
    if (m) id = m[1].toUpperCase();
    else if (/^[A-Za-z0-9]+$/.test(token)) id = token.toUpperCase();
    if (!id || id.length < 4) { skipped.push(token); continue; }
    if (seen.has(id)) { skipped.push(token + ' (already listed)'); continue; }
    seen.add(id);
    added.push({ id, name: '' });
  }
  return { added, skipped };
}

document.getElementById('addForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('newIds');
  const { added, skipped } = parseTokens(input.value);
  if (added.length) {
    funds = funds.concat(added);
    save();
    // The new row appears at once (fetchSeries used to do this re-render;
    // the incremental fetch below never touches the table until data lands).
    renderTable();
    // History for the new funds only — the existing lines stay put instead
    // of re-downloading every fund and blanking the chart.
    fetchNewFunds(added);
    // Names and prices arrive in the background; the chart is not blocked on them.
    lookupFundInfo(added);
  }
  const bits = [];
  if (added.length) bits.push(`Added ${added.map(f => f.id).join(', ')}.`);
  if (skipped.length) bits.push(`Skipped: ${skipped.join(', ')}.`);
  setStatus(bits.join(' ') || 'Enter one or more FundSingapore fund IDs, separated by commas.');
  input.value = '';
  input.focus();
});

// Look up fund info (display name + latest price) in the background, in
// parallel. Fetched for EVERY fund in the list — prices are per-day data,
// not stable like names. The ID is shown until the name arrives; the ID
// is kept if the lookup fails, and a failed price lookup leaves that
// fund's price cells as "—" without breaking the table or the chart.
// Names are stored on the fund object exactly as before (so they still
// save to localStorage/Redis); prices live only in fundPrices, never on
// the fund object. Never blocks the chart — fetchSeries runs independently.
async function lookupFundInfo(list) {
  const targets = (list || []).filter(f => f && f.id);
  if (!targets.length) return;
  const results = await Promise.allSettled(targets.map(async f => {
    const res = await fetch(`/api/fund-name?id=${encodeURIComponent(f.id)}`);
    return { f, data: await res.json() };
  }));
  let named = false;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { f, data } = r.value;
    if (!data || data.error) continue;
    if (data.name && !f.name) {
      f.name = String(data.name).trim();
      named = true;
    }
    if (typeof data.price === 'number') {
      fundPrices.set(f.id, {
        price: data.price,
        currency: typeof data.currency === 'string' ? data.currency.toUpperCase() : '',
        date: typeof data.date === 'string' ? data.date : '',
      });
    }
  }
  if (named) { save(); }
  renderTable();
}

// --- periods ---------------------------------------------------------------

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function periodRange(p) {
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const spec = PERIODS[p] || PERIODS['1Y'];
  if (spec.ytd) {
    start.setUTCFullYear(start.getUTCFullYear(), 0, 1);
  } else if (spec.years) {
    start.setUTCFullYear(start.getUTCFullYear() - spec.years);
  } else if (spec.months) {
    start.setUTCMonth(start.getUTCMonth() - spec.months);
  }
  return { start: fmtDate(start), end: fmtDate(end) };
}

document.getElementById('periodBar').addEventListener('click', e => {
  const btn = e.target.closest('[data-period]');
  if (btn) {
    period = btn.getAttribute('data-period');
    document.querySelectorAll('.period-btn').forEach(b => b.classList.toggle('active', b === btn));
    fetchSeries();
  } else if (e.target.id === 'refreshBtn') {
    fetchSeries();
    // Prices are per-day data, so Refresh re-fetches them. A period
    // change does not (the price does not depend on the period).
    lookupFundInfo(funds);
  }
});

// Status line for the loaded period: how many funds are actually drawn
// (hidden funds don't count), plus any funds with no data. Also used by
// the show/hide tick boxes, so the line stays true after a tick.
function setPlotStatus() {
  if (!funds.length) {
    setStatus('No funds to compare yet.');
    return;
  }
  const empty = funds.filter(f => !series[f.id].length).map(f => label(f));
  const withData = funds.filter(f => series[f.id].length).length;
  const visible = funds.filter(f => !hiddenFunds.has(f.id) && series[f.id].length).length;
  if (!withData) {
    setStatus(`No history returned for ${period}. FundSingapore may not have data for these funds.`);
    return;
  }
  if (visible === 0) {
    setStatus('All funds are hidden — tick a fund in the table below to show its line again.');
    return;
  }
  const range = lastRange ? ` (${lastRange.start} to ${lastRange.end})` : '';
  setStatus(`${visible} of ${funds.length} fund(s) plotted for ${period}${range}.` +
    (empty.length ? ` No data from FundSingapore: ${empty.join(', ')}.` : ''));
}

// --- fetching --------------------------------------------------------------

// A pause that can be abandoned: if a newer request supersedes this one
// while it is waiting, the loop below checks the controller and bails
// out silently instead of firing a stale retry.
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// How many times a series load is tried, and the pauses between tries.
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [1000, 2000]; // pause before attempt 2, before attempt 3

// Cache version for timeseries requests. The Vercel CDN caches
// /api/timeseries responses by URL, and a stale edge entry — e.g. one
// cached while FundSingapore briefly returned an empty series for a
// fund — keeps serving "No data" for that fund until it expires; Refresh
// and a newly opened page do not help, because the URL is unchanged
// (seen live 27 Nov 2026: fund 0P0000KV3F showed "No data" on the
// Singapore edge while the same request returned 92 points elsewhere).
// Bumping this version moves every request to a fresh cache key. Bump it
// again if the proxy's data source or response shape changes and a stale
// edge entry ever needs bypassing again. The proxy ignores this param
// (it reads only ids/start/end).
const TIMESERIES_CACHE_VERSION = 2;

// Fetch one timeseries request for the given ids over [start, end],
// retrying failed attempts automatically (up to 3 attempts, 1s then 2s
// pauses). One request usually succeeds, but a cold start (CDN MISS,
// first load of the day) takes ~8–11s and the upstream can be slower or
// fail outright — and the page used to show an error and stop, leaving
// the user to press Refresh. So a failed load retries instead.
//   opts.isStale() — true when the caller no longer wants the result
//     (superseded, period changed); checked before each attempt and
//     after each failure, so a stale retry never fires.
//   opts.onAttempt(c) / opts.onAttemptEnd(c) — each attempt gets its own
//     AbortController, so a timeout abort ends that attempt only (an
//     aborted controller stays aborted forever and would fail every
//     retry at once). The caller may keep the in-flight controller to
//     abort it from outside.
//   opts.onRetry(n) — called before retry attempt n, so the caller can
//     narrate it (full loads do; incremental loads stay silent).
// Returns { data } on success, { error } (the message to show) when
// every attempt failed, or { stopped: true } when isStale() said stop.
// Never throws.
async function fetchTimeseriesWithRetry(ids, start, end, opts = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (opts.isStale && opts.isStale()) return { stopped: true };
    let timedOut = false;
    const attemptController = new AbortController();
    if (opts.onAttempt) opts.onAttempt(attemptController);
    const timer = setTimeout(() => { timedOut = true; attemptController.abort(); }, 30000);
    try {
      const res = await fetch(`/api/timeseries?ids=${encodeURIComponent(ids.join(','))}&start=${start}&end=${end}&v=${TIMESERIES_CACHE_VERSION}`, { signal: attemptController.signal });
      const data = await res.json();
      if (opts.isStale && opts.isStale()) return { stopped: true };
      if (data.error) { lastError = data.error; }
      else { return { data }; }
    } catch (e) {
      // An abort with isStale() true means this request was superseded:
      // the newer request owns the status line, so stay silent.
      if (opts.isStale && opts.isStale()) return { stopped: true };
      // Anything else is a failure worth retrying. An AbortError here can
      // only be this attempt's own 30s timer — an outside abort always
      // comes with isStale() turning true first.
      if (e.name === 'AbortError') {
        lastError = timedOut
          ? 'Loading timed out after 30 seconds. Try Refresh again.'
          : 'Loading was interrupted. Try Refresh again.';
      } else {
        lastError = 'Could not load history (network error). Try Refresh again.';
      }
    } finally {
      clearTimeout(timer);
      if (opts.onAttemptEnd) opts.onAttemptEnd(attemptController);
    }
    if (attempt >= MAX_ATTEMPTS) break; // out of retries
    if (opts.isStale && opts.isStale()) return { stopped: true }; // superseded while failing
    if (opts.onRetry) opts.onRetry(attempt + 1);
    await sleep(RETRY_DELAYS[attempt - 1]);
  }
  return { error: lastError };
}

async function fetchSeries() {
  renderTable();
  if (!funds.length) {
    series = {};
    loading = false;
    drawChart();
    setStatus('No funds to compare yet.');
    return;
  }
  // Abort any in-flight attempt: the newest request always wins. A period
  // tap, Refresh, or fund-list edit is never silently ignored.
  if (seriesAttemptController) seriesAttemptController.abort();
  const controller = {};
  seriesController = controller;
  // A warning set just before this load (e.g. an invalid ?u= code) is
  // re-applied once, at the end, instead of being overwritten by the
  // load's own status. Captured here so a later request can never
  // resurrect it.
  const warning = pendingWarning;
  pendingWarning = null;
  loading = true;
  setStatus(`Loading ${period} history…`);
  drawChart();
  const { start, end } = periodRange(period);
  lastRange = { start, end };
  const result = await fetchTimeseriesWithRetry(funds.map(f => f.id), start, end, {
    isStale: () => seriesController !== controller,
    onAttempt: c => { seriesAttemptController = c; },
    onAttemptEnd: c => { if (seriesAttemptController === c) seriesAttemptController = null; },
    onRetry: n => setStatus(`Loading ${period} history… retrying (attempt ${n} of ${MAX_ATTEMPTS})`),
  });
  // Still the current request: publish the final state. A superseded
  // request returns above (via isStale) and never reaches here, so it
  // cannot overwrite the newer request's status or chart.
  if (seriesController !== controller) return;
  seriesController = null;
  seriesAttemptController = null;
  loading = false;
  // Funds whose own upstream call failed and have no points: retried
  // once below, via the incremental path (which retries just them).
  const failed = [];
  if (result.error) {
    setStatus(result.error);
  } else {
    // Merge the response into the existing series, preserving entries for
    // funds still listed but absent from this response (an incremental
    // fetch for a newly added fund landed after this request started, and
    // must not be wiped), and dropping entries for funds no longer
    // listed. On a period change the response carries every current
    // fund, so nothing from the old period survives.
    const next = {};
    for (const f of funds) {
      const entry = result.data.funds?.[f.id];
      const pts = entry?.points;
      if (pts && pts.length) {
        // Cache each point's timestamp once. The chart and the tooltip both
        // need it, and re-parsing the date string on every use is what froze
        // the page (see the mousemove handler below).
        next[f.id] = pts.map(p => ({ date: p.date, value: p.value, t: Date.parse(p.date + 'T00:00:00Z') }));
      } else if (entry && entry.error) {
        // This fund's own upstream call failed. A failed call must never
        // wipe a good series another path already merged for this fund;
        // with no good entry to keep, the fund is retried below.
        if (series[f.id] && series[f.id].length) {
          next[f.id] = series[f.id];
        } else {
          next[f.id] = [];
          failed.push({ id: f.id, error: entry.error });
        }
      } else if (pts) {
        // Genuinely empty series (Janus): no data, no error, no retry.
        next[f.id] = [];
      } else if (series[f.id]) {
        next[f.id] = series[f.id];
      } else {
        next[f.id] = [];
      }
    }
    series = next;
    setPlotStatus();
  }
  renderTable();
  drawChart();
  // A warning captured at the start of this load (e.g. an invalid ?u=
  // code) is shown once, instead of being overwritten by the load's own
  // status. A background shared-list failure from a newer request is
  // not this load's to show — it is cleared here as stale.
  if (warning) setStatus(warning);
  else if (stickyListError) {
    const stale = stickyListError;
    stickyListError = null;
    if (stale.controller === controller) setStatus(stale.msg);
  }
  // Funds whose own call failed and have no points get one incremental
  // retry pass: fetchNewFunds retries just them (up to 3 attempts) and
  // never calls fetchSeries, so this cannot loop. A period tap during
  // that retry discards it via its isStale guard.
  if (failed.length) fetchNewFunds(failed.map(x => ({ id: x.id })));
}

// Fetch history for newly added funds only, and merge it into the chart.
// Adding a fund used to re-download every fund's history and blank the
// chart while it loaded; now an add costs one small request for just the
// new ids, and the existing lines stay put. The new fund's line appears
// when its data arrives (its table row shows "No data" / "—" until then).
// This path never sets loading and never draws the "Loading…" note, and
// it has its own AbortController inside the shared helper — a full
// fetchSeries neither aborts it nor is aborted by it.
//
// A fund can fail inside an otherwise-successful proxy response: the
// proxy fans out one upstream call per fund, and a single fund's call
// can fail transiently while the rest succeed. Such an entry carries
// error: '...' — unlike a genuinely empty series (Janus), which has no
// error key. A failed fund is retried on its own (same 3-attempt, 1s/2s
// rhythm as the shared helper) before the page gives up on it; a
// genuinely empty series is never retried.
async function fetchNewFunds(added) {
  let pending = (added || []).map(f => f.id).filter(Boolean);
  if (!pending.length) return;
  const { start, end } = periodRange(period);
  const errors = new Map(); // id -> last error text reported for that fund
  for (let round = 1; round <= MAX_ATTEMPTS; round++) {
    const result = await fetchTimeseriesWithRetry(pending, start, end, {
      // A period change makes the result stale — the data would be for the
      // wrong period. Removal is handled per fund at merge time below, so a
      // fund dropped mid-flight does not cancel the others.
      isStale: () => {
        const now = periodRange(period);
        return now.start !== start || now.end !== end;
      },
    });
    if (result.stopped) return;
    if (result.error) {
      // The whole proxy call failed; the shared helper already retried
      // it 3 times, so there is nothing more to try here.
      if (!loading) {
        const now = periodRange(period);
        if (now.start === start && now.end === end) setStatus(result.error);
      }
      return;
    }
    // Merge, but only for funds still listed and only if the period has
    // not changed since the request started.
    const now = periodRange(period);
    if (now.start !== start || now.end !== end) return;
    const stillFailed = [];
    let merged = false;
    for (const id of pending) {
      if (!funds.some(f => f.id === id)) continue;
      const entry = result.data.funds?.[id];
      const pts = entry?.points || [];
      if (entry && entry.error && !pts.length) {
        stillFailed.push(id);
        errors.set(id, entry.error);
        continue;
      }
      series[id] = pts.map(p => ({ date: p.date, value: p.value, t: Date.parse(p.date + 'T00:00:00Z') }));
      merged = true;
    }
    if (!stillFailed.length) {
      // Everything resolved — data, or genuinely no data.
      // A full load in flight will render when it completes (its merge
      // rule preserves these entries); otherwise update the status,
      // table, and chart now.
      if (merged && !loading) {
        setPlotStatus();
        renderTable();
        drawChart();
      }
      return;
    }
    pending = stillFailed;
    if (round >= MAX_ATTEMPTS) break;
    await sleep(RETRY_DELAYS[round - 1]);
  }
  // Still failed after all rounds: show the first fund's error once, so
  // the user sees the reason instead of a silent "No data".
  if (!loading) {
    const now = periodRange(period);
    if (now.start === start && now.end === end) {
      const first = errors.get(pending[0]);
      if (first) setStatus(first);
    }
  }
}

// --- returns table -----------------------------------------------------------

function fundReturn(points) {
  if (!points || points.length < 2) return null;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  if (!first) return null;
  return (last / first - 1) * 100;
}

// --- returns table (sortable) ------------------------------------------------

// Click a column header to sort by it; clicking again reverses the order.
// Default: best return first, matching the hover tooltip. The colour dot
// stays with its fund when rows are reordered, so the table still works
// as the chart legend.
let tableSort = { key: 'return', dir: -1 };

function renderTable() {
  const body = document.getElementById('returnRows');
  const rows = funds.map((f, i) => {
    const points = series[f.id] || [];
    return { f, i, points, r: fundReturn(points), info: fundPrices.get(f.id) || null };
  });
  const dir = tableSort.dir;
  const by = {
    fund: (a, b) => label(a.f).localeCompare(label(b.f)),
    return: (a, b) => a.r - b.r,
    price: (a, b) => a.info.price - b.info.price,
    date: (a, b) => (a.info.date || '').localeCompare(b.info.date || ''),
  }[tableSort.key] || (() => 0);
  // A fund missing the value a column sorts by always sorts last for
  // that column, whichever direction — the same rule Return already had
  // for funds with no data.
  const missing = {
    fund: () => false,
    return: (row) => row.r === null,
    price: (row) => typeof row.info?.price !== 'number',
    date: (row) => !row.info?.date,
  }[tableSort.key] || (() => false);
  rows.sort((a, b) => {
    const am = missing(a), bm = missing(b);
    if (am && bm) return 0;
    if (am) return 1;
    if (bm) return -1;
    return by(a, b) * dir;
  });
  // Arrow on the active column header.
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    const key = th.getAttribute('data-sort');
    const base = th.textContent.replace(/ [▲▼]$/, '');
    th.textContent = base + (tableSort.key === key ? (dir === 1 ? ' ▲' : ' ▼') : '');
  });
  if (!funds.length) {
    body.innerHTML = '<tr><td colspan="6">No funds yet — add FundSingapore fund IDs above.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(({ f, i, points, r, info }) => {
    const color = COLORS[i % COLORS.length];
    const hidden = hiddenFunds.has(f.id);
    // The tick box is the per-fund show/hide control. The row stays
    // visible (dimmed when hidden) so the fund can be ticked back on.
    const tick = `<td class="show-col"><input type="checkbox" data-show="${esc(f.id)}"${hidden ? '' : ' checked'} aria-label="Show ${esc(label(f))} on the chart"></td>`;
    const rowClass = hidden ? ' class="hidden-fund"' : '';
    const fundCell = `<td><span class="chip-dot" style="background:${color}"></span> ${esc(label(f))} <span class="hint">(${esc(f.id)})</span></td>`;
    // Each cell renders independently: a fund with no history but with a
    // price (Janus is the live example — empty series, stale price listed)
    // shows "No data" for Return and still shows its price and date.
    const sign = r !== null && r > 0 ? '+' : '';
    const retCell = r === null ? 'No data' : `${sign}${r.toFixed(2)}%`;
    // The Remove button is this fund's delete control (it used to live
    // on the fund chips above the chart). No confirmation dialog — the
    // old button had none.
    const del = `<td><button type="button" class="small danger-outline" data-del="${esc(f.id)}" aria-label="Remove ${esc(label(f))}">Remove</button></td>`;
    return `<tr${rowClass}>${tick}${fundCell}` +
      `<td class="price">${retCell}</td><td class="price">${esc(formatPrice(info))}</td><td>${info?.date ? esc(info.date) : '—'}</td>${del}</tr>`;
  }).join('');
  // Hiding is a display choice only: it never touches localStorage or
  // Redis, and the set is the single source of truth — re-renders (sort,
  // period change, late name lookup, remote list load) rebuild the boxes
  // from it, so the state survives them.
  body.querySelectorAll('[data-show]').forEach(cb => cb.addEventListener('change', () => {
    const id = cb.getAttribute('data-show');
    if (cb.checked) hiddenFunds.delete(id); else hiddenFunds.add(id);
    cb.closest('tr').classList.toggle('hidden-fund', !cb.checked);
    if (!loading) setPlotStatus();
    drawChart();
  }));
  // Remove is a delete, not a display choice: drop the fund's hidden
  // state, price and series, save the shortened list, and re-render.
  // No fetch: the other funds' series are already in memory for the
  // current period, so removing one fund must not re-download the rest
  // or blank the chart. If a full load is in flight, its merge builds
  // the next series from the current fund list, so the removed fund
  // stays gone when that load completes.
  body.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-del');
    hiddenFunds.delete(id);
    fundPrices.delete(id);
    delete series[id];
    funds = funds.filter(f => f.id !== id);
    save();
    renderTable();
    drawChart();
    if (!loading) setPlotStatus();
  }));
}

document.querySelectorAll('thead th[data-sort]').forEach(th => {
  th.style.cursor = 'pointer';
  th.addEventListener('click', () => {
    const key = th.getAttribute('data-sort');
    if (tableSort.key === key) tableSort.dir *= -1;
    else tableSort = { key, dir: key === 'fund' ? 1 : -1 };
    renderTable();
  });
});

// --- chart (vanilla canvas, no dependency) -------------------------------------

const canvas = document.getElementById('chart');
const tip = document.getElementById('chartTip');

// X-axis mapping from the last drawChart run, reused by the tooltip so it
// never has to re-scan the data. See the mousemove handler.
let chartGeom = null;

function drawChart() {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 1000;
  const cssH = 420;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  // While a fetch is in flight the chart area says so, instead of showing
  // stale data as if it were the newly requested period.
  if (loading) {
    ctx.fillStyle = '#5b6470';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText(`Loading ${period} history…`, 16, 40);
    return;
  }

  // Funds with enough history to draw, and of those the ones not hidden.
  // The axis range comes from every fund with data (hidden or not), so
  // ticking a box on and off never rescales the chart.
  const withData = funds.filter(f => (series[f.id] || []).length >= 2);
  const plotted = withData.filter(f => !hiddenFunds.has(f.id));
  if (!withData.length) {
    ctx.fillStyle = '#5b6470';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('No history to plot yet — add funds and press Refresh.', 16, 40);
    return;
  }

  const padL = 56, padR = 16, padT = 16, padB = 34;
  const W = cssW - padL - padR, H = cssH - padT - padB;

  let min = Infinity, max = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const f of withData) {
    for (const p of series[f.id]) {
      min = Math.min(min, p.value); max = Math.max(max, p.value);
      t0 = Math.min(t0, p.t); t1 = Math.max(t1, p.t);
    }
  }
  if (max - min < 1) { max = min + 1; }
  const padY = (max - min) * 0.08;
  min -= padY; max += padY;
  if (t1 - t0 < 86400000) t1 = t0 + 86400000;

  const X = t => padL + ((t - t0) / (t1 - t0)) * W;
  const Y = v => padT + (1 - (v - min) / (max - min)) * H;

  // Remember the x mapping for the tooltip (see the mousemove handler).
  chartGeom = { t0, t1, padL, W };

  // Gridlines and y labels.
  ctx.strokeStyle = '#e6e9ed'; ctx.fillStyle = '#5b6470';
  ctx.font = '12px system-ui, sans-serif'; ctx.lineWidth = 1;
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const v = min + ((max - min) * i) / steps;
    const y = Y(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke();
    ctx.fillText(v.toFixed(1), 8, y + 4);
  }
  // X labels: first, middle, last date.
  const xDates = [t0, t0 + (t1 - t0) / 2, t1];
  ctx.fillText(new Date(t0).toISOString().slice(0, 10), padL, cssH - 12);
  const mid = new Date(t0 + (t1 - t0) / 2).toISOString().slice(0, 10);
  ctx.fillText(mid, padL + W / 2 - 30, cssH - 12);
  ctx.fillText(new Date(t1).toISOString().slice(0, 10), padL + W - 66, cssH - 12);
  // Baseline at 100.
  if (min < 100 && max > 100) {
    ctx.strokeStyle = '#98a2b3'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(padL, Y(100)); ctx.lineTo(padL + W, Y(100)); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Vertical gridlines on the x axis. The scale follows the plotted range
  // (t1 - t0), not the period button, so YTD behaves correctly in any
  // month: 3 months or less -> thin at each Monday, thick at each month
  // start; longer -> thin at each month start, thick at each year start
  // (1 January). A boundary that is both (a Monday that is the 1st, or
  // 1 January) draws once, thick. All dates UTC, matching the data
  // timestamps and the x labels. Cheap: at most ~60 lines on 5Y.
  const DAY_MS = 86400000;
  const shortRange = (t1 - t0) <= 92 * DAY_MS;
  const thinX = [], thickX = [];
  // Month starts in range.
  let m = new Date(Date.UTC(new Date(t0).getUTCFullYear(), new Date(t0).getUTCMonth(), 1));
  if (m.getTime() < t0) m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
  while (m.getTime() <= t1) {
    if (shortRange || m.getUTCMonth() === 0) thickX.push(X(m.getTime()));
    else thinX.push(X(m.getTime()));
    m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
  }
  if (shortRange) {
    // Mondays in range; a Monday that is the 1st is already a thick
    // month-start line, so it is skipped here.
    let w = new Date(t0);
    w = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() + ((8 - w.getUTCDay()) % 7)));
    while (w.getTime() <= t1) {
      if (w.getUTCDate() !== 1) thinX.push(X(w.getTime()));
      w = new Date(w.getTime() + 7 * DAY_MS);
    }
  }
  for (const x of thinX) {
    ctx.strokeStyle = '#e6e9ed'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + H); ctx.stroke();
  }
  for (const x of thickX) {
    ctx.strokeStyle = '#98a2b3'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + H); ctx.stroke();
  }

  // One line per visible fund. The colour follows the fund's position in
  // the fund list (the same index the table uses), so hiding one fund
  // never recolors the others.
  if (!plotted.length) {
    // Every fund with data is hidden: axes with no lines, and a note.
    ctx.fillStyle = '#5b6470';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('All funds are hidden — tick a fund in the table below to show its line.', 16, 40);
    return;
  }
  plotted.forEach(f => {
    ctx.strokeStyle = COLORS[funds.indexOf(f) % COLORS.length];
    ctx.lineWidth = 2;
    ctx.beginPath();
    series[f.id].forEach((p, j) => {
      const x = X(p.t), y = Y(p.value);
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  // (The returns table below the chart is the legend: colour dot + fund name.)
}

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const plotted = funds.filter(f => !hiddenFunds.has(f.id) && (series[f.id] || []).length >= 2);
  if (!plotted.length || loading || !chartGeom) { tip.hidden = true; return; }
  // One pass over the points, using the cached timestamps and the x
  // mapping drawChart already computed. The old code called chartX() for
  // every point, and chartX re-scanned every point each time — O(N^2):
  // 16 seconds for a single mouse move on 5Y data, which is what froze
  // the page with a "Page Unresponsive" popup. This version takes ~5ms.
  const { t0, t1, padL, W } = chartGeom;
  const X = t => padL + ((t - t0) / (t1 - t0)) * W;
  let best = null, bestDx = Infinity;
  for (const f of plotted) {
    for (const p of series[f.id]) {
      const dx = Math.abs(mx - X(p.t));
      if (dx < bestDx) { bestDx = dx; best = p; }
    }
  }
  if (!best || bestDx > 40) { tip.hidden = true; return; }
  // Best performer at the hovered date first: rows are sorted by each
  // fund's value at that date, highest first. The dot colour follows the
  // fund's position in the fund list, matching the table and the chart.
  const rows = plotted.map(f => {
    const pts = series[f.id];
    let nearest = pts[0];
    for (const p of pts) {
      if (Math.abs(p.t - best.t) < Math.abs(nearest.t - best.t)) nearest = p;
    }
    return { f, value: nearest.value };
  })
    .sort((a, b) => b.value - a.value)
    .map(({ f, value }) =>
      `<span style="color:${COLORS[funds.indexOf(f) % COLORS.length]}">●</span> ${esc(label(f))}: ${value.toFixed(2)}`)
    .join('<br>');
  tip.innerHTML = `<strong>${esc(best.date)}</strong><br>${rows}`;
  tip.hidden = false;
  tip.style.left = Math.min(e.clientX - rect.left + 12, rect.width - 220) + 'px';
  tip.style.top = (e.clientY - rect.top + 12) + 'px';
});
canvas.addEventListener('mouseleave', () => { tip.hidden = true; });

window.addEventListener('resize', drawChart);

// --- init --------------------------------------------------------------------
// ?u=<code> in the address bar: the shared compare list is loaded before
// the first render. Otherwise the local list renders at once, and a code
// this browser remembers loads in the background and replaces it if one
// is found; if none exists yet, this browser's local list migrates up.
(async () => {
  const params = new URLSearchParams(location.search);
  const urlCode = (params.get('u') || '').trim().toLowerCase();
  if (urlCode) {
    if (!CODE_RE.test(urlCode)) {
      // The fetchSeries below would overwrite this warning, so it is
      // captured at the start of that load and re-applied once, at the end.
      pendingWarning = 'That list link has an invalid code — showing your local compare list.';
      setStatus(pendingWarning);
    } else {
      setStatus('Loading your shared compare list…');
      const result = await loadSharedCompare(urlCode);
      if (result.funds) {
        listCode = urlCode;
        rememberCode(urlCode);
        applyRemoteCompare(result.funds);
      } else if (result.notFound) {
        listCode = urlCode;
        rememberCode(urlCode);
        migrateLocalCompare();
      } else {
        pendingWarning = "Couldn't load the shared compare list — showing the copy saved in this browser.";
        setStatus(pendingWarning);
      }
    }
    fetchSeries();
    lookupFundInfo(funds);
    return;
  }
  fetchSeries();
  // Names and latest prices for every fund (prices are per-day data, so
  // they are fetched on every page load, not only for nameless funds).
  lookupFundInfo(funds);
  const code = rememberedCode();
  if (!code) return;
  listCode = code;
  const result = await loadSharedCompare(code);
  if (result.funds) {
    // The first fetchSeries above already runs for the local list. If the
    // remote list is the same funds in the same order, a second fetch
    // would only abort the first one and start over — skip it and just
    // re-render the table (remote names may differ from local ones).
    const before = funds.map(f => f.id).join(',');
    applyRemoteCompare(result.funds);
    if (funds.map(f => f.id).join(',') === before) {
      renderTable();
    } else {
      fetchSeries();
    }
    lookupFundInfo(funds);
  } else if (result.notFound) {
    migrateLocalCompare();
  } else {
    // The warning is set now; if a series load is in flight, its final
    // status would overwrite it, so that load re-applies it once — but
    // only that load (a newer request clears it as stale).
    const msg = "Couldn't reach the shared compare list — showing the copy saved in this browser.";
    setStatus(msg);
    if (loading) stickyListError = { msg, controller: seriesController };
  }
})();
