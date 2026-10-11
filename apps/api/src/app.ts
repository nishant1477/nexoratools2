import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { AppError } from '@nexora/shared';
import type { Ctx } from './context.js';
import errors from './plugins/errors.js';
import auth from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import toolRoutes from './routes/tools.js';
import jobRoutes from './routes/jobs.js';
import fileRoutes from './routes/files.js';
import apiKeyRoutes from './routes/apikeys.js';
import usageRoutes from './routes/usage.js';
import adminRoutes from './routes/admin.js';
import v1Routes from './routes/v1.js';

export async function buildApp(ctx: Ctx): Promise<FastifyInstance> {
  const { env } = ctx;
  const app = Fastify({
    logger: { level: env.LOG_LEVEL, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024, // JSON bodies only; uploads stream through multipart
  });
  app.decorate('ctx', ctx);

  await app.register(errors);
  await app.register(helmet, { crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: env.API_RATE_LIMIT,
    timeWindow: env.API_RATE_WINDOW_SECONDS * 1000,
    redis: ctx.redis,
    nameSpace: 'nexora:rl:',
    skipOnError: true, // if Redis hiccups, don't take the API down
    allowList: (req) => req.url === '/api/health',
  });
  await app.register(multipart, { limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 } });
  await app.register(auth);

  // CSRF defence-in-depth (cookies are SameSite=Lax as well): browsers always send Origin on
  // cross-site state-changing requests, so a foreign Origin is rejected.
  app.addHook('onRequest', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (req.url.startsWith('/api/v1/')) return; // API-key auth: no ambient cookies, so no CSRF surface
    const origin = req.headers.origin;
    if (origin && origin !== env.WEB_ORIGIN) throw new AppError('FORBIDDEN', 'Cross-origin request blocked.');
  });

  await app.register(
    async (api) => {
      api.get('/health', async (_req, reply) => {
        const checks = { database: false, redis: false };
        try { await ctx.prisma.$queryRaw`SELECT 1`; checks.database = true; } catch { /* reported below */ }
        try { checks.redis = (await ctx.redis.ping()) === 'PONG'; } catch { /* reported below */ }
        const healthy = checks.database && checks.redis;
        return reply.code(healthy ? 200 : 503).send({ ok: healthy, data: checks });
      });
      await api.register(authRoutes);
      await api.register(toolRoutes);
      await api.register(jobRoutes);
      await api.register(fileRoutes);
      await api.register(apiKeyRoutes);
      await api.register(usageRoutes);
      await api.register(adminRoutes);
      await api.register(v1Routes, { prefix: '/v1' });
    },
    { prefix: '/api' },
  );

  return app;
}
