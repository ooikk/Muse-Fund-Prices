// Vercel serverless function: GET /api/timeseries?ids=F0HKG06XT2,F0HKG062P2&start=YYYY-MM-DD&end=YYYY-MM-DD
// Proxies FundSingapore's own timeseries API (fundsingapore-api.newwealth.cloud)
// so the browser does not hit cross-origin blocks. The API answers a plain
// server GET with no login or key (verified 27 Nov 2026) and returns daily
// growth values rebased to 100 at the start date — exactly what a comparison
// chart needs.
//
// Fan-out, not one multi-fund call: FundSingapore's multi-fund form
// processes its ids ONE AFTER ANOTHER, ~2s each — measured live 27 Nov
// 2026: 1 fund 2.4s, 3 funds 5.1s, 6 funds 11.7s — so a 15–17 fund list took ~30s and blew
// past the 25s upstream timeout. The single-fund form takes ~2s per fund
// too, but the calls run in parallel: 6 at once took 2.7s, 18 at once
// 3.1s, all HTTP 200. So this endpoint fires one single-fund request per
// id concurrently and combines the results. Verified live 27 Nov 2026:
// single- and multi-fund responses carry byte-identical point arrays for
// the same ids and dates.
//
// Response (HTTP 200):
//   { funds: { <id>: { points: [{ date, value }], ... } }, ... }
//     — points is [] when FundSingapore has no series for that fund
//       (e.g. Janus F00000WJQK, whose price data is also stale there),
//       and also when that fund's own upstream call fails while others
//       succeed — the rest of the comparison still plots.
//   { error: '...' } — bad parameters, or the upstream API could not be
//     reached / returned an error for EVERY fund. Never invents a series.
//
// Notes the caller must respect:
// - Each series is in that fund's own base currency (currencyId=BAS).
//   The chart compares own-currency growth; there is no FX conversion.
// - This is FundSingapore's undocumented internal API. It could change or
//   gain auth without notice; if it stops working this endpoint returns
//   an error and the page shows it, never a guessed chart.
//
// This file has no dependencies and no build step, so it deploys as-is
// on Vercel.

const API_BASE = 'https://fundsingapore-api.newwealth.cloud/api/v2/imas_fund_sg';

const ID_RE = /^[A-Za-z0-9]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 20 funds: the page allows a whole comparison list in one request; there
// is no upstream limit at 10 (or 20) — the cap is only a guard against
// absurd requests.
const MAX_IDS = 20;

const UPSTREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

// Classify a failed single-fund fetch into the exact user-facing error
// text the old single-call code returned, so the page's timeout-vs-
// network distinction keeps working.
function errorText(e) {
  // AbortSignal.timeout aborts with a TimeoutError, so a slow upstream
  // and a genuine connection failure can be told apart — the page
  // retries either way, but the user deserves the true reason.
  if (e && e.name === 'TimeoutError') {
    return 'FundSingapore took longer than 25 seconds to answer. Try again.';
  }
  if (e && typeof e.httpStatus === 'number') {
    return `FundSingapore returned HTTP ${e.httpStatus}.`;
  }
  if (e && e.badJson) {
    return 'FundSingapore returned a response that could not be read as JSON.';
  }
  return 'Could not reach FundSingapore (' + (e?.cause?.code || 'network error') + '). Try again.';
}

// Fetch one fund's series from the single-fund endpoint and normalise it
// to [{ date, value }]. Rejects (classified by errorText) on timeout,
// HTTP error, or unreadable JSON.
async function fetchOneFund(id, start, end) {
  const url = `${API_BASE}/funds/timeseries/${encodeURIComponent(id)}?calculate=true&currencyId=BAS&startDate=${start}&endDate=${end}&index=false`;
  let upstream;
  upstream = await fetch(url, {
    headers: UPSTREAM_HEADERS,
    // 25s per fund: a single-fund call takes ~2s, so this is now ample
    // headroom. It must stay below the browser's 30s timeout in
    // compare.js, or the page gives up before the server answers.
    signal: AbortSignal.timeout(25000),
  });
  if (!upstream.ok) {
    const err = new Error(`FundSingapore returned HTTP ${upstream.status}.`);
    err.httpStatus = upstream.status;
    throw err;
  }
  let data;
  try {
    data = await upstream.json();
  } catch (e) {
    const err = new Error('FundSingapore returned a response that could not be read as JSON.');
    err.badJson = true;
    throw err;
  }
  // Normalise: the single-fund response carries one Security whose
  // GrowthSeries holds the daily HistoryDetail; a fund with no series
  // still appears, with an empty HistoryDetail array.
  const security = data?.TimeSeries?.Security?.[0];
  const history = security?.GrowthSeries?.[0]?.HistoryDetail || [];
  return history
    .filter(p => p && typeof p.Value === 'number' && typeof p.EndDate === 'string')
    .map(p => ({ date: p.EndDate.slice(0, 10), value: p.Value }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET is supported.' });
  }

  const idsParam = String(req.query?.ids || '');
  const start = String(req.query?.start || '');
  const end = String(req.query?.end || '');

  const ids = [...new Set(idsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))];
  if (ids.length === 0) {
    return res.status(400).json({ error: 'At least one FundSingapore fund ID is required (ids=F0HKG06XT2,...).' });
  }
  if (ids.length > MAX_IDS) {
    return res.status(400).json({ error: `At most ${MAX_IDS} funds per request.` });
  }
  if (ids.some(id => !ID_RE.test(id))) {
    return res.status(400).json({ error: 'Fund IDs must be letters and digits only.' });
  }
  if (!DATE_RE.test(start) || !DATE_RE.test(end) || start > end) {
    return res.status(400).json({ error: 'A valid start and end date are required (YYYY-MM-DD, start on or before end).' });
  }

  // Fire every fund's request at once and combine the results.
  // allSettled (not all): one fund failing must not lose the others.
  const settled = await Promise.allSettled(ids.map(id => fetchOneFund(id, start, end)));

  const funds = {};
  let failures = 0;
  let firstError = null;
  for (let i = 0; i < ids.length; i++) {
    const result = settled[i];
    if (result.status === 'fulfilled') {
      funds[ids[i]] = { points: result.value };
    } else {
      failures++;
      if (!firstError) firstError = errorText(result.reason);
      // A fund whose own call failed behaves exactly like a fund with no
      // series (Janus): present, with no points, so the page shows
      // "No data" for it instead of failing the whole comparison.
      funds[ids[i]] = { points: [] };
    }
  }
  if (failures === ids.length) {
    // Nothing at all came back — same error response as the old code.
    return res.status(200).json({ error: firstError });
  }
  // A fixed start/end only changes when a new trading day arrives, so a
  // successful response is safe to cache for an hour on the Vercel CDN.
  // NOTE: plain Cache-Control s-maxage does NOT work here — Vercel strips
  // s-maxage from Cache-Control on function responses and substitutes its
  // "public, max-age=0, must-revalidate" default (verified live 27 Nov
  // 2026: MISS, Age 0). Vercel-CDN-Cache-Control is the header the CDN
  // actually honours; it is consumed by the CDN, not sent to the browser.
  // Error responses above set no cache header and are never cached.
  // A PARTIAL response (one fund failed) is not cached either: the
  // failure may be transient, and a cached [] would keep that fund at
  // "No data" for an hour even though a retry would fetch it.
  if (failures === 0) {
    res.setHeader('Vercel-CDN-Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  }
  return res.status(200).json({ funds });
}
