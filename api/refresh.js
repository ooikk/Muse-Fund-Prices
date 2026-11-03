// Vercel serverless function: GET /api/refresh?url=<fund page URL>
// Fetches ONE fund page and returns: fund name, price, currency, price
// date, and which parser handled it. It works for any site that has a
// parser registered in lib/parsers/index.js — the domain of the URL picks
// the parser, so GAS (or the website) just sends the link and does not
// need to know which site it is.
//
// Responses (all HTTP 200 except bad requests, so a caller like GAS can
// simply try the next source on any non-price result):
//   { name, price, currency, date, parser, source }  — price found
//   { blocked: true, ... }  — site refused the request (bot detection /
//                             rate limit) or returned a bot-check page
//   { error: '...' }        — no parser for this site, page unreachable,
//                             or no price could be parsed
// A blocked or error result must NEVER be written over a good price —
// the caller keeps the old price and records the failure.
//
// Bot detection: a direct server fetch often gets HTTP 403 or a challenge
// page, while the same page opens fine in a real browser. When that
// happens we return { blocked: true } instead of a guessed price. Never
// invent a price, and never add credentials, cookies, or headless-browser
// evasion here.
//
// This file has no dependencies and no build step, so it deploys as-is
// on Vercel. Vercel bundles the lib/parsers files it imports.

import { getParser, parsers } from '../lib/parsers/index.js';
import { dollardex } from '../lib/parsers/dollardex.js';

// Backwards compatibility: the original single-parser helper, still used
// by the website's tests. New code should use getParser() instead.
export function parseFundPage(html, fallbackUrl) {
  return dollardex.parse(html, fallbackUrl);
}

const BOT_MARKERS = [
  'access denied', 'attention required', 'cf-challenge', 'challenge-platform',
  'captcha', 'please verify you are a human', 'bot detection', 'forbidden',
  'incapsula', 'distil', 'akamai', 'sucuri', 'cloudflare ray id',
];

export default async function handler(req, res) {
  const url = req.query?.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid fund URL is required.' });
  }

  const parser = getParser(url);
  if (!parser) {
    return res.status(200).json({
      error: 'No parser registered for this site. Add one in lib/parsers/ (see _template.js) and register it in lib/parsers/index.js.',
      supported: parsers.map(p => p.id),
    });
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
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return res.status(200).json({ error: 'Could not reach the fund page (' + (e.cause?.code || 'network error') + '). Try again, or open the link manually.' });
  }

  if (upstream.status === 403 || upstream.status === 429 || upstream.status === 401) {
    return res.status(200).json({ blocked: true, parser: parser.id, status: upstream.status, note: 'The site refused the automated request (bot detection / rate limit).' });
  }
  if (!upstream.ok) {
    return res.status(200).json({ error: 'Fund page returned HTTP ' + upstream.status + '.', parser: parser.id });
  }

  const html = await upstream.text();
  const lower = html.toLowerCase();
  if (BOT_MARKERS.some(m => lower.includes(m)) && !/fund|price|nav/i.test(html.slice(0, 20000))) {
    return res.status(200).json({ blocked: true, parser: parser.id, note: 'The site returned a bot-check page instead of the fund page.' });
  }

  const parsed = parser.parse(html, url);
  if (!parsed.price) {
    return res.status(200).json({ error: 'Page loaded, but no price could be parsed. The page layout may have changed — open the link and enter the price manually.', parser: parser.id });
  }
  return res.status(200).json({ ...parsed, parser: parser.id });
}
