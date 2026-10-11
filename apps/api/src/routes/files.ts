import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '@nexora/shared';

const params = z.object({ id: z.string().uuid() });

/** RFC 6266 filename handling: ASCII fallback + UTF-8 form. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Download handler shared by the browser route and the developer API. Uses req.user for authorization. */
export function makeDownloadHandler(app: FastifyInstance, opts: { ownerOnly?: boolean } = {}) {
  const { prisma, storage } = app.ctx;
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = params.parse(req.params);
    const user = req.user!;
    const file = await prisma.file.findUnique({ where: { id }, include: { job: { select: { userId: true } } } });
    // Someone else's file looks identical to a missing one, so ids can't be probed.
    if (!file || file.type !== 'OUTPUT' || (file.job.userId !== user.id && (user.role !== 'ADMIN' || opts.ownerOnly))) throw new AppError('FILE_NOT_FOUND');
    if (file.deletedAt || file.expiresAt.getTime() <= Date.now()) throw new AppError('FILE_EXPIRED');

    let size: number;
    try { size = await storage.size(file.storageKey); } catch { throw new AppError('FILE_EXPIRED'); }

    return reply
      .header('Content-Type', file.mimeType)
      .header('Content-Length', size)
      .header('Content-Disposition', contentDisposition(file.filename))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(storage.createReadStream(file.storageKey));
  };
}

export default async function fileRoutes(app: FastifyInstance) {
  app.get('/files/:id/download', { preHandler: app.requireUser }, makeDownloadHandler(app));
}
