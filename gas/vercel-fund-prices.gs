/**
 * Google Apps Script: refresh fund prices via the Vercel crawler.
 *
 * Sheet: "Muse unit trust price update" > tab "VercelFundPrices"
 * Layout (row 1 = header, data from row 2):
 *   A = fund page URL (DollarDex, or any site with a parser in the repo)
 *   B = fund name (written by this script)
 *   C = price (written by this script)
 *   D = currency (written by this script)
 *   E = price date (written by this script)
 *   F = status — "ok", or "blocked/failed — old price kept"
 *   G = last checked (written by this script, Singapore time)
 *
 * How it works:
 *   1. refreshAllFunds() reads every URL in column A.
 *   2. For each URL it asks Vercel GET /api/refresh?url=...
 *      Vercel picks the parser from the URL's domain, fetches the page
 *      and returns { name, price, currency, date, parser }.
 *   3. A blocked / error result is NEVER written over a good price —
 *      the old price, name, currency and date stay, only F/G are updated.
 *   4. One fund at a time, 2 seconds apart, so DollarDex does not
 *      rate-limit the Vercel server.
 *
 * Setup:
 *   1. In the sheet: Extensions > Apps Script, paste this file, Save.
 *   2. Run refreshAllFunds() once from the editor — Google will ask you
 *      to authorise the script (it needs to read/write this spreadsheet
 *      and to call the Vercel URL). Check the run in Executions if unsure.
 *   3. For a daily refresh: in Apps Script, Triggers (clock icon) >
 *      Add Trigger > refreshAllFunds > Time-driven > Day timer, pick a
 *      time (e.g. 9–10am Singapore time). Or use the sheet menu:
 *      Fund Prices > Refresh all prices.
 *   4. To add a fund: paste its page URL in the next empty row of
 *      column A and run a refresh. No code change needed.
 */

var VERCEL_BASE = 'https://muse-fund-prices.vercel.app';
var SHEET_NAME = 'VercelFundPrices';
var PAUSE_MS = 2000; // pause between Vercel calls

/** Add a "Fund Prices" menu to the sheet, so a refresh is one tap. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Fund Prices')
    .addItem('Refresh all prices', 'refreshAllFunds')
    .addToUi();
}

/** Ask Vercel for one fund page. Returns the parsed JSON, or null. */
function fetchPriceFromVercel(url) {
  if (!url) return null;
  try {
    var res = UrlFetchApp.fetch(
      VERCEL_BASE + '/api/refresh?url=' + encodeURIComponent(url),
      { muteHttpExceptions: true, followRedirects: true }
    );
    return JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log('Vercel call failed for ' + url + ': ' + e);
    return null;
  }
}

/**
 * Refresh every URL in column A of VercelFundPrices.
 * Writes B–G per row. Returns a short summary string (also logged).
 */
function refreshAllFunds() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + SHEET_NAME);

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'No fund URLs in column A.';

  // Header row, so the columns are labelled even on a fresh tab.
  sheet.getRange(1, 1, 1, 7).setValues([[
    'URL', 'Fund name', 'Price', 'Currency', 'Price date', 'Status', 'Last checked'
  ]]);

  var urls = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var out = []; // one row of B–G per fund row
  var updated = 0, kept = 0;

  for (var i = 0; i < urls.length; i++) {
    var url = String(urls[i][0] || '').trim();
    var row = 2 + i;
    if (!url) { out.push(['', '', '', '', 'skipped — no URL', '']); continue; }

    var result = fetchPriceFromVercel(url);
    var checked = Utilities.formatDate(new Date(), 'Asia/Singapore', 'dd-MMM-yyyy HH:mm');
    if (result && result.price && !result.blocked) {
      out.push([
        result.name || '',
        Number(result.price),
        result.currency || '',
        result.date || '',
        'ok (' + (result.parser || '') + ')',
        checked
      ]);
      updated++;
    } else {
      // Keep the old B–E values: write only F and G for this row.
      // We do that after the batch write below, by re-reading the row.
      out.push(null); // placeholder — handled in the second pass
      sheet.getRange(row, 6).setValue('blocked/failed — old price kept');
      sheet.getRange(row, 7).setValue(checked);
      kept++;
      Logger.log('Row ' + row + ' blocked/failed, old price kept: ' + url);
    }
    Utilities.sleep(PAUSE_MS);
  }

  // Batch-write the successful rows (B–G), skipping the failed ones.
  for (var j = 0; j < out.length; j++) {
    if (out[j]) sheet.getRange(2 + j, 2, 1, 6).setValues([out[j]]);
  }

  var summary = 'Updated ' + updated + ' fund(s), ' + kept + ' blocked/failed (old price kept).';
  Logger.log(summary);
  return summary;
}
