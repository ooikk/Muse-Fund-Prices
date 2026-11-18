// Parser for Fidelity UK fund factsheet pages (fidelity.co.uk).
// Example URL:
//   https://www.fidelity.co.uk/factsheet-data/factsheet/LU0099574567-global-technology-fund/portfolio
// That link is the Fidelity Funds - Global Technology Fund A-DIST-EUR
// (ISIN LU0099574567) — the same fund as the Morningstar link
// (global.morningstar.com/.../0P00000D6I/quote), which cannot be fetched
// from a server (AWS WAF JavaScript challenge, see morningstar.js).
// Fidelity's own factsheet publishes the same NAV, so this parser is
// the reliable backup source for that fund.
//
// STATUS (verified 18 Nov 2026): a plain server fetch of the factsheet
// page returns HTTP 200 with the full page, no bot challenge. The page
// shows "Last buy/sell price €93.18", "Prices updated as at 17 Nov 2026"
// and "Prices in EUR" — the same price and date Morningstar shows.
//
// Parse patterns below are from that REAL page, not guessed.

import { toText, cleanName, titleOrH1, findDate, findCurrency } from './helpers.js';

export const fidelity = {
  id: 'fidelity',
  domains: ['fidelity.co.uk'],

  parse(html, url) {
    const text = toText(html);
    const rawName = titleOrH1(html);
    const name = cleanName(rawName, ['Fidelity'])
      .replace(/\s*Portfolio Overview.*$/i, '')
      .replace(/\s*\|\s*LU[0-9A-Z]+.*$/i, '')
      .replace(/\s*\|\s*Fidelity.*$/i, '')
      .trim();

    // Price: the factsheet shows "Last buy/sell price €93.18".
    const buySell = text.match(/Last buy\/sell price\s*€?\s*([0-9]+(?:,[0-9]{3})*\.[0-9]{2,4})/i);
    const euro = text.match(/€\s*([0-9]+(?:,[0-9]{3})*\.[0-9]{2,4})\s*Change/i);
    const price = (buySell?.[1] || euro?.[1] || '').replace(/,/g, '');

    // Currency: "Prices in EUR".
    const inCur = text.match(/Prices in\s*(SGD|USD|EUR|GBP|AUD|HKD)\b/i);
    const currency = inCur ? inCur[1].toUpperCase() : findCurrency(text);

    // Date: "Prices updated as at 17 Nov 2026".
    const updated = text.match(/Prices updated as at\s+(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i);
    const date = updated ? updated[1] : findDate(text);

    return { name, price, currency, date, lowConfidence: false, source: url };
  },
};
