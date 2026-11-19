// Parser for FundSingapore fund detail pages (fundsingapore.com).
// Example URL:
//   https://www.fundsingapore.com/fund-library/fund-details?id=F0HKG06XT2
// That link is the Allianz Global High Payout SGD fund
// (ISIN SG9999002224) — the same fund already tracked via DollarDex
// (0.698 SGD, 17-Nov-2026) and Fundsupermart (0.695 SGD, 18 Nov 2026),
// so FundSingapore is a backup source for it.
//
// FundSingapore is a joint initiative of IMAS and LIA (Investment
// Management Association of Singapore / Life Insurance Association).
// Its pages are Next.js with the fund data server-rendered inside
// __NEXT_DATA__ as props.pageProps.ssrFundDetails, including
// LastPrice { Date, Value, Currency: { Id } }.
//
// STATUS (verified 19 Nov 2026): a plain server fetch of the detail page
// returns HTTP 200 with the full page, no bot challenge. The embedded
// data shows Name "Allianz Global High Payout SGD", ISIN SG9999002224,
// LastPrice 0.698 SGD dated 2026-11-17 — matching DollarDex exactly.
//
// Parse patterns below are from that REAL page, not guessed.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatIsoDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export const fundsingapore = {
  id: 'fundsingapore',
  domains: ['fundsingapore.com'],

  parse(html, url) {
    // The fund data is server-rendered JSON in __NEXT_DATA__.
    const nextData = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
    if (!nextData) return { name: '', price: '', currency: '', date: '', lowConfidence: false, source: url };

    let details;
    try {
      const data = JSON.parse(nextData[1]);
      details = data?.props?.pageProps?.ssrFundDetails;
    } catch {
      return { name: '', price: '', currency: '', date: '', lowConfidence: false, source: url };
    }
    if (!details) return { name: '', price: '', currency: '', date: '', lowConfidence: false, source: url };

    const name = String(details.Name || details.LegalName || '').trim();
    const lastPrice = details.LastPrice || {};
    const value = lastPrice.Value;
    const price = (value === undefined || value === null || value === '') ? '' : String(value);
    const currency = String(lastPrice.Currency?.Id || details.Currency?.Id || '').toUpperCase();
    const date = formatIsoDate(lastPrice.Date);

    return { name, price, currency, date, lowConfidence: false, source: url };
  },
};
