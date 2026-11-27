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
// Set when the ?u= code in the address bar is invalid: fetchSeries would
// otherwise overwrite the warning with its own status when the series
// load finishes, so it re-applies the warning once, after the first load.
let stickyInvalidCode = false;

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
// { start, end } of the last loaded period, for the status line.
let lastRange = null;
// In-flight series request. A new request (period change, Refresh, fund
// add/remove) aborts the previous one — the newest request always wins,
// so a period tap is never silently swallowed while a fetch is in flight.
let seriesController = null;
let seriesTimeout = null;
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

// --- fund list -----------------------------------------------------------

function renderList() {
  const box = document.getElementById('fundList');
  if (!funds.length) {
    box.innerHTML = '<p class="hint">No funds yet — add FundSingapore fund IDs above.</p>';
    return;
  }
  box.innerHTML = funds.map((f, i) =>
    `<span class="fund-chip"><span class="chip-dot" style="background:${COLORS[i % COLORS.length]}"></span>` +
    `<span title="${esc(f.id)}">${esc(label(f))}</span>` +
    `<button type="button" class="small danger-outline" data-del="${esc(f.id)}" aria-label="Remove ${esc(label(f))}">Remove</button></span>`
  ).join('');
  box.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => {
    hiddenFunds.delete(btn.getAttribute('data-del'));
    funds = funds.filter(f => f.id !== btn.getAttribute('data-del'));
    save();
    renderList();
    fetchSeries();
  }));
}

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
    renderList();
    fetchSeries();
    // Names arrive in the background; the chart is not blocked on them.
    lookupNames(added);
  }
  const bits = [];
  if (added.length) bits.push(`Added ${added.map(f => f.id).join(', ')}.`);
  if (skipped.length) bits.push(`Skipped: ${skipped.join(', ')}.`);
  setStatus(bits.join(' ') || 'Enter one or more FundSingapore fund IDs, separated by commas.');
  input.value = '';
  input.focus();
});

// Look up display names for funds added without one, in the background.
// The ID is shown until the name arrives; the ID is kept if the lookup
// fails. Never blocks the chart — fetchSeries runs independently.
async function lookupNames(list) {
  for (const f of list) {
    if (!f || f.name) continue;
    try {
      const res = await fetch(`/api/fund-name?id=${encodeURIComponent(f.id)}`);
      const data = await res.json();
      if (data && data.name) {
        f.name = String(data.name).trim();
        save();
        renderList();
        renderTable();
      }
    } catch (e) { /* keep the ID */ }
  }
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
  }
});

// Status line for the loaded period: how many funds are actually drawn
// (hidden funds don't count), plus any funds with no data. Also used by
// the show/hide tick boxes, so the line stays true after a tick.
function setPlotStatus() {
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

async function fetchSeries() {
  renderTable();
  if (!funds.length) {
    series = {};
    loading = false;
    drawChart();
    setStatus('No funds to compare yet.');
    return;
  }
  // Abort any in-flight fetch: the newest request always wins. A period
  // tap, Refresh, or fund-list edit is never silently ignored.
  if (seriesController) seriesController.abort();
  const controller = new AbortController();
  seriesController = controller;
  let timedOut = false;
  clearTimeout(seriesTimeout);
  seriesTimeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
  loading = true;
  setStatus(`Loading ${period} history…`);
  drawChart();
  const { start, end } = periodRange(period);
  lastRange = { start, end };
  try {
    const ids = funds.map(f => f.id).join(',');
    const res = await fetch(`/api/timeseries?ids=${encodeURIComponent(ids)}&start=${start}&end=${end}`, { signal: controller.signal });
    const data = await res.json();
    if (seriesController !== controller) return; // superseded by a newer request
    if (data.error) { setStatus(data.error); return; }
    series = {};
    for (const f of funds) {
      // Cache each point's timestamp once. The chart and the tooltip both
      // need it, and re-parsing the date string on every use is what froze
      // the page (see the mousemove handler below).
      series[f.id] = ((data.funds && data.funds[f.id] && data.funds[f.id].points) || [])
        .map(p => ({ date: p.date, value: p.value, t: Date.parse(p.date + 'T00:00:00Z') }));
    }
    setPlotStatus();
  } catch (e) {
    if (e.name === 'AbortError') {
      // User-aborted (superseded): the newer fetch owns the status.
      // Timed out: the request hung, so say so instead of spinning.
      if (timedOut && seriesController === controller) setStatus('Loading timed out after 30 seconds. Try Refresh again.');
      return;
    }
    if (seriesController !== controller) return;
    setStatus('Could not load history (network error). Try Refresh again.');
  } finally {
    clearTimeout(seriesTimeout);
    if (seriesController === controller) {
      seriesController = null;
      loading = false;
      renderTable();
      drawChart();
      if (stickyInvalidCode) {
        stickyInvalidCode = false;
        setStatus('That list link has an invalid code — showing your local compare list.');
      }
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
    return { f, i, points, r: fundReturn(points) };
  });
  const dir = tableSort.dir;
  const by = {
    fund: (a, b) => label(a.f).localeCompare(label(b.f)),
    return: (a, b) => a.r - b.r,
    from: (a, b) => (a.points[0]?.date || '').localeCompare(b.points[0]?.date || ''),
    to: (a, b) => (a.points[a.points.length - 1]?.date || '').localeCompare(b.points[b.points.length - 1]?.date || ''),
    points: (a, b) => a.points.length - b.points.length,
  }[tableSort.key] || (() => 0);
  rows.sort((a, b) => {
    // Funds with no data always sort last, whichever direction.
    if (a.r === null && b.r === null) return 0;
    if (a.r === null) return 1;
    if (b.r === null) return -1;
    return by(a, b) * dir;
  });
  // Arrow on the active column header.
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    const key = th.getAttribute('data-sort');
    const base = th.textContent.replace(/ [▲▼]$/, '');
    th.textContent = base + (tableSort.key === key ? (dir === 1 ? ' ▲' : ' ▼') : '');
  });
  body.innerHTML = rows.map(({ f, i, points, r }) => {
    const color = COLORS[i % COLORS.length];
    const hidden = hiddenFunds.has(f.id);
    // The tick box is the per-fund show/hide control. The row stays
    // visible (dimmed when hidden) so the fund can be ticked back on.
    const tick = `<td class="show-col"><input type="checkbox" data-show="${esc(f.id)}"${hidden ? '' : ' checked'} aria-label="Show ${esc(label(f))} on the chart"></td>`;
    const rowClass = hidden ? ' class="hidden-fund"' : '';
    const fundCell = `<td><span class="chip-dot" style="background:${color}"></span> ${esc(label(f))} <span class="hint">(${esc(f.id)})</span></td>`;
    if (r === null) {
      return `<tr${rowClass}>${tick}${fundCell}<td colspan="4">No data</td></tr>`;
    }
    const sign = r > 0 ? '+' : '';
    return `<tr${rowClass}>${tick}${fundCell}` +
      `<td class="price">${sign}${r.toFixed(2)}%</td><td>${esc(points[0].date)}</td><td>${esc(points[points.length - 1].date)}</td><td>${points.length}</td></tr>`;
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
      stickyInvalidCode = true;
      setStatus('That list link has an invalid code — showing your local compare list.');
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
        setStatus("Couldn't load the shared compare list — showing the copy saved in this browser.");
      }
    }
    renderList();
    fetchSeries();
    lookupNames(funds.filter(f => !f.name));
    return;
  }
  renderList();
  fetchSeries();
  // Pick up names for any fund saved without one (added before name lookup
  // existed); the ID stays visible until a name arrives.
  lookupNames(funds.filter(f => !f.name));
  const code = rememberedCode();
  if (!code) return;
  listCode = code;
  const result = await loadSharedCompare(code);
  if (result.funds) {
    applyRemoteCompare(result.funds);
    renderList();
    fetchSeries();
    lookupNames(funds.filter(f => !f.name));
  } else if (result.notFound) {
    migrateLocalCompare();
  } else {
    setStatus("Couldn't reach the shared compare list — showing the copy saved in this browser.");
  }
})();
