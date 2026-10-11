import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { loadEnv } from '@nexora/config';
import { getPrisma } from '@nexora/database';
import { QUEUE_NAMES, type JobPayload, type WorkerKind } from '@nexora/shared';
import { buildApp } from './app.js';
import type { Ctx } from './context.js';
import { hashPassword } from './lib/password.js';
import { Storage } from '@nexora/config';

async function main() {
  const env = loadEnv();
  const prisma = getPrisma(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const storage = new Storage(env.STORAGE_DIR);
  await storage.init();

  const queues = Object.fromEntries(
    (Object.keys(QUEUE_NAMES) as WorkerKind[]).map((kind) => [
      kind,
      new Queue<JobPayload>(QUEUE_NAMES[kind], {
        connection: redis,
        defaultJobOptions: { attempts: 1, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } },
      }),
    ]),
  ) as Ctx['queues'];

  const ctx: Ctx = { env, prisma, redis, storage, queues };
  const app = await buildApp(ctx);

  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    const existing = await prisma.user.findUnique({ where: { email: env.ADMIN_EMAIL.toLowerCase() } });
    if (!existing) {
      await prisma.user.create({ data: { email: env.ADMIN_EMAIL.toLowerCase(), name: 'Administrator', role: 'ADMIN', passwordHash: await hashPassword(env.ADMIN_PASSWORD) } });
      app.log.info('bootstrap admin account created');
    }
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
