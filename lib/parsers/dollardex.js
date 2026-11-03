// Parser for DollarDex fund overview pages.
// Example URL: https://www.dollardex.com/sgn/?current=investUT/fundOverview&p=...
// This was the first parser and is the pattern to copy for a new site:
//  - id: short name, used in logs and in the JSON "parser" field.
//  - domains: hostnames this parser handles (matched as a suffix, so
//    "www.dollardex.com" and "dollardex.com" both match).
//  - parse(html, url): return { name, price, currency, date, lowConfidence }.
//    price must be a plain number string without commas or currency symbols
//    (e.g. "16.576"), or '' if no reliable price was found.

import { toText, cleanName, titleOrH1, findDate, findCurrency } from './helpers.js';

export const dollardex = {
  id: 'dollardex',
  domains: ['dollardex.com'],

  parse(html, url) {
    const text = toText(html);
    const name = cleanName(titleOrH1(html), ['DollarDex', 'iFAST'])
      .replace(/\s*:\s*Fund Overview.*$/i, '')
      .trim();
    const date = findDate(text);

    // Price: ordered patterns, most specific first.
    const patterns = [
      /(?:NAV|Net Asset Value)[^0-9]{0,30}?([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2,4}|[0-9]+\.[0-9]{2,4})/i,
      /(?:Latest Price|Fund Price|Price)[^0-9A-Z]{0,30}?([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2,4})/i,
      /\b(?:SGD|USD|EUR|GBP|AUD|HKD)\s*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2,4})\b/,
    ];
    let price = '';
    let lowConfidence = false;
    for (const re of patterns) {
      const m = text.match(re);
      if (m) { price = m[1].replace(/,/g, ''); break; }
    }
    if (!price) {
      // Last resort: a decimal that appears right after a currency code
      // anywhere in the page. Mark it low-confidence so the caller asks
      // the user (or GAS log) to verify it against the source link.
      const m = text.match(/\b([0-9]+\.[0-9]{2,4})\b/);
      if (m) { price = m[1]; lowConfidence = true; }
    }

    return { name, price, currency: findCurrency(text), date, lowConfidence, source: url };
  },
};
