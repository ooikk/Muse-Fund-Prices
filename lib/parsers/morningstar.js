// Parser for Morningstar fund quote pages (global.morningstar.com).
// Example URL: https://global.morningstar.com/en-ea/investments/funds/0P00000D6I/quote
// That link is the Fidelity Funds - Global Technology Fund A-DIST-EUR
// (ISIN LU0099574567) — the same fund already tracked via DollarDex,
// so this parser is the backup source for it.
//
// STATUS — READ BEFORE TRUSTING THIS PARSER (verified 18 Nov 2026):
// Morningstar's fund pages cannot currently be fetched from a server:
// every fund URL answers HTTP 202 with an AWS WAF JavaScript challenge
// page (AwsWafIntegration / challenge.js). The Sec-Fetch headers that
// got past DollarDex's Akamai block do NOT help here — the challenge
// needs a real browser to run JavaScript, and cookies from the homepage
// do not help either. The page itself loads fine in a real browser:
// the quote shows "NAV 93.18", currency EUR, date "Nov 17, 2026"
// (Chart tab: "End of Date as of Nov 17, 2026").
//   The page's data comes from Morningstar's sal-service API
//   (api-global.morningstar.com/sal-service/v1/fund/quote/<secid>),
//   which answers 401 Unauthorized without an apikey. That key is NOT
//   in the homepage HTML or its JS bundles — it only appears in the
//   quote page's own scripts / network calls, which a server fetch
//   cannot see because of the WAF challenge.
//   To make this parser live, capture ONE sal-service request URL from
//   a browser's Network tab while the quote page loads, take the
//   apikey from it, and store it as the MORNINGSTAR_API_KEY env var
//   on Vercel; then the fetcher (api/refresh.js) can call the API
//   directly instead of the page. Until then this parser correctly
//   reports the WAF block (blocked: true) and never overwrites a
//   good price with a blank one.
//
// Parse patterns below are from the REAL rendered page, verified in a
// browser on 18 Nov 2026 — not guessed: fund name in the title,
// "NAV 93.18" in the Overview block, date as "Nov 17, 2026".

import { toText, cleanName, titleOrH1, findDate, findCurrency } from './helpers.js';

export const morningstar = {
  id: 'morningstar',
  domains: ['global.morningstar.com'],

  parse(html, url) {
    // AWS WAF challenge page instead of the fund page.
    if (/awswaf|challenge-container|AwsWafIntegration/i.test(html)) {
      return { name: '', price: '', currency: '', date: '', lowConfidence: false, source: url, blocked: true };
    }
    const text = toText(html);
    const name = cleanName(titleOrH1(html), ['Morningstar']).trim();

    // Price: the Overview block shows "NAV 93.18".
    const nav = text.match(/NAV\s*([0-9]+(?:,[0-9]{3})*\.[0-9]{2,4})/i);
    const price = nav ? nav[1].replace(/,/g, '') : '';

    // Currency usually follows the price: "93.18 EUR".
    const curAfter = text.match(/[0-9]\.[0-9]{2,4}\s*(SGD|USD|EUR|GBP|AUD|HKD)\b/);
    const currency = curAfter ? curAfter[1].toUpperCase() : findCurrency(text);

    // Date: "End of Date as of Nov 17, 2026" (month first).
    const monthFirst = text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s*\d{4}/i);
    const date = monthFirst ? monthFirst[0] : findDate(text);

    return { name, price, currency, date, lowConfidence: false, source: url };
  },
};
