// Vercel serverless function: GET /api/timeseries?ids=F0HKG06XT2,F0HKG062P2&start=YYYY-MM-DD&end=YYYY-MM-DD
// Proxies FundSingapore's own timeseries API (fundsingapore-api.newwealth.cloud)
// so the browser does not hit cross-origin blocks. The API answers a plain
// server GET with no login or key (verified 27 Nov 2026) and returns daily
// growth values rebased to 100 at the start date — exactly what a comparison
// chart needs. The multi-fund form returns one object keyed by fund id.
//
// Response (HTTP 200):
//   { funds: { <id>: { points: [{ date, value }], ... } }, ... }
//     — points is [] when FundSingapore has no series for that fund
//       (e.g. Janus F00000WJQK, whose price data is also stale there).
//   { error: '...' } — bad parameters, or the upstream API could not be
//     reached / returned an error. Never invents a series.
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

const API_BASE = 'https://fundsingapore-api.newwealth.cloud/api/v2/funds/imas_fund_sg';

const ID_RE = /^[A-Za-z0-9]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 20 funds: the page allows a whole comparison list in one request; there
// is no upstream limit at 10 (or 20) — the cap is only a guard against
// absurd requests.
const MAX_IDS = 20;

export default async function handler(req, res) {
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

  const qs = ids.map(id => `id=${encodeURIComponent(id)}`).join('&');
  const url = `${API_BASE}/timeseries?calculate=true&currencyId=BAS&${qs}&startDate=${start}&endDate=${end}`;

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return res.status(200).json({ error: 'Could not reach FundSingapore (' + (e.cause?.code || 'network error') + '). Try again.' });
  }
  if (!upstream.ok) {
    return res.status(200).json({ error: `FundSingapore returned HTTP ${upstream.status}.` });
  }

  let data;
  try {
    data = await upstream.json();
  } catch (e) {
    return res.status(200).json({ error: 'FundSingapore returned a response that could not be read as JSON.' });
  }

  // Normalise into one shape per fund: { points: [{ date, value }] }.
  // The upstream response is keyed by fund id; a fund with no series
  // still appears, with an empty HistoryDetail array.
  const funds = {};
  for (const id of ids) {
    let points = [];
    try {
      const security = data?.[id]?.TimeSeries?.Security?.[0];
      const history = security?.GrowthSeries?.[0]?.HistoryDetail || [];
      points = history
        .filter(p => p && typeof p.Value === 'number' && typeof p.EndDate === 'string')
        .map(p => ({ date: p.EndDate.slice(0, 10), value: p.Value }));
    } catch (e) {
      points = [];
    }
    funds[id] = { points };
  }
  // A fixed start/end only changes when a new trading day arrives, so a
  // successful response is safe to cache for an hour (Vercel CDN). Error
  // responses above set no cache header and are never cached.
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({ funds });
}
