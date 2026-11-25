// Parser for Allianz Global Investors Singapore fund pages (sg.allianzgi.com).
// Example URL:
//   https://sg.allianzgi.com/en-sg/retail/products-solutions/authorised-fund/allianz-global-high-payout-fund-class-am-sgd-dis?nav=overview
// That link is the Allianz Global High Payout Fund Class AM SGD Dis
// (ISIN SG9999002224) — the same fund already tracked via DollarDex,
// Fundsupermart, Singlife and FundSingapore — so Allianz GI is a fifth
// backup source for it, and the fund manager's own page.
//
// The price IS server-rendered (no JavaScript needed): the page carries
// JSON-LD with "name":"Unit NAV","value":"0.687" and visible text
// "Unit NAV 0.687 SGD" with "Valuation Date: 23/11/2026".
// Verified 25 Nov 2026: 0.687 SGD, 23 Nov 2026 — exact match with the
// FundSingapore price (0.687 SGD, 23 Nov 2026) in the sheet.
//
// One quirk: the site answers the first request with a 302 (it drops the
// /en-sg/ prefix, then redirects back) and only serves the page when the
// request carries the cookies the site itself set on the redirect
// responses. A plain fetch without a cookie jar loops in 302s forever.
// These are the site's own session cookies, returned by the site on its
// own responses and forwarded exactly as a browser would forward them
// across a redirect chain — no stored credential, no login, no evasion.
// That is why this parser defines its own fetch(url): it follows the
// redirects manually, collecting Set-Cookie and re-sending Cookie,
// then parses the final HTML.
//
// Parse patterns below are from that REAL page, not guessed.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDmy(dmy) {
  const m = String(dmy || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  return `${Number(m[1])} ${MONTHS[Number(m[2]) - 1]} ${m[3]}`;
}

function parseAllianzHtml(html, url) {
  const empty = { name: '', price: '', currency: '', date: '', lowConfidence: false, source: url };

  // Name: <title>Allianz Global Investors | Allianz Global High Payout
  // Fund* - Class AM SGD Dis.</title> — drop the site prefix, the
  // footnote asterisk and the trailing full stop.
  let name = '';
  const title = html.match(/<title>([^<]+)<\/title>/i);
  if (title) {
    name = title[1].replace(/^Allianz Global Investors\s*\|\s*/i, '').replace(/\*+/g, '').replace(/\.\s*$/, '').trim();
  }

  // Price + currency: visible text "Unit NAV 0.687 SGD".
  let price = '';
  let currency = '';
  const navText = html.match(/Unit NAV\s+([\d,]+\.\d+)\s+([A-Z]{3})/i);
  if (navText) {
    price = navText[1].replace(/,/g, '');
    currency = navText[2].toUpperCase();
  } else {
    // Fallback: the JSON-LD "Unit NAV" property carries the value
    // (currency then comes from the page text, defaulting to SGD only
    // when the fund is plainly an SGD share class — never guessed from
    // the URL alone).
    const navJson = html.match(/"name"\s*:\s*"Unit NAV"\s*,\s*"value"\s*:\s*"([\d,]+\.\d+)"/i);
    if (navJson) price = navJson[1].replace(/,/g, '');
  }
  if (!price) return empty;

  // Date: "Valuation Date: 23/11/2026" (DD/MM/YYYY).
  const dateMatch = html.match(/Valuation Date:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const date = formatDmy(dateMatch ? dateMatch[1] : '');

  return { name, price, currency, date, lowConfidence: false, source: url };
}

export const allianzgi = {
  id: 'allianzgi',
  domains: ['sg.allianzgi.com'],

  parse(html, url) {
    return parseAllianzHtml(html, url);
  },

  // Cookie-aware redirect following (see the header comment): the site
  // 302s without its own cookies, so follow each redirect manually,
  // collecting Set-Cookie and re-sending Cookie, until a final page.
  async fetch(url) {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    let cookies = [];
    let current = url;
    for (let hop = 0; hop < 6; hop++) {
      let res;
      try {
        res = await fetch(current, {
          redirect: 'manual',
          headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-SG,en;q=0.9',
            ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
          },
          signal: AbortSignal.timeout(20000),
        });
      } catch (e) {
        return { name: '', price: '', currency: '', date: '', lowConfidence: false, source: url };
      }
      const setCookie = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
      for (const c of setCookie) cookies.push(String(c).split(';')[0].trim());
      const loc = res.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
        current = new URL(loc, current).toString();
        continue;
      }
      if (res.status === 403 || res.status === 429 || res.status === 401) {
        return { blocked: true, name: '', price: '', currency: '', date: '', lowConfidence: false, source: url };
      }
      if (!res.ok) {
        return { name: '', price: '', currency: '', date: '', lowConfidence: false, source: url };
      }
      const html = await res.text();
      return parseAllianzHtml(html, url);
    }
    return { name: '', price: '', currency: '', date: '', lowConfidence: false, source: url };
  },
};
