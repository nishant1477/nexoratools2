import { createHash, randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export const API_KEY_PREFIX = 'nx_live_';

/** 192 bits of randomness; the raw key is returned once and only its SHA-256 is stored. */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = API_KEY_PREFIX + randomBytes(24).toString('base64url');
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 12) };
}

// Keys are high-entropy random strings, so a fast hash is appropriate (unlike passwords).
export const hashApiKey = (raw: string): string => createHash('sha256').update(raw).digest('hex');

export function extractApiKey(headers: IncomingHttpHeaders): string | null {
  const auth = headers.authorization;
  const bearer = typeof auth === 'string' && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : null;
  const raw = bearer ?? (typeof headers['x-api-key'] === 'string' ? headers['x-api-key'].trim() : null);
  return raw && raw.startsWith(API_KEY_PREFIX) && raw.length < 100 ? raw : null;
}
