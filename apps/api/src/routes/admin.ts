import { statfs } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@nexora/database';
import { AppError, JOB_STATUSES, QUEUE_NAMES, type WorkerKind } from '@nexora/shared';
import { publicJob } from '../lib/serialize.js';

const page = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const idParams = z.object({ id: z.string().uuid() });
const usersQuery = page.extend({ search: z.string().trim().max(100).optional(), status: z.enum(['active', 'disabled']).optional() });
const jobsQuery = page.extend({
  status: z.enum(JOB_STATUSES).optional(),
  tool: z.string().max(50).optional(),
  userId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(), // job id or user email fragment
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
const patchUser = z.object({ disabled: z.boolean() });

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

/** Everything here requires an ADMIN session; responses never include secrets or password hashes. */
export default async function adminRoutes(app: FastifyInstance) {
  const { prisma, redis, storage, queues, env } = app.ctx;
  const guard = { preHandler: app.requireAdmin };

  const userView = (u: { id: string; email: string; name: string; role: string; plan: string; disabledAt: Date | null; createdAt: Date }) => ({
    id: u.id, email: u.email, name: u.name, role: u.role, plan: u.plan, disabled: u.disabledAt !== null, disabledAt: u.disabledAt, createdAt: u.createdAt,
  });

  // ---------- Overview ----------
  app.get('/admin/stats', guard, async () => {
    const day = new Date(Date.now() - 86_400_000);
    const week = new Date(Date.now() - 7 * 86_400_000);
    const [users, disabled, admins, newUsers, jobsByStatus, last24, topTools, processed, storageAgg, activeKeys] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { disabledAt: { not: null } } }),
      prisma.user.count({ where: { role: 'ADMIN' } }),
      prisma.user.count({ where: { createdAt: { gte: week } } }),
      prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.job.groupBy({ by: ['status'], where: { createdAt: { gte: day } }, _count: { _all: true } }),
      prisma.job.groupBy({ by: ['tool'], _count: { _all: true }, orderBy: { _count: { tool: 'desc' } }, take: 8 }),
      prisma.job.aggregate({ _sum: { inputSize: true } }),
      prisma.file.aggregate({ where: { deletedAt: null }, _sum: { size: true }, _count: { _all: true } }),
      prisma.apiKey.count({ where: { revokedAt: null } }),
    ]);
    const by = Object.fromEntries(JOB_STATUSES.map((s) => [s, jobsByStatus.find((j) => j.status === s)?._count._all ?? 0]));
    const l24 = Object.fromEntries(JOB_STATUSES.map((s) => [s, last24.find((j) => j.status === s)?._count._all ?? 0]));
    return {
      ok: true,
      data: {
        users: { total: users, disabled, admins, newLast7Days: newUsers },
        jobs: { total: Object.values(by).reduce((a, b) => a + b, 0), byStatus: by, last24Hours: l24 },
        topTools: topTools.map((t) => ({ tool: t.tool, count: t._count._all })),
        bytesProcessed: num(processed._sum.inputSize),
        storage: { bytesInUse: num(storageAgg._sum.size), files: storageAgg._count._all },
        activeApiKeys: activeKeys,
      },
    };
  });

  // ---------- Users ----------
  app.get('/admin/users', guard, async (req) => {
    const q = usersQuery.parse(req.query);
    const where: Prisma.UserWhereInput = {
      ...(q.search && { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] }),
      ...(q.status === 'disabled' && { disabledAt: { not: null } }),
      ...(q.status === 'active' && { disabledAt: null }),
    };
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { _count: { select: { jobs: true } } } }),
    ]);
    const ids = users.map((u) => u.id);
    const storageRows = ids.length
      ? await prisma.$queryRaw<{ userId: string; bytes: bigint }[]>(Prisma.sql`
          SELECT j."userId", COALESCE(SUM(f.size), 0) AS bytes FROM "File" f JOIN "Job" j ON j.id = f."jobId"
          WHERE f."deletedAt" IS NULL AND j."userId" IN (${Prisma.join(ids)}) GROUP BY j."userId"`)
      : [];
    const bytes = new Map(storageRows.map((r) => [r.userId, num(r.bytes)]));
    return { ok: true, data: { users: users.map((u) => ({ ...userView(u), jobCount: u._count.jobs, storageBytes: bytes.get(u.id) ?? 0 })), page: q.page, pageSize: q.pageSize, total } };
  });

  app.get('/admin/users/:id', guard, async (req) => {
    const { id } = idParams.parse(req.params);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError('FORBIDDEN', 'User not found.');
    const [byStatus, processed, storageAgg, keys, recent, byTool, apiCalls] = await Promise.all([
      prisma.job.groupBy({ by: ['status'], where: { userId: id }, _count: { _all: true } }),
      prisma.job.aggregate({ where: { userId: id }, _sum: { inputSize: true }, _max: { createdAt: true } }),
      prisma.file.aggregate({ where: { job: { userId: id }, deletedAt: null }, _sum: { size: true }, _count: { _all: true } }),
      prisma.apiKey.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true, revokedAt: true } }),
      prisma.job.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.job.groupBy({ by: ['tool'], where: { userId: id }, _count: { _all: true }, orderBy: { _count: { tool: 'desc' } }, take: 5 }),
      prisma.usageEvent.count({ where: { userId: id, kind: 'api.request' } }),
    ]);
    return {
      ok: true,
      data: {
        user: userView(user),
        usage: {
          jobsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
          bytesProcessed: num(processed._sum.inputSize), lastJobAt: processed._max.createdAt,
          storage: { bytesInUse: num(storageAgg._sum.size), files: storageAgg._count._all },
          topTools: byTool.map((t) => ({ tool: t.tool, count: t._count._all })), apiRequests: apiCalls,
        },
        apiKeys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.keyPrefix, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt, revokedAt: k.revokedAt })),
        recentJobs: recent.map((j) => publicJob(j)),
      },
    };
  });

  app.patch('/admin/users/:id', guard, async (req) => {
    const { id } = idParams.parse(req.params);
    const { disabled } = patchUser.parse(req.body);
    const actor = req.user!;
    if (id === actor.id) throw new AppError('FORBIDDEN', 'You can\'t disable your own account.');
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError('FORBIDDEN', 'User not found.');
    if (disabled && target.role === 'ADMIN') {
      const otherAdmins = await prisma.user.count({ where: { role: 'ADMIN', disabledAt: null, id: { not: id } } });
      if (otherAdmins === 0) throw new AppError('FORBIDDEN', 'You can\'t disable the last active administrator.');
    }
    const updated = await prisma.user.update({
      where: { id },
      // Bumping tokenVersion signs the user out everywhere immediately; their API keys stop working while disabledAt is set.
      data: { disabledAt: disabled ? new Date() : null, ...(disabled && { tokenVersion: { increment: 1 } }) },
    });
    await prisma.auditLog.create({ data: { actorId: actor.id, action: disabled ? 'user.disabled' : 'user.enabled', targetType: 'User', targetId: id } });
    return { ok: true, data: { user: userView(updated) } };
  });

  // ---------- Jobs ----------
  app.get('/admin/jobs', guard, async (req) => {
    const q = jobsQuery.parse(req.query);
    const isUuid = q.q ? z.string().uuid().safeParse(q.q).success : false;
    const where: Prisma.JobWhereInput = {
      ...(q.status && { status: q.status }), ...(q.tool && { tool: q.tool }), ...(q.userId && { userId: q.userId }),
      ...((q.from || q.to) && { createdAt: { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) } }),
      ...(q.q && { OR: [...(isUuid ? [{ id: q.q }] : []), { user: { email: { contains: q.q, mode: 'insensitive' as const } } }] }),
    };
    const [total, jobs] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { files: true, user: { select: { id: true, email: true } } } }),
    ]);
    return {
      ok: true,
      data: { jobs: jobs.map((j) => ({ ...publicJob(j), user: j.user, viaApiKey: j.apiKeyId !== null })), page: q.page, pageSize: q.pageSize, total },
    };
  });

  // ---------- System ----------
  app.get('/admin/system', guard, async () => {
    const timed = async <T>(fn: () => Promise<T>) => { const t = Date.now(); try { return { ok: true as const, latencyMs: Date.now() - t, value: await fn() }; } catch (err) { return { ok: false as const, latencyMs: Date.now() - t, error: (err as Error).message.slice(0, 120), value: undefined }; } };

    const [db, rd] = await Promise.all([timed(() => prisma.$queryRaw`SELECT 1`), timed(async () => (await redis.info('memory')).match(/used_memory_human:(\S+)/)?.[1])]);

    const queueStats: Record<string, unknown> = {};
    for (const kind of Object.keys(QUEUE_NAMES) as WorkerKind[]) {
      const c = await queues[kind].getJobCounts('waiting', 'active', 'delayed', 'failed').catch(() => null);
      queueStats[kind] = c ?? { error: 'unavailable' };
    }

    // Workers announce themselves with a short-lived Redis key (see worker heartbeat).
    const workers: unknown[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'nexora:worker:*', 'COUNT', 100);
      cursor = next;
      for (const raw of keys.length ? await redis.mget(...keys) : []) {
        if (!raw) continue;
        const w = JSON.parse(raw) as { id: string; kinds: string[]; pid: number; startedAt: number; concurrency: number; ts: number };
        workers.push({ id: w.id, kinds: w.kinds, concurrency: w.concurrency, startedAt: new Date(w.startedAt), lastSeenMsAgo: Date.now() - w.ts });
      }
    } while (cursor !== '0');

    const [agg, disk, cleanupRaw] = await Promise.all([
      prisma.file.aggregate({ where: { deletedAt: null }, _sum: { size: true }, _count: { _all: true } }),
      statfs(storage.root).catch(() => null),
      redis.get('nexora:cleanup:last').catch(() => null),
    ]);

    return {
      ok: true,
      data: {
        database: { ok: db.ok, latencyMs: db.latencyMs, ...(db.ok ? {} : { error: db.error }) },
        redis: { ok: rd.ok, latencyMs: rd.latencyMs, usedMemory: rd.value ?? null, ...(rd.ok ? {} : { error: rd.error }) },
        queues: queueStats,
        workers: { count: workers.length, items: workers },
        storage: {
          ok: disk !== null, bytesInUse: num(agg._sum.size), files: agg._count._all,
          disk: disk ? { totalBytes: disk.blocks * disk.bsize, freeBytes: disk.bavail * disk.bsize } : null,
          retentionMinutes: env.FILE_RETENTION_MINUTES,
        },
        cleanup: cleanupRaw ? JSON.parse(cleanupRaw) : null,
        app: { nodeVersion: process.version, uptimeSeconds: Math.round(process.uptime()), environment: env.NODE_ENV },
      },
    };
  });

  app.get('/admin/audit', guard, async (req) => {
    const q = page.parse(req.query);
    const [total, rows] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { actor: { select: { email: true } } } }),
    ]);
    return { ok: true, data: { events: rows.map((r) => ({ id: r.id, action: r.action, actor: r.actor?.email ?? null, targetType: r.targetType, targetId: r.targetId, createdAt: r.createdAt })), page: q.page, pageSize: q.pageSize, total } };
  });
}
