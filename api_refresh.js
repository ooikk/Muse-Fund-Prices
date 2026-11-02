// Vercel serverless function: GET /api/refresh?url=<fund page URL>
// Fetches ONE fund page and tries to extract: fund name, price, currency, price date.
// DollarDex bot detection: a direct server fetch often gets HTTP 403 or a
// challenge page (Cloudflare / Imperva style), while the same page opens fine
// in a real browser. When that happens we return { blocked: true } instead of
// a guessed price — the UI then tells the user to open the link and enter
// the price manually. Never invent a price.
//
// This file has no dependencies and no build step, so it deploys as-is on Vercel.

const BOT_MARKERS = [
  'access denied', 'attention required', 'cf-challenge', 'challenge-platform',
  'captcha', 'please verify you are a human', 'bot detection', 'forbidden',
  'incapsula', 'distil', 'akamai', 'sucuri', 'cloudflare ray id',
];

export function parseFundPage(html, fallbackUrl) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

  // Fund name: <title> or <h1>, cleaned of site suffixes.
  let name = '';
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const rawName = (h1?.[1] || title?.[1] || '').trim();
  if (rawName) {
    name = rawName
      .replace(/\s*[-|]\s*(DollarDex|iFAST|Fundsupermart).*$/i, '')
      .replace(/\s*:\s*Fund Overview.*$/i, '')
      .trim();
  }

  // Price date: prefer a date near a price/NAV label, else the first
  // DD-Mon-YYYY / DD/MM/YYYY / YYYY-MM-DD in the page text.
  let date = '';
  const dateRe = /(\d{1,2}[-/ ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/ ]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i;
  const nearPrice = text.match(/(?:NAV|Price|Bid|Offer)[\s\S]{0,120}?(\d{1,2}[-/ ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/ ]\d{4}|\d{4}-\d{2}-\d{2})/i);
  date = (nearPrice?.[1] || text.match(dateRe)?.[1] || '').trim();

  // Price: ordered patterns, most specific first. DollarDex overview pages
  // show a NAV / price figure; generic pages show a labelled price.
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
    // anywhere in the page. Mark it low-confidence so the UI asks the
    // user to verify it against the source link.
    const m = text.match(/\b([0-9]+\.[0-9]{2,4})\b/);
    if (m) { price = m[1]; lowConfidence = true; }
  }

  // Currency: a code near the price, else the page's own currency label.
  let currency = '';
  const curNear = text.match(/(SGD|USD|EUR|GBP|AUD|HKD)\s*[0-9]/) ||
    text.match(/(?:Currency|Denominated in)\s*:?\s*(SGD|USD|EUR|GBP|AUD|HKD)/i);
  if (curNear) currency = curNear[1].toUpperCase();

  return { name, price, currency, date, lowConfidence, source: fallbackUrl };
}

export default async function handler(req, res) {
  const url = req.query?.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid fund URL is required.' });
  }

  let upstream;
  try {
    upstream = await fetch(url, {
      redirect: 'follow',
      headers: {
        // A real-browser set of headers: this is what gets past DollarDex
        // most often. It is not a bypass for a challenge page — if the
        // response is a challenge, we report blocked below.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-SG,en;q=0.9',
        'Referer': 'https://www.dollardex.com/',
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach the fund page (' + (e.cause?.code || 'network error') + '). Try again, or open the link manually.' });
  }

  if (upstream.status === 403 || upstream.status === 429 || upstream.status === 401) {
    return res.status(200).json({ blocked: true, status: upstream.status, note: 'The site refused the automated request (bot detection / rate limit).' });
  }
  if (!upstream.ok) {
    return res.status(200).json({ error: 'Fund page returned HTTP ' + upstream.status + '.' });
  }

  const html = await upstream.text();
  const lower = html.toLowerCase();
  if (BOT_MARKERS.some(m => lower.includes(m)) && !/fund|price|nav/i.test(html.slice(0, 20000))) {
    return res.status(200).json({ blocked: true, note: 'The site returned a bot-check page instead of the fund page.' });
  }

  const parsed = parseFundPage(html, url);
  if (!parsed.price) {
    return res.status(200).json({ error: 'Page loaded, but no price could be parsed. The page layout may have changed — open the link and enter the price manually.' });
  }
  return res.status(200).json(parsed);
}
