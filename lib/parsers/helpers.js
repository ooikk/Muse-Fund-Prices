// Shared helpers for site parsers.
// A parser is a small, self-contained module: it receives the raw HTML of
// ONE fund page and returns { name, price, currency, date, lowConfidence }.
// It must never invent a price: return price: '' when nothing reliable is
// found, and the caller will report "could not parse" instead.

// Strip scripts/styles/tags and collapse whitespace, so regexes can work
// on plain page text.
export function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

// Fund name from <h1> or <title>, with site suffixes removed.
// Pass extra suffix words for the site, e.g. cleanName(raw, ['Fundsupermart']).
export function cleanName(raw, siteWords = []) {
  let name = (raw || '').trim();
  for (const w of siteWords) {
    name = name.replace(new RegExp(`\\s*[-|]\\s*${w}.*$`, 'i'), '');
  }
  return name.trim();
}

export function titleOrH1(html) {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  return (h1?.[1] || title?.[1] || '').trim();
}

// A date like 29-Oct-2026, 29/10/2026, or 2026-10-29. Prefer a date near a
// price/NAV label, otherwise take the first date-looking string in the text.
const DATE_RE = /(\d{1,2}[-/ ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/ ]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i;
export function findDate(text) {
  const nearPrice = text.match(/(?:NAV|Price|Bid|Offer)[\s\S]{0,120}?(\d{1,2}[-/ ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/ ]\d{4}|\d{4}-\d{2}-\d{2})/i);
  return (nearPrice?.[1] || text.match(DATE_RE)?.[1] || '').trim();
}

// Currency code near a number, or after a "Currency:" label.
export function findCurrency(text) {
  const m = text.match(/(SGD|USD|EUR|GBP|AUD|HKD)\s*[0-9]/) ||
    text.match(/(?:Currency|Denominated in)\s*:?\s*(SGD|USD|EUR|GBP|AUD|HKD)/i);
  return m ? m[1].toUpperCase() : '';
}
