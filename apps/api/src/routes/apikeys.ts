import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@nexora/shared';
import { generateApiKey } from '../lib/apikeys.js';

const createBody = z.object({ name: z.string().trim().min(1, 'Give the key a name').max(60) });
const idParams = z.object({ id: z.string().uuid() });

const publicKey = (k: { id: string; name: string; keyPrefix: string; lastUsedAt: Date | null; createdAt: Date; revokedAt: Date | null }) => ({
  id: k.id, name: k.name, prefix: k.keyPrefix, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt, revokedAt: k.revokedAt,
});

/** Key management for signed-in users (cookie session). The keys themselves authenticate /api/v1. */
export default async function apiKeyRoutes(app: FastifyInstance) {
  const { env, prisma } = app.ctx;

  app.get('/keys', { preHandler: app.requireUser }, async (req) => {
    const keys = await prisma.apiKey.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
    const usage = await prisma.usageEvent.groupBy({ by: ['apiKeyId'], where: { apiKeyId: { in: keys.map((k) => k.id) }, kind: 'api.request' }, _count: { _all: true } });
    const counts = new Map(usage.map((u) => [u.apiKeyId, u._count._all]));
    return { ok: true, data: { keys: keys.map((k) => ({ ...publicKey(k), requests: counts.get(k.id) ?? 0 })) } };
  });

  app.post('/keys', { preHandler: app.requireUser }, async (req, reply) => {
    const { name } = createBody.parse(req.body);
    const user = req.user!;
    const active = await prisma.apiKey.count({ where: { userId: user.id, revokedAt: null } });
    if (active >= env.API_KEYS_PER_USER) throw new AppError('FORBIDDEN', `You can have at most ${env.API_KEYS_PER_USER} active API keys. Revoke one first.`);
    const { raw, hash, prefix } = generateApiKey();
    const key = await prisma.apiKey.create({ data: { userId: user.id, name, keyHash: hash, keyPrefix: prefix } });
    await prisma.auditLog.create({ data: { actorId: user.id, action: 'apikey.created', targetType: 'ApiKey', targetId: key.id } });
    // The only time the raw key is ever returned.
    return reply.code(201).send({ ok: true, data: { key: publicKey(key), secret: raw } });
  });

  app.delete('/keys/:id', { preHandler: app.requireUser }, async (req) => {
    const { id } = idParams.parse(req.params);
    const user = req.user!;
    // Scoped by userId: someone else's key is indistinguishable from a missing one.
    const res = await prisma.apiKey.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (res.count === 0) throw new AppError('FILE_NOT_FOUND', 'API key not found.');
    await prisma.auditLog.create({ data: { actorId: user.id, action: 'apikey.revoked', targetType: 'ApiKey', targetId: id } });
    return { ok: true, data: {} };
  });
}
