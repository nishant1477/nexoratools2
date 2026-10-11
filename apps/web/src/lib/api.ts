export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown) { super(message); this.name = 'ApiError'; }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

export async function parseEnvelope<T>(status: number, text: string): Promise<T> {
  let body: Envelope<T>;
  try { body = JSON.parse(text) as Envelope<T>; } catch {
    throw new ApiError('BAD_RESPONSE', 'The server sent an unexpected response. Please try again.', status);
  }
  if (!body.ok) throw new ApiError(body.error.code, body.error.message, status, body.error.details);
  return body.data;
}

/** Same-origin JSON call to the API (cookies included). Throws ApiError with a user-presentable message. */
export async function api<T>(path: string, init: { method?: string; json?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.json ? 'POST' : 'GET'),
      headers: init.json ? { 'content-type': 'application/json' } : undefined,
      body: init.json ? JSON.stringify(init.json) : undefined,
      credentials: 'same-origin', signal: init.signal, cache: 'no-store',
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('NETWORK', "Can't reach the server. Check your connection and try again.", 0);
  }
  return parseEnvelope<T>(res.status, await res.text());
}

export const errorMessage = (err: unknown): string =>
  err instanceof ApiError ? err.message : err instanceof Error && err.name !== 'AbortError' ? 'Something went wrong. Please try again.' : '';
