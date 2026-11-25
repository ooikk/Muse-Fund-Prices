// Parser for Janus Henderson fund product pages (janushenderson.com).
// Example URL:
//   https://www.janushenderson.com/en-sg/investor/product/janus-henderson-horizon-global-technology-leaders-fund/?identifier=LU1316542783
// That link is the Janus Henderson Horizon Global Technology Leaders
// Fund, share class A2 SGD (ISIN LU1316542783) — the same fund already
// tracked via DollarDex (270.46 SGD, 24-Nov-2026), Fundsupermart
// (HEN047) and Singlife (E7CD), so Janus Henderson's own page is a
// backup source for it. Each share class is its own page keyed by its
// ISIN in the ?identifier= parameter.
//
// STATUS (verified 25 Nov 2026): a plain server fetch of the product
// page returns HTTP 200 with the full page, no bot challenge, and the
// NAV is server-rendered in the page HTML (not loaded by JavaScript):
//   <span class="notranslate">NAV</span>
//   <strong class="notranslate">SGD 270.46</strong>
//   As of <span class='notranslate'>2026/11/24</span>
// The selected share class is in the share-class <select>:
//   <option value="LU1316542783" selected='selected'>Share Class -
//   <span class="notranslate">A2 SGD</span></option>
//
// Parse patterns below are from that REAL page, not guessed.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatSlashDate(slash) {
  const m = String(slash || '').match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export const janushenderson = {
  id: 'janushenderson',
  domains: ['janushenderson.com'],

  parse(html, url) {
    // Fund name: the page <h1> is the fund name without the manager
    // prefix, e.g. "Horizon Global Technology Leaders Fund". The
    // selected share class (e.g. "A2 SGD") comes from the share-class
    // <select>; prefix "Janus Henderson " so the name matches the
    // other sources for the same fund in the sheet.
    const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const fundName = (h1?.[1] || '').trim();
    const selected = html.match(/<option[^>]*selected=(?:'selected'|"selected"|selected)[^>]*>\s*Share Class -\s*<span[^>]*>([^<]+)<\/span>/i);
    const shareClass = (selected?.[1] || '').trim();
    const name = fundName
      ? `Janus Henderson ${fundName}${shareClass ? ' ' + shareClass : ''}`.trim()
      : '';

    // Price: the NAV block, "NAV" label followed by a <strong> with
    // "<CURRENCY> <price>". Anchored to the NAV label so the 1-day
    // change block below it (which also has a <strong> with a currency
    // amount, e.g. "SGD -4.76 (-1.73%)") is never mistaken for the NAV.
    const nav = html.match(/<span class="notranslate">NAV<\/span>[\s\S]{0,300}?<strong class="notranslate">\s*([A-Z]{3})\s+([0-9][0-9,]*\.[0-9]{2,4})<\/strong>/i);
    const currency = nav ? nav[1].toUpperCase() : '';
    const price = nav ? nav[2].replace(/,/g, '') : '';

    // Date: "As of <span class='notranslate'>2026/11/24</span>" right
    // after the NAV. The same date also appears under the 1-day change.
    const asOf = html.match(/As of\s*<span class='notranslate'>\s*(\d{4}\/\d{2}\/\d{2})\s*<\/span>/i);
    const date = formatSlashDate(asOf?.[1] || '');

    return { name, price, currency, date, lowConfidence: false, source: url };
  },
};
