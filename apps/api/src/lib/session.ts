import { SignJWT, jwtVerify } from 'jose';

export type SessionClaims = { sub: string; tv: number };

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(claims: SessionClaims, secret: string, ttlHours: number): Promise<string> {
  return new SignJWT({ tv: claims.tv })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlHours}h`)
    .sign(key(secret));
}

export async function readSession(token: string, secret: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.tv !== 'number') return null;
    return { sub: payload.sub, tv: payload.tv };
  } catch {
    return null;
  }
}
