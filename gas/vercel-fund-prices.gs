/**
 * Google Apps Script: refresh fund prices via the Vercel crawler.
 *
 * Sheet: "Muse unit trust price update" > tab "VercelFundPrices"
 * Layout (row 1 = header, data from row 2):
 *   A = fund code (filled in by hand, e.g. Z867 for Singlife, FITECH
 *       for Fundsupermart — used to build the URL in column B)
 *   B = fund page URL (DollarDex, or any site with a parser in the repo;
 *       can be a formula built from the code in column A)
 *   C = fund name (written by this script)
 *   D = price (written by this script)
 *   E = currency (written by this script)
 *   F = price date (written by this script)
 *   G = status — "ok", or "blocked/failed — old price kept"
 *   H = last checked (written by this script, Singapore time)
 *
 * How it works:
 *   1. refreshAllFunds() reads every URL in column B.
 *   2. For each URL it asks Vercel GET /api/refresh?url=...
 *      Vercel picks the parser from the URL's domain, fetches the page
 *      and returns { name, price, currency, date, parser }.
 *   3. A blocked / error result is NEVER written over a good price —
 *      the old price, name, currency and date stay, only G/H are updated.
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
 *   4. To add a fund: put its fund code in the next empty row of
 *      column A, its page URL in column B (or a formula that builds
 *      the URL from the code), and run a refresh. No code change needed.
 *   5. To fetch ONE fund from a cell formula instead of refreshing the
 *      whole tab, use the custom function unittrustfund() (defined at
 *      the bottom of this file), e.g. =unittrustfund(B2, {"fund","price","date"})
 *      No trigger or menu needed — but a formula cell only refreshes when
 *      the sheet recalculates, so it does not replace the daily trigger.
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
 * Refresh every URL in column B of VercelFundPrices.
 * Writes C–H per row. Returns a short summary string (also logged).
 */
function refreshAllFunds() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + SHEET_NAME);

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'No fund URLs in column B.';

  // Header row, so the columns are labelled even on a fresh tab.
  sheet.getRange(1, 1, 1, 8).setValues([[
    'Fund code', 'URL', 'Fund name', 'Price', 'Currency', 'Price date', 'Status', 'Last checked'
  ]]);

  var urls = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  var out = []; // one row of C–H per fund row
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
      // Keep the old C–F values: write only G and H for this row.
      // We do that after the batch write below, by re-reading the row.
      out.push(null); // placeholder — handled in the second pass
      sheet.getRange(row, 7).setValue('blocked/failed — old price kept');
      sheet.getRange(row, 8).setValue(checked);
      kept++;
      Logger.log('Row ' + row + ' blocked/failed, old price kept: ' + url);
    }
    Utilities.sleep(PAUSE_MS);
  }

  // Batch-write the successful rows (C–H), skipping the failed ones.
  for (var j = 0; j < out.length; j++) {
    if (out[j]) sheet.getRange(2 + j, 3, 1, 6).setValues([out[j]]);
  }

  var summary = 'Updated ' + updated + ' fund(s), ' + kept + ' blocked/failed (old price kept).';
  Logger.log(summary);
  return summary;
}

/**
 * Custom function: fetch ONE fund's details from the Vercel crawler.
 * Use it in a cell, e.g. =unittrustfund(B2, {"fund","price","date"})
 *   First argument = the fund page URL (any site with a parser: DollarDex,
 *   Fidelity, Fundsupermart, Singlife, FundSingapore — the same links as
 *   column B). A one-cell range works too.
 *   Second argument = which fields to return, in the order you want them.
 *   It accepts the same shapes as singlifefund():
 *     "price"                  → one field
 *     {"date"}                 → one field, as an array
 *     {"fund","price","date"}  → several fields, left to right
 *     {B22:D22}                → a range of cells holding the field names
 *   Leave the second argument out for all three fields.
 * Returns one row ([results]) that spills across the columns, in the same
 * order as the fields you asked for:
 *   "fund"     → fund name (text)
 *   "price"    → price (number)
 *   "date"     → price date (a real date, formatted by the sheet)
 *   "currency" → currency code (text, e.g. SGD)
 * An unknown field returns 'Undefined Input: <field>' in its place.
 * If the site is blocked or the fetch fails, the fields come back blank —
 * never a guessed price. Edit the cell (or re-enter the formula) to retry.
 */
function unittrustfund(url, fieldsInput) {
  var urlText = '';
  if (Array.isArray(url)) {
    // A one-cell range arrives as [[value]].
    urlText = String((url[0] && url[0][0] !== undefined) ? url[0][0] : '');
  } else {
    urlText = String(url || '');
  }
  urlText = urlText.trim();

  var fields = normalizeFields_(fieldsInput);
  if (!fields.length) fields = ['fund', 'price', 'date'];

  var blanks = fields.map(function () { return ''; });
  if (!urlText) return [blanks];

  var result = fetchPriceFromVercel(urlText);
  if (!result || result.blocked || !result.price) return [blanks];

  var out = fields.map(function (f) {
    switch (String(f).trim().toLowerCase()) {
      case 'fund':
      case 'name':
        return result.name || '';
      case 'price':
        return Number(result.price);
      case 'date':
        return parsePriceDate_(result.date);
      case 'currency':
        return (result.currency || '').toUpperCase();
      default:
        return 'Undefined Input: ' + f;
    }
  });
  return [out];
}

/** Flatten the fields argument into a list of field names. */
function normalizeFields_(input) {
  var fields = [];
  if (input === undefined || input === null || input === '') return fields;
  if (typeof input === 'string') return [input];
  if (Array.isArray(input)) {
    for (var r = 0; r < input.length; r++) {
      var row = input[r];
      if (Array.isArray(row)) {
        for (var c = 0; c < row.length; c++) {
          if (row[c] !== '' && row[c] !== null && row[c] !== undefined) fields.push(String(row[c]));
        }
      } else if (row !== '' && row !== null && row !== undefined) {
        fields.push(String(row));
      }
    }
    return fields;
  }
  return [String(input)];
}

/** "17 Nov 2026" or "17-Nov-2026" → a real Date (script timezone). */
var PRICE_DATE_MONTHS_ = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parsePriceDate_(s) {
  var m = String(s || '').match(/(\d{1,2})[-\s](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-\s](\d{4})/i);
  if (!m) return '';
  return new Date(Number(m[3]), PRICE_DATE_MONTHS_[m[2].toLowerCase()], Number(m[1]));
}
