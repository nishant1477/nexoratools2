import { z } from 'zod';

const int = (def: number, min = 0) => z.coerce.number().int().min(min).default(def);
const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Services
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // API
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: int(4000, 1),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_COOKIE_NAME: z.string().default('nexora_session'),
  SESSION_TTL_HOURS: int(24 * 7, 1),
  COOKIE_SECURE: bool,
  TRUST_PROXY: bool,

  // Storage (must live outside any served/executable directory)
  STORAGE_DIR: z.string().default('./storage'),
  FILE_RETENTION_MINUTES: int(60, 1),
  CLEANUP_INTERVAL_MINUTES: int(5, 1),
  CLEANUP_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  JOB_HISTORY_DAYS: int(30, 1), // job rows (not files) are purged this long after expiry

  // Limits
  MAX_UPLOAD_MB: int(50, 1),
  MAX_FILES_PER_JOB: int(50, 1),
  MAX_ACTIVE_JOBS_PER_USER: int(10, 1),
  UPLOAD_RATE_LIMIT: int(30, 1), // uploads per window
  UPLOAD_RATE_WINDOW_SECONDS: int(60, 1),
  API_RATE_LIMIT: int(300, 1), // requests per window
  API_RATE_WINDOW_SECONDS: int(60, 1),
  API_KEYS_PER_USER: int(10, 1),
  AUTH_RATE_LIMIT: int(10, 1), // login/register attempts per window
  AUTH_RATE_WINDOW_SECONDS: int(60, 1),

  // Workers
  WORKER_KINDS: z.string().default('pdf,image'), // comma list: which queues this worker process serves
  WORKER_CONCURRENCY: int(2, 1),
  JOB_TIMEOUT_SECONDS: int(300, 10),
  MAX_PDF_PAGES: int(300, 1),
  GHOSTSCRIPT_BIN: z.string().default('gs'),
  PDFTOPPM_BIN: z.string().default('pdftoppm'),

  // Bootstrap admin (created on API start if both are set and the user doesn't exist)
  ADMIN_EMAIL: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  ADMIN_PASSWORD: z.string().min(10).optional().or(z.literal('').transform(() => undefined)),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parse and validate process.env once. Fails fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export const maxUploadBytes = (env: Env) => env.MAX_UPLOAD_MB * 1024 * 1024;
export const retentionMs = (env: Env) => env.FILE_RETENTION_MINUTES * 60 * 1000;

export { Storage } from './storage.js';
