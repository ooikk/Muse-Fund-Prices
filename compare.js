// Fund comparison page — plots FundSingapore history for several funds,
// rebased to 100 at the start of the chosen period.
// The fund list lives in localStorage on this device. History is fetched
// live from FundSingapore through the same-origin /api/timeseries proxy
// each time the period changes or Refresh is pressed; nothing is stored
// on the server. Each series is in that fund's own currency — there is
// no currency conversion.
const STORAGE_KEY = 'unit-trust-compare-funds-v1';

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
let fetching = false;

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

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(funds)); } catch (e) { /* storage full/blocked */ }
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
  }
  const bits = [];
  if (added.length) bits.push(`Added ${added.map(f => f.id).join(', ')}.`);
  if (skipped.length) bits.push(`Skipped: ${skipped.join(', ')}.`);
  setStatus(bits.join(' ') || 'Enter one or more FundSingapore fund IDs, separated by commas.');
  input.value = '';
  input.focus();
});

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

// --- fetching --------------------------------------------------------------

async function fetchSeries() {
  renderTable();
  if (!funds.length) {
    series = {};
    drawChart();
    setStatus('No funds to compare yet.');
    return;
  }
  if (fetching) return;
  fetching = true;
  setStatus('Loading history…');
  const { start, end } = periodRange(period);
  try {
    const ids = funds.map(f => f.id).join(',');
    const res = await fetch(`/api/timeseries?ids=${encodeURIComponent(ids)}&start=${start}&end=${end}`);
    const data = await res.json();
    if (data.error) { setStatus(data.error); return; }
    series = {};
    for (const f of funds) series[f.id] = (data.funds && data.funds[f.id] && data.funds[f.id].points) || [];
    const empty = funds.filter(f => !series[f.id].length).map(f => label(f));
    const withData = funds.filter(f => series[f.id].length).length;
    setStatus(withData
      ? `${withData} of ${funds.length} fund(s) plotted for ${period} (${start} to ${end}).` +
        (empty.length ? ` No data from FundSingapore: ${empty.join(', ')}.` : '')
      : `No history returned for ${period}. FundSingapore may not have data for these funds.`);
  } catch (e) {
    setStatus('Could not load history (network error). Try Refresh again.');
  } finally {
    fetching = false;
    renderTable();
    drawChart();
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

function renderTable() {
  const body = document.getElementById('returnRows');
  body.innerHTML = funds.map((f, i) => {
    const points = series[f.id] || [];
    const r = fundReturn(points);
    const color = COLORS[i % COLORS.length];
    if (r === null) {
      return `<tr><td><span class="chip-dot" style="background:${color}"></span> ${esc(label(f))} <span class="hint">(${esc(f.id)})</span></td><td colspan="4">No data</td></tr>`;
    }
    const sign = r > 0 ? '+' : '';
    return `<tr><td><span class="chip-dot" style="background:${color}"></span> ${esc(label(f))} <span class="hint">(${esc(f.id)})</span></td>` +
      `<td class="price">${sign}${r.toFixed(2)}%</td><td>${esc(points[0].date)}</td><td>${esc(points[points.length - 1].date)}</td><td>${points.length}</td></tr>`;
  }).join('');
}

// --- chart (vanilla canvas, no dependency) -------------------------------------

const canvas = document.getElementById('chart');
const tip = document.getElementById('chartTip');

function drawChart() {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 1000;
  const cssH = 420;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const plotted = funds.filter(f => (series[f.id] || []).length >= 2);
  if (!plotted.length) {
    ctx.fillStyle = '#5b6470';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('No history to plot yet — add funds and press Refresh.', 16, 40);
    return;
  }

  const padL = 56, padR = 16, padT = 16, padB = 34;
  const W = cssW - padL - padR, H = cssH - padT - padB;

  let min = Infinity, max = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const f of plotted) {
    for (const p of series[f.id]) {
      min = Math.min(min, p.value); max = Math.max(max, p.value);
      const t = Date.parse(p.date + 'T00:00:00Z');
      t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
  }
  if (max - min < 1) { max = min + 1; }
  const padY = (max - min) * 0.08;
  min -= padY; max += padY;
  if (t1 - t0 < 86400000) t1 = t0 + 86400000;

  const X = t => padL + ((t - t0) / (t1 - t0)) * W;
  const Y = v => padT + (1 - (v - min) / (max - min)) * H;

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

  // One line per fund.
  plotted.forEach((f, i) => {
    ctx.strokeStyle = COLORS[i % COLORS.length];
    ctx.lineWidth = 2;
    ctx.beginPath();
    series[f.id].forEach((p, j) => {
      const x = X(Date.parse(p.date + 'T00:00:00Z')), y = Y(p.value);
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  // (The returns table below the chart is the legend: colour dot + fund name.)
}

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const plotted = funds.filter(f => (series[f.id] || []).length >= 2);
  if (!plotted.length) { tip.hidden = true; return; }
  // Find the data point nearest the cursor's x position.
  let best = null, bestDx = Infinity;
  for (const f of plotted) {
    for (const p of series[f.id]) {
      const t = Date.parse(p.date + 'T00:00:00Z');
      const dx = Math.abs(mx - chartX(t));
      if (dx < bestDx) { bestDx = dx; best = { date: p.date }; }
    }
  }
  if (!best || bestDx > 40) { tip.hidden = true; return; }
  const rows = plotted.map((f, i) => {
    const pts = series[f.id];
    let nearest = pts[0];
    for (const p of pts) {
      if (Math.abs(Date.parse(p.date) - Date.parse(best.date)) < Math.abs(Date.parse(nearest.date) - Date.parse(best.date))) nearest = p;
    }
    return `<span style="color:${COLORS[i % COLORS.length]}">●</span> ${esc(label(f))}: ${nearest.value.toFixed(2)}`;
  }).join('<br>');
  tip.innerHTML = `<strong>${esc(best.date)}</strong><br>${rows}`;
  tip.hidden = false;
  tip.style.left = Math.min(e.clientX - rect.left + 12, rect.width - 220) + 'px';
  tip.style.top = (e.clientY - rect.top + 12) + 'px';
});
canvas.addEventListener('mouseleave', () => { tip.hidden = true; });

function chartX(t) {
  // Same x mapping as drawChart, recomputed from current data.
  const plotted = funds.filter(f => (series[f.id] || []).length >= 2);
  let t0 = Infinity, t1 = -Infinity;
  for (const f of plotted) for (const p of series[f.id]) {
    const d = Date.parse(p.date + 'T00:00:00Z');
    t0 = Math.min(t0, d); t1 = Math.max(t1, d);
  }
  if (t1 - t0 < 86400000) t1 = t0 + 86400000;
  const cssW = canvas.clientWidth || 1000;
  return 56 + ((t - t0) / (t1 - t0)) * (cssW - 56 - 16);
}

window.addEventListener('resize', drawChart);

// --- init --------------------------------------------------------------------

renderList();
fetchSeries();
