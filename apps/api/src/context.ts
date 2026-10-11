import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Env } from '@nexora/config';
import type { ApiKey, PrismaClient, User } from '@nexora/database';
import type { JobPayload, WorkerKind } from '@nexora/shared';
import type { Storage } from '@nexora/config';

export interface Ctx {
  env: Env;
  prisma: PrismaClient;
  redis: Redis;
  storage: Storage;
  queues: Record<WorkerKind, Queue<JobPayload>>;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Ctx;
    requireUser: (req: FastifyRequest) => Promise<void>;
    requireAdmin: (req: FastifyRequest) => Promise<void>;
    requireApiKey: (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    user: User | null;
    apiKey: ApiKey | null;
  }
}
