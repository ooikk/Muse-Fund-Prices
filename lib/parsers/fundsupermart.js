// Parser for Fundsupermart (FSM Global) fund factsheet pages (fsm.global).
// Example URL:
//   https://fsm.global/sg/funds/factsheet/FITECH/Fidelity-Global-Technology-A-EUR
// That link is the Fidelity Global Technology A-EUR fund
// (ISIN LU0099574567) — the same fund already tracked via DollarDex and
// Fidelity, so this parser is a third backup source for it.
//
// STATUS (verified 19 Nov 2026): the factsheet page itself CANNOT be
// parsed — it is an Angular app and a server fetch returns only a 5.8 KB
// shell with no fund data; the price appears in a real browser only after
// ~5s of JavaScript loading. So this parser does NOT parse page HTML.
// Instead it calls the site's own REST API, found in the site's JS bundle:
//   GET  /sg/rest/fund/get-active-fund-info?sedolnumber={CODE}&includedRestrictedFund=false
//        → fundName, fundCurrencyCode, fmFundCode (the ISIN), manager
//   POST /sg/rest/fund/get-factsheet-price-date-data/{CODE}  (empty JSON body)
//        → { dailyPrice, lastUpdateDate (epoch ms) }
// Both endpoints answer 200 to a plain server fetch with no login or key
// (verified 19 Nov 2026). The price returned matched the browser exactly:
// dailyPrice 93.53, NAV date 18 Nov 2026. The fund code is the first path
// segment after /funds/factsheet/ in the URL. The price date is the UTC
// date of lastUpdateDate (the page's NAV date).
// Caveat: this is FSM's undocumented internal API — it could change or gain
// auth without notice. If it stops working this parser returns no price
// (never a guess) and the caller keeps the old price.
//
// This parser is API-based: it defines fetch(url) instead of parse(html).
// api/refresh.js calls fetch() when a parser has one, and skips the page
// fetch entirely for that site.

const API_BASE = 'https://fsm.global/sg/rest/fund';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function utcDate(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const EMPTY = (url) => ({ name: '', price: '', currency: '', date: '', lowConfidence: false, source: url });

export const fundsupermart = {
  id: 'fundsupermart',
  domains: ['fsm.global'],

  async fetch(url) {
    const m = String(url).match(/\/funds\/factsheet\/([A-Za-z0-9]+)/i);
    const code = m ? m[1].toUpperCase() : '';
    if (!code) return EMPTY(url);

    // Price first: if there is no price, nothing else matters.
    const priceRes = await fetch(`${API_BASE}/get-factsheet-price-date-data/${code}`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(20000),
    });
    if (priceRes.status === 401 || priceRes.status === 403 || priceRes.status === 429) {
      return { blocked: true };
    }
    if (!priceRes.ok) return EMPTY(url);
    const priceData = await priceRes.json();
    const price = (priceData && typeof priceData.dailyPrice === 'number')
      ? String(priceData.dailyPrice) : '';
    if (!price) return EMPTY(url);

    const infoRes = await fetch(`${API_BASE}/get-active-fund-info?sedolnumber=${encodeURIComponent(code)}&includedRestrictedFund=false`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(20000),
    });
    if (infoRes.status === 401 || infoRes.status === 403 || infoRes.status === 429) {
      return { blocked: true };
    }
    if (!infoRes.ok) return EMPTY(url);
    const info = await infoRes.json();

    return {
      name: (info.fundName || '').trim(),
      price,
      currency: (info.fundCurrencyCode || '').toUpperCase(),
      date: priceData.lastUpdateDate ? utcDate(priceData.lastUpdateDate) : '',
      lowConfidence: false,
      source: url,
    };
  },
};
