import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, FILE_KINDS, TOOLS } from '@nexora/shared';
import { makeJobCreator } from '../lib/create-job.js';
import { publicJob } from '../lib/serialize.js';
import { makeDownloadHandler } from './files.js';

const idParams = z.object({ id: z.string().uuid() });

/**
 * Public developer API, authenticated with an API key (never cookies).
 *   POST /api/v1/jobs            multipart: tool, options (JSON), file(s)
 *   GET  /api/v1/jobs/:id        poll status
 *   GET  /api/v1/files/:id/download
 *   GET  /api/v1/tools
 * Rate limits are applied per API key, not per IP.
 */
export default async function v1Routes(app: FastifyInstance) {
  const { env, prisma } = app.ctx;
  const createJob = makeJobCreator(app);

  const perKey = (max: number, windowSeconds: number) => ({
    rateLimit: {
      max, timeWindow: windowSeconds * 1000,
      keyGenerator: (req: { headers: Record<string, unknown>; ip: string }) => {
        const auth = String(req.headers.authorization ?? req.headers['x-api-key'] ?? req.ip);
        return 'key:' + createHash('sha256').update(auth).digest('hex').slice(0, 24);
      },
    },
  });
  const readLimit = perKey(env.API_RATE_LIMIT, env.API_RATE_WINDOW_SECONDS);
  const writeLimit = perKey(env.UPLOAD_RATE_LIMIT, env.UPLOAD_RATE_WINDOW_SECONDS);

  app.get('/tools', { preHandler: app.requireApiKey, config: readLimit }, async () => ({
    ok: true,
    data: {
      tools: TOOLS.filter((t) => 'publicApi' in t && t.publicApi).map((t) => ({
        id: t.id, name: t.name, minFiles: t.minFiles, maxFiles: Math.min(t.maxFiles, env.MAX_FILES_PER_JOB),
        accepts: t.accepts.map((k) => FILE_KINDS[k].extensions[0]), output: t.output,
        options: 'optionFields' in t ? t.optionFields : [],
      })),
      limits: { maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024, retentionMinutes: env.FILE_RETENTION_MINUTES },
    },
  }));

  app.post('/jobs', { preHandler: app.requireApiKey, config: writeLimit }, async (req, reply) => {
    const job = await createJob(req, { user: req.user!, apiKeyId: req.apiKey!.id, publicOnly: true });
    return reply.code(201).send({ ok: true, data: { job: publicJob(job) } });
  });

  app.get('/jobs/:id', { preHandler: app.requireApiKey, config: readLimit }, async (req) => {
    const { id } = idParams.parse(req.params);
    const job = await prisma.job.findFirst({ where: { id, userId: req.user!.id }, include: { files: true } });
    if (!job) throw new AppError('JOB_NOT_FOUND');
    return { ok: true, data: { job: publicJob(job) } };
  });

  app.get('/files/:id/download', { preHandler: app.requireApiKey, config: readLimit }, makeDownloadHandler(app, { ownerOnly: true }));
}
