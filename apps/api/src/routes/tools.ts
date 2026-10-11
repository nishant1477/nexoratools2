import type { FastifyInstance } from 'fastify';
import { CATEGORIES, FILE_KINDS, TOOLS } from '@nexora/shared';

export default async function toolRoutes(app: FastifyInstance) {
  const { env } = app.ctx;
  // Public metadata; zod schemas are deliberately not serialised.
  const tools = TOOLS.map((t) => ({
    id: t.id, name: t.name, description: t.description, category: t.category, icon: t.icon,
    minFiles: t.minFiles, maxFiles: Math.min(t.maxFiles, env.MAX_FILES_PER_JOB),
    orderMatters: 'orderMatters' in t ? t.orderMatters : false, output: t.output,
    popular: 'popular' in t ? t.popular : false,
    accepts: t.accepts.map((k) => ({ kind: k, ...FILE_KINDS[k] })),
    optionFields: 'optionFields' in t ? t.optionFields : [],
  }));

  app.get('/tools', async () => ({
    ok: true,
    data: { tools, categories: CATEGORIES, limits: { maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024, retentionMinutes: env.FILE_RETENTION_MINUTES } },
  }));
}
