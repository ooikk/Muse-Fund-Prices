// TEMPLATE — copy this file to add a new site, e.g. fundsupermart.js.
// This file is NOT registered (see index.js), so it does nothing until you
// copy it and register the copy. Steps:
//   1. Copy this file to <site>.js in this same folder.
//   2. Rename the parser, set id and domains to the new site's hostnames.
//   3. Open one real fund page from that site in a browser, View Source,
//      and find the exact HTML around the fund name and the price. Write
//      regexes for those two things first — everything else is optional.
//   4. In index.js, import your parser and add it to the `parsers` list.
//   5. Deploy, then test with:
//        https://<your-site>.vercel.app/api/refresh?url=<encoded fund URL>
//      Check the returned price and date against the page itself before
//      trusting it as a backup source in your sheet.
// Rules: never return a guessed price (use '' when unsure), always return
// price as a plain number string without commas or currency symbols, and
// set lowConfidence: true whenever the match is a fallback guess.

import { toText, cleanName, titleOrH1, findDate, findCurrency } from './helpers.js';

export const template = {
  id: 'template', // <-- change: e.g. 'fundsupermart'
  domains: ['example.com'], // <-- change: e.g. ['fundsupermart.com']

  parse(html, url) {
    const text = toText(html);

    // Fund name: start with the page title / heading, strip the site name.
    const name = cleanName(titleOrH1(html), ['ExampleSite']).trim();

    // Price: replace this with a pattern that matches ONLY this site's
    // price element. Example: if the page contains "NAV: 12.3456", use:
    //   const m = text.match(/NAV:\s*([0-9]+\.[0-9]{2,4})/i);
    //   const price = m ? m[1] : '';
    const price = ''; // <-- implement for the new site

    return {
      name,
      price,
      currency: findCurrency(text),
      date: findDate(text),
      lowConfidence: false,
      source: url,
    };
  },
};
