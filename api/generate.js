// Vercel serverless function: create a shared fund list in Upstash Redis.
//   POST /api/generate { funds[, compare] } -> { code } or { error }
// Generates a fresh 16-character lowercase alphanumeric code server-side,
// stores the funds under Redis key `funds:<code>` (SET NX, so a code is
// never reused — a collision just retries with a new code), and returns
// the code. The page then shows the personal link ?u=<code>.
// A new list starts from whatever list the client sends — for a fresh
// browser that is the 17 seed funds.
// When the client also sends a `compare` array (the Compare page's fund
// list, snapshotted by the main page), it is stored under
// `compare:<code>` as well. If that second store fails, the code is
// still returned — the Compare page migrates its local list up on its
// first visit with the code, so a failed compare store self-heals.
//
// Response pattern matches the other proxies: upstream failures come back
// as HTTP 200 with { error }; only malformed requests get HTTP 400/405.
//
// This file has no dependencies and no build step, so it deploys as-is
// on Vercel. Vercel bundles the lib/upstash.js file it imports.

import { randomInt } from 'node:crypto';
import {
  getRedisConfig,
  redisSet,
  redisSetNx,
  validateFunds,
  normalizeCompare,
  readJsonBody,
  rawBodyBytes,
  listKey,
  compareKey,
  MAX_JSON_BYTES,
} from '../lib/upstash.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const MAX_ATTEMPTS = 10;

// Exported for testing (uniqueness/format checks without Redis).
export function generateCode() {
  let code = '';
  for (let i = 0; i < 16; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST is supported.' });
  }
  if (rawBodyBytes(req) > MAX_JSON_BYTES) {
    return res.status(400).json({ error: 'The fund list is too large (max about 256KB).' });
  }
  const body = readJsonBody(req);
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'A JSON body with { funds } is required.' });
  }
  const fundsError = validateFunds(body.funds);
  if (fundsError) return res.status(400).json({ error: fundsError });
  // Validate the compare snapshot before claiming a code, so a bad one
  // cannot fail the request after the funds list is already stored.
  let compare = null;
  if (body.compare !== undefined) {
    const { list, error } = normalizeCompare(body.compare);
    if (error) return res.status(400).json({ error });
    compare = list;
  }
  if (!getRedisConfig()) {
    return res.status(200).json({ error: 'Shared lists are not set up yet (no Upstash Redis configured on the server). Your list is still saved in this browser.' });
  }

  const json = JSON.stringify(body.funds);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateCode();
    let set;
    try {
      set = await redisSetNx(listKey(code), json);
    } catch (e) {
      return res.status(200).json({ error: 'Could not reach the shared-list store. Try again.' });
    }
    if (set) {
      if (compare !== null) {
        // Best effort: a failed compare store self-heals — the Compare
        // page migrates its local list up on first visit with this code.
        try { await redisSet(compareKey(code), JSON.stringify(compare)); } catch (e) { /* self-heals on migrate */ }
      }
      return res.status(200).json({ code });
    }
    // Collision (key already exists): try a fresh code.
  }
  return res.status(200).json({ error: 'Could not create a list code. Try again.' });
}
