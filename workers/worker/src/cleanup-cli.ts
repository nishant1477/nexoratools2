// One-shot cleanup: `npm run cleanup:once -w @nexora/worker`
import { Redis } from 'ioredis';
import pino from 'pino';
import { Storage, loadEnv } from '@nexora/config';
import { getPrisma } from '@nexora/database';
import { runCleanup } from './cleanup.js';

const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL, name: 'cleanup' });
const prisma = getPrisma(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const storage = new Storage(env.STORAGE_DIR);
await storage.init();
const report = await runCleanup({ env, prisma, storage, redis, log });
console.log(report ? JSON.stringify(report, null, 2) : 'another cleanup is already running');
await prisma.$disconnect();
redis.disconnect();
