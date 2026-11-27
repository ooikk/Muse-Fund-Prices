// Shared Upstash Redis helper for the per-user fund lists.
// The REST URL and token come from the Vercel env vars set by the Upstash
// integration (Production): UPSTASH_REDIS_KV_REST_API_URL and
// UPSTASH_REDIS_KV_REST_API_TOKEN. For robustness, fall back to
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN if the _KV_ names
// are absent. The token is server-side only — it must never reach the
// browser, and it is never logged or included in any response or error
// message.
//
// Upstash REST API shapes (https://upstash.com/docs/redis/features/restapi):
//   GET  {REST_URL}/get/{key}                     -> {"result": "<value>" | null}
//   POST {REST_URL}/set/{key}  (value in body)    -> {"result": "OK"}
//   POST {REST_URL}  body ["SET", key, val, "NX"] -> {"result": "OK" | null}
//   Every request carries `Authorization: Bearer <token>`.
//   Failures come back as {"error": "..."} (HTTP 400/401/405).

export const CODE_RE = /^[a-z0-9]{16}$/;
export const MAX_FUNDS = 100;
export const MAX_JSON_BYTES = 256 * 1024;

export function listKey(code) {
  return 'funds:' + code;
}

export function getRedisConfig() {
  const url = (process.env.UPSTASH_REDIS_KV_REST_API_URL
    || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const token = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN
    || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) return null;
  return { url, token };
}

function authHeaders(token) {
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
}

// One Upstash REST call. Returns the parsed {"result": ...} body.
// Throws on network failure, non-2xx status, or an {"error": ...} body.
async function redisCall({ url, token }, method, path, body) {
  let res;
  try {
    res = await fetch(url + path, {
      method,
      headers: authHeaders(token),
      body: body === undefined ? undefined : body,
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw new Error('redis unreachable');
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('redis bad response');
  }
  if (!res.ok || (data && typeof data.error === 'string')) {
    throw new Error('redis error');
  }
  return data;
}

export async function redisGet(key) {
  const cfg = getRedisConfig();
  if (!cfg) throw new Error('redis not configured');
  const data = await redisCall(cfg, 'GET', '/get/' + encodeURIComponent(key));
  return data.result === undefined ? null : data.result;
}

export async function redisSet(key, value) {
  const cfg = getRedisConfig();
  if (!cfg) throw new Error('redis not configured');
  const data = await redisCall(cfg, 'POST', '/set/' + encodeURIComponent(key), value);
  return data.result === 'OK';
}

// SET key value NX — only sets when the key does not exist yet.
// Returns true when the key was set, false when it already existed.
export async function redisSetNx(key, value) {
  const cfg = getRedisConfig();
  if (!cfg) throw new Error('redis not configured');
  const data = await redisCall(cfg, 'POST', '', JSON.stringify(['SET', key, value, 'NX']));
  return data.result === 'OK';
}

// --- validation (shared by /api/lists and /api/generate) -------------------

export function validateCode(code) {
  if (typeof code !== 'string' || !CODE_RE.test(code)) {
    return 'A list code is 16 lowercase letters and digits.';
  }
  return null;
}

// Returns an error string, or null when the funds list is acceptable.
export function validateFunds(funds) {
  if (!Array.isArray(funds)) return 'Funds must be a list.';
  if (funds.length > MAX_FUNDS) return 'At most ' + MAX_FUNDS + ' funds per list.';
  for (const f of funds) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return 'Each fund must be an object with a link.';
    if (typeof f.url !== 'string' || !f.url.trim()) return 'Each fund must have a link (url).';
  }
  let json = '';
  try {
    json = JSON.stringify(funds);
  } catch (e) {
    return 'The fund list could not be read.';
  }
  if (Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) {
    return 'The fund list is too large (max about 256KB).';
  }
  return null;
}

// Reads a JSON request body. Vercel parses JSON bodies into req.body, but
// be defensive: accept an object as-is, parse a string, reject the rest.
export function readJsonBody(req) {
  const b = req.body;
  if (!b) return null;
  if (typeof b === 'object') return b;
  if (typeof b === 'string') {
    try {
      return JSON.parse(b);
    } catch (e) {
      return null;
    }
  }
  return null;
}

// Rough byte size of the raw request body, for the size cap.
export function rawBodyBytes(req) {
  const b = req.body;
  if (typeof b === 'string') return Buffer.byteLength(b, 'utf8');
  if (b) {
    try {
      return Buffer.byteLength(JSON.stringify(b), 'utf8');
    } catch (e) {
      return MAX_JSON_BYTES + 1;
    }
  }
  return 0;
}
