import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Env, Storage } from '@nexora/config';
import type { PrismaClient } from '@nexora/database';
import { QUEUE_NAMES, getTool } from '@nexora/shared';
import { Queue } from 'bullmq';

export interface CleanupDeps { env: Env; prisma: PrismaClient; storage: Storage; redis: Redis; log: Logger }
export interface CleanupReport {
  filesDeleted: number; bytesFreed: number; jobsExpired: number; stuckJobsFailed: number;
  orphansDeleted: number; scratchDirsDeleted: number; jobsPurged: number; durationMs: number; at: string;
}

const LOCK_KEY = 'nexora:cleanup:lock';
export const LAST_RUN_KEY = 'nexora:cleanup:last';
const ORPHAN_GRACE_MS = 60 * 60 * 1000; // never touch unknown files younger than this (uploads in flight)
const BATCH = 200;

/**
 * Deletes expired files and tidies related records. Safe to run from several workers at once
 * (Redis lock) and never touches files that belong to QUEUED/PROCESSING jobs.
 */
export async function runCleanup(deps: CleanupDeps): Promise<CleanupReport | null> {
  const { env, prisma, storage, redis, log } = deps;
  const lockMs = 10 * 60 * 1000;
  const locked = await redis.set(LOCK_KEY, String(process.pid), 'PX', lockMs, 'NX');
  if (!locked) { log.debug('cleanup already running elsewhere'); return null; }

  const started = Date.now();
  const report: CleanupReport = { filesDeleted: 0, bytesFreed: 0, jobsExpired: 0, stuckJobsFailed: 0, orphansDeleted: 0, scratchDirsDeleted: 0, jobsPurged: 0, durationMs: 0, at: new Date().toISOString() };
  const now = new Date();

  try {
    // 1) Jobs whose worker died: PROCESSING far past the timeout -> FAILED so their files can be collected.
    const stuckBefore = new Date(Date.now() - (env.JOB_TIMEOUT_SECONDS + 120) * 1000);
    const stuck = await prisma.job.updateMany({
      where: { status: 'PROCESSING', startedAt: { lt: stuckBefore } },
      data: { status: 'FAILED', completedAt: now, errorCode: 'WORKER_FAILURE', errorMessage: 'The processing worker stopped unexpectedly. Please try again.' },
    });
    report.stuckJobsFailed = stuck.count;

    // 2) Jobs that sat in the queue until their inputs expired can never run any more.
    const staleQueued = await prisma.job.findMany({ where: { status: 'QUEUED', expiresAt: { lte: now } }, select: { id: true, tool: true } });
    if (staleQueued.length > 0) {
      await prisma.job.updateMany({
        where: { id: { in: staleQueued.map((j) => j.id) }, status: 'QUEUED' },
        data: { status: 'EXPIRED', completedAt: now, errorCode: 'FILE_EXPIRED', errorMessage: 'This job waited too long and its files expired.' },
      });
      report.jobsExpired += staleQueued.length;
      for (const kind of ['pdf', 'image'] as const) {
        const conn = redis.duplicate();
        const q = new Queue(QUEUE_NAMES[kind], { connection: conn });
        try {
          for (const j of staleQueued) if (getTool(j.tool)?.worker === kind) await q.remove(j.id).catch(() => undefined);
        } finally {
          await q.close();
          conn.disconnect(); // Queue does not own a connection it was handed; close it or the process never exits
        }
      }
    }

    // 3) Expired files of finished jobs: delete bytes first, then mark the row.
    for (;;) {
      const files = await prisma.file.findMany({
        where: { deletedAt: null, expiresAt: { lte: now }, job: { status: { notIn: ['QUEUED', 'PROCESSING'] } } },
        take: BATCH,
        select: { id: true, storageKey: true, size: true },
      });
      if (files.length === 0) break;
      const done: string[] = [];
      for (const f of files) {
        try { await storage.remove(f.storageKey); done.push(f.id); report.bytesFreed += Number(f.size); } // remove() is a no-op if already gone
        catch (err) { log.warn({ err: (err as Error).message, fileId: f.id }, 'could not delete file; will retry next run'); }
      }
      if (done.length === 0) break; // avoid spinning if storage is failing
      await prisma.file.updateMany({ where: { id: { in: done } }, data: { deletedAt: new Date() } });
      report.filesDeleted += done.length;
      if (files.length < BATCH) break;
    }

    // 4) Completed jobs whose outputs are gone become EXPIRED (history keeps the record).
    const expired = await prisma.job.updateMany({ where: { status: 'COMPLETED', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
    report.jobsExpired += expired.count;

    // 5) Purge old history rows (files cascade). Only jobs that are finished and whose files are already gone.
    const purgeBefore = new Date(Date.now() - env.JOB_HISTORY_DAYS * 86_400_000);
    const purged = await prisma.job.deleteMany({
      where: { expiresAt: { lte: purgeBefore }, status: { notIn: ['QUEUED', 'PROCESSING'] }, files: { none: { deletedAt: null } } },
    });
    report.jobsPurged = purged.count;

    // 6) Orphans: files on disk with no database row (crashed uploads), once older than the grace period.
    for (const dir of ['inputs', 'outputs'] as const) {
      const names = await readdir(path.join(storage.root, dir)).catch(() => [] as string[]);
      for (let i = 0; i < names.length; i += BATCH) {
        const slice = names.slice(i, i + BATCH);
        const known = new Set((await prisma.file.findMany({ where: { storageKey: { in: slice.map((n) => `${dir}/${n}`) } }, select: { storageKey: true } })).map((f) => f.storageKey));
        for (const name of slice) {
          if (known.has(`${dir}/${name}`)) continue;
          const full = path.join(storage.root, dir, name);
          const st = await stat(full).catch(() => null);
          if (!st || !st.isFile() || Date.now() - st.mtimeMs < ORPHAN_GRACE_MS) continue;
          await rm(full, { force: true });
          report.orphansDeleted++;
          report.bytesFreed += st.size;
        }
      }
    }

    // 7) Scratch directories left by a crashed worker (job no longer PROCESSING and dir is old).
    const tmpRoot = path.join(storage.root, 'tmp');
    for (const name of await readdir(tmpRoot).catch(() => [] as string[])) {
      const full = path.join(tmpRoot, name);
      const st = await stat(full).catch(() => null);
      if (!st || Date.now() - st.mtimeMs < (env.JOB_TIMEOUT_SECONDS + 120) * 1000) continue;
      const job = await prisma.job.findUnique({ where: { id: name }, select: { status: true } }).catch(() => null);
      if (job?.status === 'PROCESSING') continue;
      await rm(full, { recursive: true, force: true });
      report.scratchDirsDeleted++;
    }

    report.durationMs = Date.now() - started;
    await redis.set(LAST_RUN_KEY, JSON.stringify(report), 'EX', 7 * 86400);
    const interesting = Object.entries(report).some(([k, v]) => typeof v === 'number' && v > 0 && k !== 'durationMs');
    log[interesting ? 'info' : 'debug'](report, 'cleanup finished');
    return report;
  } finally {
    await redis.del(LOCK_KEY).catch(() => undefined);
  }
}
