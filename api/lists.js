// Vercel serverless function: shared fund lists in Upstash Redis.
//   GET  /api/lists?u=<code>[&kind=compare]          -> { funds: [...] } or { error }
//   POST /api/lists { code, funds[, kind] }           -> { ok: true } or { error }
// Lists are stored under Redis key `funds:<code>` (kind 'funds', the
// default) or `compare:<code>` (kind 'compare', the Compare page's fund
// list). The code is the key: anyone with the code (or the ?u= link) can
// open and edit the list. The Redis token stays server-side — it is never
// sent to the browser.
//
// Response pattern matches the other proxies: upstream failures and a
// missing key come back as HTTP 200 with { error } so the page can show a
// message instead of a wrong state; only malformed requests get HTTP
// 400/405. A missing key also carries notFound: true, so the Compare page
// can tell "no shared list yet" (migrate the local list up) from "the
// store could not be reached" (keep the local list, warn only).
//
// This file has no dependencies and no build step, so it deploys as-is
// on Vercel. Vercel bundles the lib/upstash.js file it imports.

import {
  getRedisConfig,
  redisGet,
  redisSet,
  validateCode,
  validateFunds,
  normalizeCompare,
  readJsonBody,
  rawBodyBytes,
  listKey,
  compareKey,
  MAX_JSON_BYTES,
} from '../lib/upstash.js';

const NOT_CONFIGURED_FUNDS = 'Shared lists are not set up yet (no Upstash Redis configured on the server). Your list is still saved in this browser.';
const NOT_CONFIGURED_COMPARE = 'Shared lists are not set up yet (no Upstash Redis configured on the server). Your compare list is still saved in this browser.';

// Returns the kind ('funds' | 'compare') or an error string.
function parseKind(value) {
  const kind = String(value || 'funds').trim().toLowerCase();
  if (kind === 'funds' || kind === 'compare') return { kind };
  return { error: "kind must be 'funds' or 'compare'." };
}

function keyFor(kind, code) {
  return kind === 'compare' ? compareKey(code) : listKey(code);
}

async function handleGet(req, res) {
  const code = String(req.query?.u || '').trim().toLowerCase();
  const codeError = validateCode(code);
  if (codeError) return res.status(400).json({ error: codeError });
  const { kind, error: kindError } = parseKind(req.query?.kind);
  if (kindError) return res.status(400).json({ error: kindError });
  if (!getRedisConfig()) {
    return res.status(200).json({ error: kind === 'compare' ? NOT_CONFIGURED_COMPARE : NOT_CONFIGURED_FUNDS });
  }

  let raw;
  try {
    raw = await redisGet(keyFor(kind, code));
  } catch (e) {
    return res.status(200).json({ error: 'Could not reach the shared-list store. Try again.' });
  }
  if (raw === null || raw === undefined) {
    return res.status(200).json({ error: 'No saved list for that code.', notFound: true });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return res.status(200).json({ error: 'The saved list for that code could not be read.' });
  }
  if (kind === 'compare') {
    const { list, error } = normalizeCompare(parsed);
    if (error) return res.status(200).json({ error: 'The saved list for that code is not valid.' });
    return res.status(200).json({ funds: list });
  }
  const fundsError = validateFunds(parsed);
  if (fundsError) {
    return res.status(200).json({ error: 'The saved list for that code is not valid.' });
  }
  return res.status(200).json({ funds: parsed });
}

async function handlePost(req, res) {
  if (rawBodyBytes(req) > MAX_JSON_BYTES) {
    return res.status(400).json({ error: 'The fund list is too large (max about 256KB).' });
  }
  const body = readJsonBody(req);
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'A JSON body with { code, funds } is required.' });
  }
  const code = String(body.code || '').trim().toLowerCase();
  const codeError = validateCode(code);
  if (codeError) return res.status(400).json({ error: codeError });
  const { kind, error: kindError } = parseKind(body.kind);
  if (kindError) return res.status(400).json({ error: kindError });

  // Validate (and normalise, for compare) before touching Redis.
  let toStore;
  if (kind === 'compare') {
    const { list, error } = normalizeCompare(body.funds);
    if (error) return res.status(400).json({ error });
    toStore = list;
  } else {
    const fundsError = validateFunds(body.funds);
    if (fundsError) return res.status(400).json({ error: fundsError });
    toStore = body.funds;
  }
  if (!getRedisConfig()) {
    return res.status(200).json({ error: kind === 'compare' ? NOT_CONFIGURED_COMPARE : NOT_CONFIGURED_FUNDS });
  }

  let saved;
  try {
    saved = await redisSet(keyFor(kind, code), JSON.stringify(toStore));
  } catch (e) {
    return res.status(200).json({ error: 'Could not save to the shared-list store. Try again.' });
  }
  if (!saved) {
    return res.status(200).json({ error: 'Could not save to the shared-list store. Try again.' });
  }
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ error: 'Only GET and POST are supported.' });
}
