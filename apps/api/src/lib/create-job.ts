import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma, type User } from '@nexora/database';
import { AppError, getTool, type FileKind } from '@nexora/shared';
import { canonicalMime, extensionMatches, extensionOf, sanitizeFilename, sniffKind } from './sniff.js';

interface Saved { key: string; filename: string; size: number; kind: FileKind | null; ext: string }
export interface CreateJobOptions { user: User; apiKeyId?: string; publicOnly?: boolean }

/**
 * Shared by the browser endpoint (POST /api/jobs) and the developer API (POST /api/v1/jobs):
 * streams uploads to disk, validates them, creates the Job + File rows, and enqueues it.
 */
export function makeJobCreator(app: FastifyInstance) {
  const { env, prisma, storage, queues } = app.ctx;
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  const maxTotalBytes = maxBytes * 4; // whole-request cap so 20 x max-size merges can't fill the disk

  /** Stream one upload to disk (never buffered in memory), recording size and the first bytes for sniffing. */
  async function saveUpload(file: NodeJS.ReadableStream & { truncated?: boolean }, filename: string): Promise<Saved> {
    const key = storage.newKey('inputs', 'bin');
    let head = Buffer.alloc(0);
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
        size += chunk.length;
        cb(null, chunk);
      },
    });
    try {
      await pipeline(file, meter, storage.createWriteStream(key));
    } catch (err) {
      await storage.remove(key).catch(() => undefined);
      throw err;
    }
    if (file.truncated) {
      await storage.remove(key).catch(() => undefined);
      throw new AppError('FILE_TOO_LARGE', `"${filename}" is larger than ${env.MAX_UPLOAD_MB} MB.`);
    }
    return { key, filename, size, kind: sniffKind(head), ext: extensionOf(filename) };
  }


  return async function createJob(req: FastifyRequest, opts: CreateJobOptions) {
    const { user } = opts;

    if (!req.isMultipart()) throw new AppError('EMPTY_UPLOAD');

    const active = await prisma.job.count({ where: { userId: user.id, status: { in: ['QUEUED', 'PROCESSING'] } } });
    if (active >= env.MAX_ACTIVE_JOBS_PER_USER) {
      throw new AppError('RATE_LIMITED', `You already have ${active} jobs running. Wait for one to finish.`);
    }

    const saved: Saved[] = [];
    const fields: Record<string, string> = {};
    const discard = () => Promise.all(saved.map((s) => storage.remove(s.key).catch(() => undefined)));

    try {
      let total = 0;
      for await (const part of req.parts({ limits: { fileSize: maxBytes, files: env.MAX_FILES_PER_JOB, fields: 10, fieldSize: 20_000, parts: env.MAX_FILES_PER_JOB + 10 } })) {
        if (part.type === 'field') {
          if (typeof part.value === 'string') fields[part.fieldname] = part.value;
          continue;
        }
        const filename = sanitizeFilename(part.filename);
        const s = await saveUpload(part.file, filename);
        saved.push(s);
        total += s.size;
        if (total > maxTotalBytes) throw new AppError('FILE_TOO_LARGE', 'The combined size of the files is too large.');
      }

      const tool = getTool(fields.tool ?? '');
      if (!tool) throw new AppError('VALIDATION_ERROR', 'Unknown tool.');
      if (opts.publicOnly && !tool.publicApi) throw new AppError('FORBIDDEN', `${tool.name} is not available through the API yet.`);

      if (saved.length === 0 || saved.every((s) => s.size === 0)) throw new AppError('EMPTY_UPLOAD');
      const maxFiles = Math.min(tool.maxFiles, env.MAX_FILES_PER_JOB);
      if (saved.length > maxFiles) throw new AppError('TOO_MANY_FILES', `${tool.name} accepts at most ${maxFiles} file${maxFiles === 1 ? '' : 's'}.`);
      if (saved.length < tool.minFiles) throw new AppError('TOO_FEW_FILES', `${tool.name} needs at least ${tool.minFiles} files.`);

      for (const s of saved) {
        if (s.size === 0) throw new AppError('EMPTY_UPLOAD', `"${s.filename}" is empty.`);
        // Content must match a kind the tool accepts AND the extension must agree with it.
        if (!s.kind || !tool.accepts.includes(s.kind) || !extensionMatches(s.kind, s.ext)) {
          const wanted = tool.accepts.map((k) => k.toUpperCase()).join(' or ');
          throw new AppError('UNSUPPORTED_FILE', `"${s.filename}" is not a valid ${wanted} file.`);
        }
      }

      let options: unknown = {};
      if (fields.options) {
        try { options = JSON.parse(fields.options); } catch { throw new AppError('INVALID_OPTIONS', 'Options must be valid JSON.'); }
      }
      const parsed = tool.options.safeParse(options ?? {});
      if (!parsed.success) throw new AppError('INVALID_OPTIONS', parsed.error.issues[0]?.message, parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));

      const expiresAt = new Date(Date.now() + env.FILE_RETENTION_MINUTES * 60_000);
      const inputSize = saved.reduce((n, s) => n + s.size, 0);
      // Storage keys keep a real extension only for outputs; inputs are opaque ".bin" and never executed.
      const job = await prisma.$transaction(async (tx) => {
        const created = await tx.job.create({
          data: {
            userId: user.id, apiKeyId: opts.apiKeyId ?? null, tool: tool.id, options: parsed.data as Prisma.InputJsonValue, inputSize: BigInt(inputSize), expiresAt,
            files: {
              create: saved.map((s, position) => ({
                filename: s.filename, storageKey: s.key, mimeType: canonicalMime(s.kind as FileKind),
                size: BigInt(s.size), type: 'INPUT' as const, position, expiresAt,
              })),
            },
          },
          include: { files: true },
        });
        await tx.usageEvent.create({ data: { userId: user.id, apiKeyId: opts.apiKeyId ?? null, kind: 'job.created', tool: tool.id, bytes: BigInt(inputSize) } });
        return created;
      });

      try {
        await queues[tool.worker].add(tool.id, { jobId: job.id, toolId: tool.id }, { jobId: job.id });
      } catch (err) {
        req.log.error({ err, jobId: job.id }, 'failed to enqueue job');
        await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: 'WORKER_FAILURE', errorMessage: 'Could not queue the job. Please try again.', completedAt: new Date() } });
        await discard();
        throw new AppError('INTERNAL', 'Could not queue the job. Please try again.');
      }
      return job;
    } catch (err) {
      // Anything thrown before the DB row exists must not leave orphaned uploads behind.
      const persisted = saved.length > 0 && (await prisma.file.count({ where: { storageKey: { in: saved.map((s) => s.key) } } })) > 0;
      if (!persisted) await discard();
      throw err;
    }
  };
}
