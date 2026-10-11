import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { Storage, loadEnv } from '@nexora/config';
import { getPrisma } from '@nexora/database';
import { QUEUE_NAMES, type JobPayload, type WorkerKind } from '@nexora/shared';
import { runCleanup } from './cleanup.js';
import { processJob } from './runner.js';
import { processors } from './tools/index.js';

async function main() {
  const env = loadEnv();
  const log = pino({ level: env.LOG_LEVEL, name: 'worker' });
  const prisma = getPrisma(env.DATABASE_URL);
  const storage = new Storage(env.STORAGE_DIR);
  await storage.init();

  const kinds = env.WORKER_KINDS.split(',').map((s) => s.trim()).filter(Boolean) as WorkerKind[];
  for (const k of kinds) if (!(k in QUEUE_NAMES)) throw new Error(`Unknown WORKER_KINDS entry "${k}". Valid: ${Object.keys(QUEUE_NAMES).join(', ')}`);

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const deps = { env, prisma, storage, log };

  const workers = kinds.map((kind) => {
    const worker = new Worker<JobPayload>(QUEUE_NAMES[kind], (job) => processJob(job.data, deps), {
      connection: connection.duplicate(),
      concurrency: env.WORKER_CONCURRENCY,
      lockDuration: (env.JOB_TIMEOUT_SECONDS + 60) * 1000,
    });
    // Safety net for crashes/stalls that never reached our own error handling.
    worker.on('failed', (job, err) => {
      log.error({ jobId: job?.id, err: err.message }, 'queue reported job failure');
      if (!job) return;
      void prisma.job.updateMany({
        where: { id: job.data.jobId, status: { in: ['QUEUED', 'PROCESSING'] } },
        data: { status: 'FAILED', completedAt: new Date(), errorCode: 'WORKER_FAILURE', errorMessage: 'The processing worker stopped unexpectedly. Please try again.' },
      });
    });
    worker.on('error', (err) => log.error({ err: err.message }, 'worker error'));
    return worker;
  });

  // Heartbeat so the admin dashboard can show live workers.
  const id = `${os.hostname()}:${process.pid}`;
  const beat = () => connection.set(`nexora:worker:${id}`, JSON.stringify({ id, kinds, pid: process.pid, startedAt, concurrency: env.WORKER_CONCURRENCY, tools: [...processors.keys()].length, ts: Date.now() }), 'EX', 30).catch(() => undefined);
  const startedAt = Date.now();
  // Liveness file for the container HEALTHCHECK: touched on every heartbeat, so a wedged event loop or lost Redis shows up as "unhealthy".
  const livenessFile = process.env.WORKER_LIVENESS_FILE ?? '/tmp/nexora-worker-alive';
  const touch = () => writeFile(livenessFile, String(Date.now())).catch(() => undefined);
  const pulse = async () => {
    await connection.ping().then(touch, () => undefined);
    await beat();
  };
  await pulse();
  const hb = setInterval(() => void pulse(), 10_000);

  // Periodic cleanup (guarded by a Redis lock, so running several workers is fine).
  let cleanupTimer: NodeJS.Timeout | undefined;
  if (env.CLEANUP_ENABLED) {
    const tick = () => runCleanup({ env, prisma, storage, redis: connection, log }).catch((err) => log.error({ err: (err as Error).message }, 'cleanup failed'));
    setTimeout(tick, 5_000); // first pass shortly after start
    cleanupTimer = setInterval(tick, env.CLEANUP_INTERVAL_MINUTES * 60_000);
  }

  log.info({ kinds, concurrency: env.WORKER_CONCURRENCY, tools: [...processors.keys()] }, 'worker started');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    clearInterval(hb);
    if (cleanupTimer) clearInterval(cleanupTimer);
    await connection.del(`nexora:worker:${id}`).catch(() => undefined);
    await Promise.all(workers.map((w) => w.close())); // waits for in-flight jobs
    await prisma.$disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => { console.error(err); process.exit(1); });
