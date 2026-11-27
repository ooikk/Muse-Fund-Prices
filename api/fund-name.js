// Vercel serverless function: GET /api/fund-name?id=F0HKG06XT2
// Returns the fund's LegalName from FundSingapore's fund detail page.
// The page is Next.js with the fund data server-rendered in __NEXT_DATA__
// (props.pageProps.ssrFundDetails) and answers a plain server fetch with
// HTTP 200, no bot block (verified 27 Nov 2026: F0HKG062RW returns
// LegalName "Schroder Emerging Markets Fund", ISIN SG9999000251).
//
// Response (HTTP 200): { name: "..." } — or { error: "..." } when the
// page cannot be reached, has no fund data, or carries no name. Never
// invents a name.
//
// This file has no dependencies and no build step, so it deploys as-is
// on Vercel.

const ID_RE = /^[A-Za-z0-9]+$/;

export default async function handler(req, res) {
  const id = String(req.query?.id || '').trim().toUpperCase();
  if (!id || !ID_RE.test(id)) {
    return res.status(400).json({ error: 'A valid FundSingapore fund ID is required (id=F0HKG06XT2).' });
  }

  const url = `https://www.fundsingapore.com/fund-library/fund-details?id=${encodeURIComponent(id)}`;

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return res.status(200).json({ error: 'Could not reach FundSingapore (' + (e.cause?.code || 'network error') + ').' });
  }
  if (!upstream.ok) {
    return res.status(200).json({ error: `FundSingapore returned HTTP ${upstream.status}.` });
  }

  let html;
  try {
    html = await upstream.text();
  } catch (e) {
    return res.status(200).json({ error: 'FundSingapore returned a page that could not be read.' });
  }

  const nextData = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!nextData) {
    return res.status(200).json({ error: 'FundSingapore page did not contain fund data.' });
  }

  let details;
  try {
    details = JSON.parse(nextData[1])?.props?.pageProps?.ssrFundDetails;
  } catch (e) {
    return res.status(200).json({ error: 'FundSingapore page data could not be read.' });
  }
  const name = String(details?.LegalName || details?.Name || '').trim();
  if (!name) {
    return res.status(200).json({ error: 'No fund name found for this ID.' });
  }

  // Fund names rarely change; cache a day on the Vercel CDN.
  // (Vercel-CDN-Cache-Control, not plain Cache-Control — Vercel strips
  // s-maxage from Cache-Control on function responses; see timeseries.js.)
  res.setHeader('Vercel-CDN-Cache-Control', 's-maxage=86400, stale-while-revalidate=86400');
  return res.status(200).json({ name });
}
