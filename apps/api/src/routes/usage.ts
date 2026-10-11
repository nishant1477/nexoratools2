import type { FastifyInstance } from 'fastify';

/** Real usage numbers for the signed-in user's dashboard. */
export default async function usageRoutes(app: FastifyInstance) {
  const { prisma, env } = app.ctx;

  app.get('/me/usage', { preHandler: app.requireUser }, async (req) => {
    const userId = req.user!.id;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [byStatus, processed, storage, recent, byTool, activeKeys] = await Promise.all([
      prisma.job.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
      prisma.job.aggregate({ where: { userId, status: { in: ['COMPLETED', 'EXPIRED'] } }, _sum: { inputSize: true } }),
      prisma.file.aggregate({ where: { job: { userId }, deletedAt: null }, _sum: { size: true }, _count: { _all: true } }),
      prisma.job.count({ where: { userId, createdAt: { gte: since } } }),
      prisma.job.groupBy({ by: ['tool'], where: { userId }, _count: { _all: true }, orderBy: { _count: { tool: 'desc' } }, take: 5 }),
      prisma.apiKey.count({ where: { userId, revokedAt: null } }),
    ]);
    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
    const total = byStatus.reduce((n, s) => n + s._count._all, 0);
    return {
      ok: true,
      data: {
        totalJobs: total,
        // "Conversions" = jobs that finished successfully (their files may have expired since).
        totalConversions: (counts.COMPLETED ?? 0) + (counts.EXPIRED ?? 0),
        byStatus: counts,
        bytesProcessed: Number(processed._sum.inputSize ?? 0n),
        storage: { bytesInUse: Number(storage._sum.size ?? 0n), files: storage._count._all, retentionMinutes: env.FILE_RETENTION_MINUTES },
        jobsLast30Days: recent,
        topTools: byTool.map((t) => ({ tool: t.tool, count: t._count._all })),
        activeApiKeys: activeKeys,
      },
    };
  });
}
