// Vercel serverless function: shared fund lists in Upstash Redis.
//   GET  /api/lists?u=<code>        -> { funds: [...] } or { error }
//   POST /api/lists { code, funds } -> { ok: true } or { error }
// Lists are stored under Redis key `funds:<code>`. The code is the key:
// anyone with the code (or the ?u= link) can open and edit the list.
// The Redis token stays server-side — it is never sent to the browser.
//
// Response pattern matches the other proxies: upstream failures come back
// as HTTP 200 with { error } so the page can show a message instead of a
// wrong state; only malformed requests get HTTP 400/405.
//
// This file has no dependencies and no build step, so it deploys as-is
// on Vercel. Vercel bundles the lib/upstash.js file it imports.

import {
  getRedisConfig,
  redisGet,
  redisSet,
  validateCode,
  validateFunds,
  readJsonBody,
  rawBodyBytes,
  listKey,
  MAX_JSON_BYTES,
} from '../lib/upstash.js';

const NOT_CONFIGURED = 'Shared lists are not set up yet (no Upstash Redis configured on the server). Your list is still saved in this browser.';

async function handleGet(req, res) {
  const code = String(req.query?.u || '').trim().toLowerCase();
  const codeError = validateCode(code);
  if (codeError) return res.status(400).json({ error: codeError });
  if (!getRedisConfig()) return res.status(200).json({ error: NOT_CONFIGURED });

  let raw;
  try {
    raw = await redisGet(listKey(code));
  } catch (e) {
    return res.status(200).json({ error: 'Could not reach the shared-list store. Try again.' });
  }
  if (raw === null || raw === undefined) {
    return res.status(200).json({ error: 'No saved list for that code.' });
  }
  let funds;
  try {
    funds = JSON.parse(raw);
  } catch (e) {
    return res.status(200).json({ error: 'The saved list for that code could not be read.' });
  }
  const fundsError = validateFunds(funds);
  if (fundsError) {
    return res.status(200).json({ error: 'The saved list for that code is not valid.' });
  }
  return res.status(200).json({ funds });
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
  const fundsError = validateFunds(body.funds);
  if (fundsError) return res.status(400).json({ error: fundsError });
  if (!getRedisConfig()) return res.status(200).json({ error: NOT_CONFIGURED });

  let saved;
  try {
    saved = await redisSet(listKey(code), JSON.stringify(body.funds));
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
