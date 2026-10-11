import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@nexora/database';
import { AppError, JOB_STATUSES, getTool } from '@nexora/shared';
import { makeJobCreator } from '../lib/create-job.js';
import { publicJob } from '../lib/serialize.js';

const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(JOB_STATUSES).optional(),
  tool: z.string().max(50).optional(),
});

export default async function jobRoutes(app: FastifyInstance) {
  const { env, prisma, queues } = app.ctx;
  const createJob = makeJobCreator(app);
  const uploadLimit = { rateLimit: { max: env.UPLOAD_RATE_LIMIT, timeWindow: env.UPLOAD_RATE_WINDOW_SECONDS * 1000 } };

  app.post('/jobs', { preHandler: app.requireUser, config: uploadLimit }, async (req, reply) => {
    const job = await createJob(req, { user: req.user! });
    return reply.code(201).send({ ok: true, data: { job: publicJob(job) } });
  });

  app.get('/jobs', { preHandler: app.requireUser }, async (req) => {
    const q = listQuery.parse(req.query);
    const where: Prisma.JobWhereInput = { userId: req.user!.id, ...(q.status && { status: q.status }), ...(q.tool && { tool: q.tool }) };
    const [total, jobs] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { files: true } }),
    ]);
    return { ok: true, data: { jobs: jobs.map(publicJob), page: q.page, pageSize: q.pageSize, total } };
  });

  app.get('/jobs/:id', { preHandler: app.requireUser }, async (req) => {
    const { id } = idParams.parse(req.params);
    const user = req.user!;
    const job = await prisma.job.findUnique({ where: { id }, include: { files: true } });
    // Other users' jobs are indistinguishable from missing ones.
    if (!job || (job.userId !== user.id && user.role !== 'ADMIN')) throw new AppError('JOB_NOT_FOUND');
    return { ok: true, data: { job: publicJob(job) } };
  });

  app.post('/jobs/:id/cancel', { preHandler: app.requireUser }, async (req) => {
    const { id } = idParams.parse(req.params);
    const user = req.user!;
    // Single atomic update: only own jobs that haven't finished can be cancelled.
    const res = await prisma.job.updateMany({
      where: { id, userId: user.id, status: { in: ['QUEUED', 'PROCESSING'] } },
      data: { status: 'CANCELLED', completedAt: new Date(), errorMessage: 'Cancelled by user.' },
    });
    if (res.count === 0) {
      const exists = await prisma.job.findFirst({ where: { id, userId: user.id }, select: { id: true } });
      throw exists ? new AppError('JOB_NOT_CANCELLABLE') : new AppError('JOB_NOT_FOUND');
    }
    // Best effort: drop it from the queue if it hasn't started. A running worker re-checks status before saving output.
    const job = await prisma.job.findUniqueOrThrow({ where: { id }, include: { files: true } });
    const tool = getTool(job.tool);
    if (tool) await queues[tool.worker].remove(id).catch(() => undefined);
    return { ok: true, data: { job: publicJob(job) } };
  });
}
