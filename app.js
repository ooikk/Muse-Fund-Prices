// Unit Trust Fund Tracker — front end.
// Funds are stored in localStorage on this device. Seeded once from the
// 17 DollarDex funds previously tracked in the "Muse unit trust price update" sheet.
// Prices/dates below are the seed values (28-29 Oct 2026) until refreshed.
const STORAGE_KEY = 'unit-trust-funds-v1';

// Shared lists (Upstash Redis): a list code is 16 lowercase letters/digits.
// When a code is active, every save also writes through to Redis, so the
// same list loads on any device from the personal link ?u=<code>.
// localStorage stays as the local copy and the fallback when Redis is
// unreachable — a failed Redis save never loses local data.
const CODE_KEY = 'unit-trust-list-code-v1';
const CODE_RE = /^[a-z0-9]{16}$/;
let listCode = null;
let redisSaveTimer = null;

function rememberCode(code) {
  try { localStorage.setItem(CODE_KEY, code); } catch (e) { /* storage blocked */ }
}
function forgetCode() {
  try { localStorage.removeItem(CODE_KEY); } catch (e) { /* storage blocked */ }
}
function rememberedCode() {
  try {
    const code = localStorage.getItem(CODE_KEY);
    return code && CODE_RE.test(code) ? code : null;
  } catch (e) { return null; }
}
function listLink(code) {
  return location.origin + location.pathname + '?u=' + code;
}

const SEED_FUNDS = [
  { name: 'Allianz GIF Allianz Europe Equity Growth Select AT (H2-SGD)', currency: 'SGD', price: '16.576', date: '29-Oct-2026', url: 'https://www.dollardex.com/sgn/?current=investUT/fundOverview&p=icKJECY4BAI7Ybpz4J1AJdkm8cTHpJuJpNSJEcdC+tU=' },
  { name: 'Allianz Global High Payout AM SGD', currency: 'SGD', price: '0.736', date: '28-Oct-2026', url: 'https://www.dollardex.com/SGN/?current=investUT/fundOverview&p=v9bQpI9b1XP7m1LxnTRrC6LTrTRUB9xUYqMQOavhZhc=&previous=investUT/home&nodelevel=child&ID=1271' },
  { name: 'Fidelity Funds - Global Technology Fund A EUR', currency: 'EUR', price: '98.48', date: '29-Oct-2026', url: 'https://www.dollardex.com/SGN/?current=investUT/fundOverview&p=jHXyT+mt3wRwN5ewg6gav2g+nq3Np2F68yrJVq/Xiso=&previous=investUT/home&nodelevel=child&ID=958' },
  { name: 'Fidelity Funds China Focus Fund A SGD', currency: 'SGD', price: '1.744', date: '29-Oct-2026', url: 'https://www.dollardex.com/SGN/?current=investUT/fundOverview&p=UnZ831QpT9kB75fg7KFYaBm5BNPW5qHTRDhp63c+k5A=&previous=investUT/home&nodelevel=child&ID=1303' },
  { name: 'Fidelity Funds China Focus Fund SR-ACC SGD', currency: 'SGD', price: '2.106', date: '29-Oct-2026', url: 'https://www.dollardex.com/SGN/?current=investUT/fundOverview&p=FtC1wjitWM6kW1duXSPN+wJKZ+9YHOYjkAfOo0j8ZCM=&previous=investUT/home&nodelevel=child&ID=1856' },
  { name: 'FSSA Dividend Advantage Fund Class A Quarterly Distributing SGD', currency: 'SGD', price: '2.1062', date: '28-Oct-2026', url: 'https://www.dollardex.com/SGN/?current=investUT/fundOverview&p=hdBzYYWkpEAHQFh6zs2wCCODNPi8bZFFPjBab4TDiAc=&previous=investUT/home&nodelevel=child&ID=1172' },
  { name: 'FSSA Dividend Advantage Fund Class A Quarterly Distributing USD', currency: 'USD', price: '1.6418', date: '28-Oct-2026', url: 'https://www.dollardex.com/SGN/?current=investUT/fundOverview&p=bqhtehnQYXyPx9ZD2tkV5qSD79xh4y/OJieiOYX0a1M=&previous=investUT/home&nodelevel=child&ID=1204' },
  { name: 'Infinity US500 Stock Index Fund SGD', currency: 'SGD', price: '4.54', date: '28-Oct-2026', url: 'https://www.dollardex.com/sgn/?current=investUT/fundOverview&p=7O/TCxXyGWdKetk+c3ks0K7mExC60NA+E4ytNNGDClY=' },
  { name: 'Janus Henderson Horizon Global Technology Leaders Fund A2 Acc SGD', currency: 'SGD', price: '308.29', date: '29-Oct-2026', url: 'https://www.dollardex.com/sgn/?current=investUT/fundOverview&p=PtmFDQf77AI0xM7ZHA65/q4pkobH1tqUUAyl6nU0MaI=' },
  { name: 'JPM China Fund A Acc SGD', currency: 'SGD', price: '17.99', date: '29-Oct-2026', url: 'https://www.dollardex.com/sgn/?current=investUT/fundOverview&p=Ap03V3VPV7aAc8SGjPJ64PLNv7CF2Vi8MZeS7mnAc5M=' },
  { name: 'JPMorgan Funds US Technology A Acc SGD', currency: 'SGD', price: '140.23', date: '29-Oct-2026', url: 'https://www.dollardex.com/sgn/?current=investUT/fundOverview&p=s64V0OoNUTLlB0m8v5G1H6KM1VIQdmEZ9K8OeYUKo8k=' },
  { name: 'PIMCO GIS Income Class E (SGD Hedged) Inc SGD', currency: 'SGD', price: '7.61', date: '28-Oct-2026', url: 'https://www.dollardex.com/SGN/?current=investUT/fundOverview&p=MekyWzFYp+YLf/d56harWwIvtverpBmG8ikZZOO+LPk=&previous=investUT/home&nodelevel=child&ID=2154' },
  { name: 'Schroder China Opportunities SGD', currency: 'SGD', price: '1.513', date: '28-Oct-2026', url: 'https://www.dollardex.com/sgn/?current=investUT/fundOverview&p=YWuGyLATkZRJuRUqrmurQ1v3EOkCg0Wdhhj97HwUXs8=' },
  { name: 'Schroder ISF Greater China F Acc SGD', currency: 'SGD', price: '156.63', date: '29-Oct-2026', url: 'https://www.dollardex.com/sgn/?current=investUT/fundOverview&p=KerC/fLEPcQaFQ3CjF1GYkmoorzHl0ocIOQ+BogD8YQ=' },
  { name: 'Allianz GIF Allianz Best Styles Global Equity ET H2 SGD', currency: 'SGD', price: '27.7299', date: '29-Oct-2026', url: 'https://www.dollardex.com/SGN/?current=investUT/fundOverview&p=NCa8xOnL5QvTmEaelObCXlE478I+ed+rONsXmbVFhQQ=&previous=investUT/home&nodelevel=child&ID=2536' },
  { name: 'Schroder Emerging Markets Fund', currency: 'SGD', price: '3.01', date: '28-Oct-2026', url: 'https://www.dollardex.com/SGN/?current=investUT/fundOverview&p=daflFlEl08cBpC8ZKp4l9MINubOFSpgZBTZUf+UpbsA=&previous=investUT/home&nodelevel=child&ID=404' },
  { name: 'Schroder GEM Opportunities Fund', currency: 'SGD', price: '1.98', date: '28-Oct-2026', url: 'https://www.dollardex.com/SGN/?current=investUT/fundOverview&p=ulEWUubIufjlKUqtcNNDdcjLq0qwqyl64/OsXv1bjfE=&previous=investUT/home&nodelevel=child&ID=1652' },
];

let funds = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through to seed */ }
  return SEED_FUNDS.map((f, i) => ({ id: 'seed-' + (i + 1), status: 'seed', ...f }));
}

function saveLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(funds)); } catch (e) { /* storage full/blocked */ }
}

// Every change writes the local copy immediately, and — when a shared list
// is active — writes through to Redis after a short pause (debounced, so
// "Refresh all" does one write, not one per fund). A failed Redis write
// only shows a warning; the local copy is already saved.
function save() {
  saveLocal();
  if (listCode) scheduleRedisSave();
}

function scheduleRedisSave() {
  clearTimeout(redisSaveTimer);
  redisSaveTimer = setTimeout(saveToRedis, 500);
}

async function saveToRedis() {
  if (!listCode) return;
  try {
    const res = await fetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: listCode, funds }),
    });
    const data = await res.json();
    if (!data || data.error) throw new Error((data && data.error) || 'save failed');
  } catch (e) {
    setStatus("Couldn't save to the shared list — your changes are saved in this browser only.");
  }
}

// Loads a shared list from Redis. Returns { funds } or { error }; never throws.
async function loadSharedList(code) {
  try {
    const res = await fetch('/api/lists?u=' + encodeURIComponent(code));
    const data = await res.json();
    if (data && Array.isArray(data.funds)) return { funds: data.funds };
    return { error: (data && data.error) || 'Could not load the shared list.' };
  } catch (e) {
    return { error: 'Could not reach the shared-list store.' };
  }
}

function updateSharedUI() {
  const hasCode = !!listCode;
  document.getElementById('noListArea').hidden = hasCode;
  document.getElementById('myListArea').hidden = !hasCode;
  if (hasCode) {
    document.getElementById('listCodeText').textContent = listCode;
    const link = document.getElementById('listLink');
    link.textContent = listLink(listCode);
    link.href = listLink(listCode);
  }
}

function setActiveCode(code) {
  listCode = code;
  rememberCode(code);
  updateSharedUI();
}

function clearActiveCode() {
  listCode = null;
  forgetCode();
  updateSharedUI();
}

// Starting list, in priority order:
//   1. ?u=<code> in the address bar — the shared list for that code.
//   2. A code this browser remembers — its shared list, loaded in the
//      background while the local copy shows first.
//   3. Otherwise the local list, exactly as before.
async function initList() {
  updateSharedUI();
  const params = new URLSearchParams(location.search);
  const urlCode = (params.get('u') || '').trim().toLowerCase();
  if (urlCode) {
    if (!CODE_RE.test(urlCode)) {
      setStatus('That list link has an invalid code — showing your local list instead.');
      render();
      return;
    }
    setStatus('Loading your shared list…');
    const result = await loadSharedList(urlCode);
    if (result.funds) {
      funds = result.funds;
      saveLocal();
      setActiveCode(urlCode);
      setStatus('Loaded your shared list — changes save to the shared list and this browser.');
    } else {
      setStatus('No saved list for that code — showing your local list instead.');
    }
    render();
    return;
  }
  render();
  const code = rememberedCode();
  if (code) {
    listCode = code;
    updateSharedUI();
    const result = await loadSharedList(code);
    if (result.funds) {
      funds = result.funds;
      saveLocal();
      render();
    } else {
      setStatus("Couldn't reach the shared list — showing the copy saved in this browser.");
    }
  }
}

function setStatus(msg) { document.getElementById('status').textContent = msg || ''; }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function badge(f) {
  const map = { ok: 'ok', blocked: 'blocked', failed: 'failed', manual: 'manual', seed: 'seed' };
  const label = { ok: 'Updated', blocked: 'Blocked — open link', failed: 'Refresh failed', manual: 'Manual entry', seed: 'Seed price' }[f.status] || '—';
  return `<span class="badge ${map[f.status] || 'seed'}">${label}</span>`;
}

function visibleFunds() {
  const q = (document.getElementById('search').value || '').toLowerCase();
  const cur = document.getElementById('currencyFilter').value;
  return funds.filter(f =>
    (!q || f.name.toLowerCase().includes(q)) &&
    (!cur || f.currency === cur));
}

function render() {
  const rows = document.getElementById('fundRows');
  const list = visibleFunds();
  document.getElementById('count').textContent = `(${list.length} of ${funds.length})`;
  rows.innerHTML = list.map(f => `
    <tr>
      <td>${esc(f.name || '(name not set — refresh to read it)')}</td>
      <td class="price">${f.price ? esc(f.price) : '—'}</td>
      <td>${esc(f.currency)}</td>
      <td>${esc(f.date || '—')}</td>
      <td>${badge(f)}</td>
      <td><a href="${esc(f.url)}" target="_blank" rel="noopener">Source ↗</a></td>
      <td><div class="row-actions">
        <button class="small" data-refresh="${f.id}">Refresh</button>
        <button class="small" data-manual="${f.id}">Edit price</button>
        <button class="small" data-delete="${f.id}">Delete</button>
      </div></td>
    </tr>`).join('') || `<tr><td colspan="7">No funds match. Add one above, or reset to the seed funds.</td></tr>`;
}

async function refreshOne(fund) {
  setStatus(`Refreshing ${fund.name || fund.url}…`);
  try {
    const res = await fetch('/api/refresh?url=' + encodeURIComponent(fund.url));
    const data = await res.json();
    if (data.blocked) {
      fund.status = 'blocked';
      setStatus(`Blocked by bot detection for ${fund.name || fund.url}. Open the source link and use “Edit price” to enter it manually.`);
    } else if (data.error) {
      fund.status = 'failed';
      setStatus(`Refresh failed for ${fund.name || fund.url}: ${data.error}`);
    } else {
      if (data.name && !fund.name) fund.name = data.name;
      if (data.price) fund.price = data.price;
      if (data.date) fund.date = data.date;
      if (data.currency) fund.currency = data.currency;
      fund.status = data.lowConfidence ? 'manual' : 'ok';
      fund.lastChecked = new Date().toISOString();
      setStatus(data.lowConfidence
        ? `Updated ${fund.name} — parser confidence was low, please verify against the source link.`
        : `Updated ${fund.name}: ${data.price} ${data.currency || ''} (${data.date || 'no date shown'}).`);
    }
  } catch (e) {
    fund.status = 'failed';
    setStatus('Refresh failed — is the site running on Vercel? The /api/refresh crawler only works when deployed to Vercel, not on plain static hosting.');
  }
  save(); render();
}

async function refreshAll() {
  const btn = document.getElementById('refreshAll');
  btn.disabled = true;
  let ok = 0, blocked = 0, failed = 0;
  for (const f of funds) {
    await refreshOne(f);
    if (f.status === 'ok') ok++;
    else if (f.status === 'blocked') blocked++;
    else if (f.status === 'failed') failed++;
    // Be gentle: DollarDex rate-limits aggressive crawling.
    await new Promise(r => setTimeout(r, 1200));
  }
  btn.disabled = false;
  setStatus(`Refresh all done: ${ok} updated, ${blocked} blocked, ${failed} failed. Blocked funds keep their last price — open the link and enter it manually.`);
}

document.getElementById('fundRows').addEventListener('click', async (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  const id = btn.dataset.refresh || btn.dataset.manual || btn.dataset.delete;
  const fund = funds.find(f => f.id === id); if (!fund) return;
  if (btn.dataset.refresh) { await refreshOne(fund); }
  if (btn.dataset.manual) {
    const price = prompt('Latest price for ' + (fund.name || fund.url) + ':', fund.price || '');
    if (price === null) return;
    const date = prompt('Price date (e.g. 03-Nov-2026):', fund.date || '');
    if (date === null) return;
    fund.price = price.trim(); fund.date = date.trim(); fund.status = 'manual'; save(); render();
  }
  if (btn.dataset.delete) {
    if (confirm('Delete ' + (fund.name || fund.url) + '?')) {
      funds = funds.filter(f => f.id !== id); save(); render();
    }
  }
});

document.getElementById('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('newName').value.trim();
  const currency = document.getElementById('newCurrency').value;
  const url = document.getElementById('newUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) { alert('Please paste a full link starting with https://'); return; }
  funds.push({ id: 'fund-' + Date.now(), name, currency, price: '', date: '', url, status: 'seed' });
  save(); render(); e.target.reset();
  setStatus('Fund added. Press Refresh on its row to crawl its price.');
});

document.getElementById('refreshAll').addEventListener('click', refreshAll);

// --- Daily auto-refresh (client-side only) ---
// Manual "Refresh all" and per-fund "Refresh" are unchanged. This option adds
// one extra behaviour: a single refresh of all funds, once a day, at the time
// chosen in the time picker (browser local time, e.g. 09:00).
// It only runs while this page is open in a browser tab. It cannot refresh
// prices in the background when the page is closed, because there is no
// scheduled server job — the shared list (Upstash Redis, see "Shared list"
// above) only stores the list; nothing refreshes it on a schedule.
const AUTO_KEY = 'unit-trust-auto-refresh-v1';
let autoTimer = null;
let autoNextAt = null;

function loadAutoSettings() {
  try { return JSON.parse(localStorage.getItem(AUTO_KEY)) || {}; } catch (e) { return {}; }
}
function saveAutoSettings() {
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify({
      enabled: document.getElementById('autoRefresh').checked,
      time: document.getElementById('autoTime').value || '09:00',
    }));
  } catch (e) { /* storage blocked */ }
}
function showAutoNext() {
  const el = document.getElementById('autoNext');
  el.textContent = autoNextAt
    ? 'Next daily auto-refresh: ' + autoNextAt.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : '';
}
// Next occurrence of the chosen HH:MM in browser local time (today if it is
// still ahead, otherwise tomorrow).
function nextDailyRun(hhmm) {
  const [h, m] = (hhmm || '09:00').split(':').map(Number);
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next;
}
function stopAuto() {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  autoNextAt = null; showAutoNext();
}
function scheduleAuto() {
  stopAuto();
  const time = document.getElementById('autoTime').value || '09:00';
  autoNextAt = nextDailyRun(time); showAutoNext();
  autoTimer = setTimeout(async () => {
    await refreshAll();
    // Re-arm for the following day.
    if (document.getElementById('autoRefresh').checked) scheduleAuto();
  }, autoNextAt.getTime() - Date.now());
  setStatus(`Daily auto-refresh on: all funds will refresh at ${time} while this page stays open.`);
}
const autoSettings = loadAutoSettings();
document.getElementById('autoRefresh').checked = !!autoSettings.enabled;
if (autoSettings.time) document.getElementById('autoTime').value = autoSettings.time;
document.getElementById('autoRefresh').addEventListener('change', (e) => {
  saveAutoSettings();
  if (e.target.checked) scheduleAuto(); else { stopAuto(); setStatus('Daily auto-refresh off.'); }
});
document.getElementById('autoTime').addEventListener('change', () => {
  saveAutoSettings();
  if (document.getElementById('autoRefresh').checked) scheduleAuto();
});
if (document.getElementById('autoRefresh').checked) scheduleAuto();
document.getElementById('search').addEventListener('input', render);
document.getElementById('currencyFilter').addEventListener('change', render);

document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(funds, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'unit-trust-funds.json'; a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data) || !data.every(f => f.url)) throw new Error('bad file');
    funds = data.map((f, i) => ({ id: f.id || 'import-' + i, status: f.status || 'seed', ...f }));
    save(); render(); setStatus(`Imported ${funds.length} funds.`);
  } catch (err) { alert('Could not import that file — it should be a JSON list of funds with at least a url.'); }
  e.target.value = '';
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (!confirm('Reset to the original 17 DollarDex seed funds? Your added funds will be lost unless you exported them.')) return;
  funds = SEED_FUNDS.map((f, i) => ({ id: 'seed-' + (i + 1), status: 'seed', ...f }));
  save(); render(); setStatus('Reset to seed funds.');
});

// --- Shared list (Upstash Redis) ------------------------------------------
// "Create my list" stores the current funds under a fresh random code and
// gives this list a personal link (?u=<code>). Opening that link on any
// device loads the same list; every change after that saves to Redis and
// to this browser. The link is the key — anyone with it can open and edit
// the list — and if it is lost, the list is lost unless a browser still
// remembers the code. Two devices editing at once: last write wins.

document.getElementById('createListBtn').addEventListener('click', async () => {
  const btn = document.getElementById('createListBtn');
  btn.disabled = true;
  setStatus('Creating your shared list…');
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ funds }),
    });
    const data = await res.json();
    if (!data || !data.code) throw new Error((data && data.error) || 'Could not create a shared list.');
    setActiveCode(data.code);
    history.replaceState(null, '', '?u=' + data.code);
    setStatus('Your shared list is ready — open the link on any device to load this list.');
  } catch (e) {
    setStatus("Couldn't create a shared list: " + e.message + ' Nothing changed — your list is still saved in this browser.');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('copyLinkBtn').addEventListener('click', async () => {
  if (!listCode) return;
  const link = listLink(listCode);
  try {
    await navigator.clipboard.writeText(link);
    setStatus('Personal link copied.');
  } catch (e) {
    setStatus("Copy didn't work in this browser — long-press the link to copy it: " + link);
  }
});

document.getElementById('localOnlyBtn').addEventListener('click', () => {
  clearActiveCode();
  history.replaceState(null, '', location.pathname);
  setStatus('This browser is now using its own local list only. The shared copy is still saved under its code — open its link to use it again.');
});

document.getElementById('openListForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('openCode');
  const code = input.value.trim().toLowerCase();
  if (!CODE_RE.test(code)) {
    setStatus("That code doesn't look right — a list code is 16 lowercase letters and digits.");
    return;
  }
  setStatus('Loading that shared list…');
  const result = await loadSharedList(code);
  if (result.funds) {
    funds = result.funds;
    setActiveCode(code);
    history.replaceState(null, '', '?u=' + code);
    saveLocal();
    render();
    setStatus('Loaded your shared list — changes save to the shared list and this browser.');
  } else {
    setStatus('No saved list for that code — your current list is unchanged.');
  }
});

initList();
