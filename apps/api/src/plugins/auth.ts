import fp from 'fastify-plugin';
import { AppError } from '@nexora/shared';
import { readSession } from '../lib/session.js';
import { extractApiKey, hashApiKey } from '../lib/apikeys.js';

/** Decorates the request with `user` (or null) and provides requireUser / requireAdmin guards. */
export default fp(async (app) => {
  const { env, prisma } = app.ctx;
  app.decorateRequest('user', null);
  app.decorateRequest('apiKey', null);

  app.addHook('onRequest', async (req) => {
    const token = req.cookies[env.SESSION_COOKIE_NAME];
    if (!token) return;
    const claims = await readSession(token, env.JWT_SECRET);
    if (!claims) return;
    const user = await prisma.user.findUnique({ where: { id: claims.sub } });
    // tokenVersion bump (password change / admin action) and disabling both revoke sessions instantly.
    if (!user || user.tokenVersion !== claims.tv || user.disabledAt) return;
    req.user = user;
  });

  app.decorate('requireUser', async (req) => {
    if (!req.user) throw new AppError('UNAUTHORIZED');
  });
  /** Developer API auth: `Authorization: Bearer nx_live_...` (or X-API-Key). Ignores browser cookies entirely. */
  app.decorate('requireApiKey', async (req) => {
    const raw = extractApiKey(req.headers);
    if (!raw) throw new AppError('UNAUTHORIZED', 'A valid API key is required. Send it as "Authorization: Bearer <key>".');
    const key = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(raw) }, include: { user: true } });
    if (!key || key.revokedAt || key.user.disabledAt) throw new AppError('UNAUTHORIZED', 'This API key is invalid or has been revoked.');
    req.user = key.user;
    req.apiKey = key;
    // Usage tracking: one event per call; lastUsedAt is throttled to one write a minute per key.
    await prisma.usageEvent.create({ data: { userId: key.userId, apiKeyId: key.id, kind: 'api.request' } });
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
      await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    }
  });
  app.decorate('requireAdmin', async (req) => {
    if (!req.user) throw new AppError('UNAUTHORIZED');
    if (req.user.role !== 'ADMIN') throw new AppError('FORBIDDEN');
  });
});
