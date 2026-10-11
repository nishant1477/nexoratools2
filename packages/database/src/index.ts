import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __nexoraPrisma?: PrismaClient };

/**
 * Single shared client per process. Uses the driver-adapter (query compiler) mode so no
 * native Rust query engine binary is required at runtime.
 */
export function getPrisma(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  globalForPrisma.__nexoraPrisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return globalForPrisma.__nexoraPrisma;
}
