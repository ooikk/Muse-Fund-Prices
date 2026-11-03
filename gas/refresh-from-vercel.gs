/**
 * Example Google Apps Script: refresh fund prices via the Vercel crawler.
 *
 * How it fits together:
 *   1. Your sheet holds, per fund row, a primary URL and (optionally) a
 *      backup URL for the same fund, on a site you have already verified
 *      (same share class, same currency — see README "Adding a new site").
 *   2. A time trigger runs refreshAllFunds() once a day.
 *   3. For each fund it asks Vercel for the primary URL; only if Vercel
 *      answers blocked/error does it ask for the backup URL. Vercel picks
 *      the parser from the URL's domain — this script never needs to know
 *      which site a link belongs to.
 *   4. A blocked/error result is NEVER written over a good price. The old
 *      price stays, and the failure is logged so you can check it.
 *
 * Setup:
 *   - Paste this into a script bound to your sheet (Extensions > Apps Script).
 *   - Set VERCEL_BASE to your Vercel deployment, e.g.
 *       https://muse-fund-prices.vercel.app
 *   - Adapt the column letters in refreshAllFunds() to your sheet layout,
 *     then add a time-driven trigger for refreshAllFunds().
 *   - Be gentle: one fund at a time, with a pause between calls, or the
 *     source sites will rate-limit you.
 */

var VERCEL_BASE = 'https://YOUR-PROJECT.vercel.app'; // <-- change this
var PAUSE_MS = 2000; // pause between Vercel calls

/** Ask Vercel for one fund page. Returns the parsed JSON, or null on failure. */
function fetchPriceFromVercel(url) {
  if (!url) return null;
  try {
    var res = UrlFetchApp.fetch(
      VERCEL_BASE + '/api/refresh?url=' + encodeURIComponent(url),
      { muteHttpExceptions: true }
    );
    return JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log('Vercel call failed for ' + url + ': ' + e);
    return null;
  }
}

/** Try the primary URL, then the backup URL. Returns a price result or null. */
function refreshOneFund(primaryUrl, backupUrl) {
  var result = fetchPriceFromVercel(primaryUrl);
  if (result && result.price && !result.blocked) {
    result.sourceUsed = 'primary';
    return result;
  }
  if (backupUrl) {
    result = fetchPriceFromVercel(backupUrl);
    if (result && result.price && !result.blocked) {
      result.sourceUsed = 'backup';
      return result;
    }
  }
  return null; // blocked or failed on every source: keep the old price
}

/**
 * Example driver — adapt the sheet name and columns to your own sheet.
 * Assumed layout: A = fund name, B = primary URL, C = backup URL,
 * D = price, E = price date, F = source used / status. Row 1 is a header.
 */
function refreshAllFunds() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  var lastRow = sheet.getLastRow();
  for (var row = 2; row <= lastRow; row++) {
    var primary = sheet.getRange(row, 2).getValue();
    var backup = sheet.getRange(row, 3).getValue();
    var result = refreshOneFund(primary, backup);
    if (result) {
      sheet.getRange(row, 4).setValue(Number(result.price));
      if (result.date) sheet.getRange(row, 5).setValue(result.date);
      sheet.getRange(row, 6).setValue(result.sourceUsed + ' (' + result.parser + ')');
    } else {
      sheet.getRange(row, 6).setValue('blocked/failed — old price kept');
    }
    Utilities.sleep(PAUSE_MS);
  }
}
