// Parser for Singlife fund factsheets (FE fundinfo, digital.feprecisionplus.com).
// Example URL (shared by Kk 19 Nov 2026):
//   https://digital.feprecisionplus.com/singlifesimnav2/factsheethtml/en-gb/singlife/?TypeCode=FSG:Z867&specialunittype=CHDG&...
// That link is the FSSA Dividend Advantage Fund Class A Quarterly
// Distributing USD (ISIN SG9999002083) — one of the funds already tracked
// via DollarDex, with an FSM backup added the same day.
//
// STATUS (verified 19 Nov 2026): the factsheet page itself CANNOT be
// parsed — it is a JS app and a server fetch returns only an 85 KB shell
// with "no results" and no fund data; the price appears in a real browser
// only after the app loads its data. The browser shows Latest Price
// $1.5808 USD, Price Date 17/11/2026, no login needed.
// So this parser does NOT parse page HTML. Instead it calls the same
// data service Kk's GAS uses, found in his singlifefund() function:
//   GET digitalfundservice.feprecisionplus.com/FundDataService.svc/GetUnitList?jsonString={...}
//       → a JSON string (double-encoded JSON) whose DataList[0] holds:
//         Price.Price.Amount (number), Price.Price.Currency,
//         Price.PriceDate ("2026-11-17T00:00:00"),
//         Price.Name, Price.CitiCode.
// The fund is identified by the TypeCode query parameter of the factsheet
// URL (FSG:Z867 → code Z867), passed through as CodesList ["FSG:Z867"].
// Verified 19 Nov 2026 from a plain server fetch: HTTP 200, ~1.7s,
// Amount 1.5808 USD, PriceDate 2026-11-17 — an exact match with the
// browser and with the FSM price in the sheet (1.5808, 18 Nov 2026).
// Caveat: this is FE fundinfo's internal data service for Singlife — it
// could change without notice. If it stops working this parser returns
// no price (never a guess) and the caller keeps the old price.
//
// This parser is API-based: it defines fetch(url) instead of parse(html).
// api/refresh.js calls fetch() when a parser has one, and skips the page
// fetch entirely for that site.

const API_BASE = 'https://digitalfundservice.feprecisionplus.com/FundDataService.svc/GetUnitList';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// Same request parameters Kk's GAS sends (singlifefund), with only the
// fund code swapped in. ProjectName/Theme pick the Singlife factsheet
// project; ToolId 18 is the factsheet tool.
function buildUrl(code) {
  const jsonString = {
    ProjectName: 'singlifesimnav2',
    LanguageCode: 'en-gb',
    UserType: '',
    Region: '',
    LanguageId: '1',
    Theme: 'singlife',
    CodesList: [`FSG:${code}`],
    SelectedSpecialUnitType: 'CHDG',
    OverrideDocumentCountryCode: null,
    PerformanceCurrency: null,
    Category: null,
    FilteringOptions: {},
    DistributionCountries: {},
    GRSProjectId: '95400086',
    ToolId: '18',
    OverridenThemeName: 'singlife',
    ForSaleIn: '',
    ValidateFeResearchAccess: false,
    HasFeResearchFullAccess: false,
    EnableSedolSearch: 'false',
  };
  return `${API_BASE}?jsonString=${encodeURIComponent(JSON.stringify(jsonString))}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(iso) {
  // "2026-11-17T00:00:00" → "17 Nov 2026". The date part is the NAV date.
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const EMPTY = (url) => ({ name: '', price: '', currency: '', date: '', lowConfidence: false, source: url });

async function fetchOnce(code) {
  const res = await fetch(buildUrl(code), {
    headers: HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    return { blocked: true };
  }
  if (!res.ok) return null;
  // The body is a JSON string containing JSON text — parse twice.
  const text = await res.text();
  let data;
  try {
    const outer = JSON.parse(text);
    data = typeof outer === 'string' ? JSON.parse(outer) : outer;
  } catch (e) {
    return null;
  }
  const item = data && Array.isArray(data.DataList) ? data.DataList[0] : null;
  return item || null;
}

export const singlife = {
  id: 'singlife',
  domains: ['digital.feprecisionplus.com'],

  async fetch(url) {
    // The fund code comes from the TypeCode query parameter of the
    // factsheet URL: ?TypeCode=FSG:Z867 → Z867.
    let code = '';
    try {
      const typeCode = new URL(url).searchParams.get('TypeCode') || '';
      const m = typeCode.match(/^FSG:(.+)$/i);
      code = m ? m[1].trim() : typeCode.trim();
    } catch (e) { /* fall through to EMPTY */ }
    if (!code) return EMPTY(url);

    // The service sometimes answers before the data is ready (Kk's GAS
    // retries for the same reason); one retry on an empty result.
    let item = await fetchOnce(code);
    if (item && item.blocked) return { blocked: true };
    if (!item) {
      await new Promise(r => setTimeout(r, 500));
      item = await fetchOnce(code);
      if (item && item.blocked) return { blocked: true };
    }
    if (!item) return EMPTY(url);

    const priceObj = item.Price || {};
    const amount = priceObj.Price && typeof priceObj.Price.Amount === 'number'
      ? priceObj.Price.Amount : null;
    if (amount === null || amount === undefined) return EMPTY(url);

    return {
      name: (priceObj.Name || '').trim(),
      price: String(amount),
      currency: ((priceObj.Price && priceObj.Price.Currency) || '').toUpperCase(),
      date: formatDate(priceObj.PriceDate || ''),
      lowConfidence: false,
      source: url,
    };
  },
};
