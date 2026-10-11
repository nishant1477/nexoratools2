import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';
import type { Env, Storage } from '@nexora/config';
import type { Prisma, PrismaClient } from '@nexora/database';
import { AppError, ERROR_CODES, FILE_KINDS, getTool, type FileKind, type JobPayload } from '@nexora/shared';
import { zipFiles } from './lib/zip.js';
import { processors } from './tools/index.js';
import type { InputFile, OutputFile } from './tools/types.js';

export interface RunnerDeps { env: Env; prisma: PrismaClient; storage: Storage; log: Logger }

const kindFromMime = (mime: string): FileKind | undefined =>
  (Object.keys(FILE_KINDS) as FileKind[]).find((k) => (FILE_KINDS[k].mimeTypes as readonly string[]).includes(mime));

const extOf = (o: OutputFile) => (o.mimeType === 'application/pdf' ? 'pdf' : o.mimeType === 'image/png' ? 'png' : o.mimeType === 'image/jpeg' ? 'jpg' : o.mimeType === 'application/zip' ? 'zip' : 'bin');

/** Turn any thrown value into a safe, user-facing failure. Technical detail stays in the logs. */
function toFailure(err: unknown, timedOut: boolean): { code: string; message: string } {
  if (timedOut) return { code: 'CONVERSION_FAILED', message: 'Processing took too long and was stopped. Try a smaller file.' };
  if (err instanceof AppError) return { code: err.code, message: err.message };
  return { code: 'CONVERSION_FAILED', message: ERROR_CODES.CONVERSION_FAILED.message };
}

/**
 * Universal job pipeline used by every tool:
 * claim -> load inputs -> run processor -> (zip) -> store outputs -> mark COMPLETED.
 * Tool-specific code only lives in the processor.
 */
export async function processJob(payload: JobPayload, deps: RunnerDeps): Promise<void> {
  const { env, prisma, storage } = deps;
  const log = deps.log.child({ jobId: payload.jobId, tool: payload.toolId });

  // Atomic claim: only a QUEUED job can start. Cancelled/expired/duplicate deliveries are skipped.
  const claimed = await prisma.job.updateMany({ where: { id: payload.jobId, status: 'QUEUED' }, data: { status: 'PROCESSING', startedAt: new Date() } });
  if (claimed.count === 0) { log.info('job not in QUEUED state; skipping'); return; }

  const job = await prisma.job.findUniqueOrThrow({ where: { id: payload.jobId }, include: { files: { where: { type: 'INPUT' }, orderBy: { position: 'asc' } } } });
  const abort = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const timer = setTimeout(() => { timedOut = true; abort.abort(); }, env.JOB_TIMEOUT_SECONDS * 1000);
  // If the user cancels while we're working, stop promptly (kills child processes) instead of finishing for nothing.
  const watcher = setInterval(() => {
    prisma.job.findUnique({ where: { id: job.id }, select: { status: true } })
      .then((j) => { if (j?.status === 'CANCELLED' && !cancelled) { cancelled = true; abort.abort(); } })
      .catch(() => undefined);
  }, 1500);
  const storedKeys: string[] = [];

  try {
    const tool = getTool(job.tool);
    const processor = processors.get(job.tool);
    if (!tool || !processor) throw new AppError('WORKER_FAILURE', `No processor registered for tool "${job.tool}".`);

    const now = Date.now();
    const inputs: InputFile[] = [];
    for (const f of job.files) {
      const kind = kindFromMime(f.mimeType);
      let exists = !f.deletedAt && f.expiresAt.getTime() > now && !!kind;
      if (exists) exists = await storage.size(f.storageKey).then(() => true, () => false);
      if (!exists || !kind) throw new AppError('FILE_EXPIRED', 'The uploaded file is no longer available. Please upload it again.');
      inputs.push({ filename: f.filename, path: storage.resolve(f.storageKey), kind, size: Number(f.size) });
    }

    // Re-validate stored options with the tool's own schema (defends against tampered rows).
    const options = tool.options.parse(job.options);
    const workDir = await storage.workDir(job.id);

    let outputs = await Promise.race([
      processor({ jobId: job.id, options: options as Record<string, unknown>, inputs, workDir, env, signal: abort.signal, log }),
      new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })),
    ]);
    if (outputs.length === 0) throw new AppError('CONVERSION_FAILED', 'The tool produced no output.');

    if (tool.output === 'zip' || outputs.length > 1) {
      const zipPath = path.join(workDir, 'result.zip');
      await zipFiles(zipPath, outputs.map((o) => ({ path: o.path, name: o.filename })));
      outputs = [{ path: zipPath, filename: `${job.tool}-result.zip`, mimeType: 'application/zip' }];
    }

    const expiresAt = new Date(Date.now() + env.FILE_RETENTION_MINUTES * 60_000);
    const rows: Prisma.FileCreateManyInput[] = [];
    for (const [position, out] of outputs.entries()) {
      const key = storage.newKey('outputs', extOf(out));
      const size = (await stat(out.path)).size;
      if (size === 0) throw new AppError('CONVERSION_FAILED', 'The tool produced an empty file.');
      await storage.adopt(out.path, key);
      storedKeys.push(key);
      rows.push({ jobId: job.id, filename: out.filename, storageKey: key, mimeType: out.mimeType, size: BigInt(size), type: 'OUTPUT' as const, position, expiresAt });
    }
    const outputSize = rows.reduce((n, r) => n + BigInt(r.size), 0n);

    // Only finish if the job is still ours: a user cancel while we were working wins.
    const done = await prisma.$transaction(async (tx) => {
      const res = await tx.job.updateMany({ where: { id: job.id, status: 'PROCESSING' }, data: { status: 'COMPLETED', completedAt: new Date(), outputSize, expiresAt, errorCode: null, errorMessage: null } });
      if (res.count === 1) await tx.file.createMany({ data: rows });
      return res.count === 1;
    });
    if (!done) {
      log.info('job was cancelled while processing; discarding output');
      await Promise.all(storedKeys.map((k) => storage.remove(k).catch(() => undefined)));
      return;
    }
    log.info({ outputSize: Number(outputSize) }, 'job completed');
  } catch (err) {
    await Promise.all(storedKeys.map((k) => storage.remove(k).catch(() => undefined)));
    if (cancelled) { log.info('job cancelled by user while processing; work stopped'); return; }
    const failure = toFailure(err, timedOut);
    if (failure.code === 'CONVERSION_FAILED' && !(err instanceof AppError)) log.error({ err }, 'job failed');
    else log.warn({ err: (err as Error).message, code: failure.code }, 'job failed');
    await prisma.job.updateMany({ where: { id: job.id, status: 'PROCESSING' }, data: { status: 'FAILED', completedAt: new Date(), errorCode: failure.code, errorMessage: failure.message } });
  } finally {
    clearTimeout(timer);
    clearInterval(watcher);
    abort.abort(); // stop any stray child process
    await storage.removeWorkDir(job.id).catch(() => undefined);
  }
}
