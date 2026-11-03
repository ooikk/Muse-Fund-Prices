// Parser registry — the ONLY place that decides which parser handles a URL.
// To add a site:
//   1. Create lib/parsers/<site>.js (copy _template.js).
//   2. Import it below.
//   3. Add it to the `parsers` list. Order matters only if two parsers claim
//      the same domain; the first match wins.
// To remove a site, delete its line from the list (the file can stay).

import { dollardex } from './dollardex.js';

export const parsers = [
  dollardex,
  // Add new parsers here, e.g.:
  // fundsupermart,
  // morningstar,
];

// Returns the parser for a URL, or null when no parser is registered for
// that site. Matching is by hostname suffix, so "www.dollardex.com" matches
// the "dollardex.com" entry.
export function getParser(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return null; }
  return parsers.find(p => p.domains.some(d => host === d || host.endsWith('.' + d))) || null;
}
