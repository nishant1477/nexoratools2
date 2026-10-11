// Shapes returned by the API (see apps/api/src/lib/serialize.ts).
export type Role = 'USER' | 'ADMIN';
export type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface User { id: string; email: string; name: string; role: Role; plan: string; createdAt: string }
export interface JobFile { id: string; filename: string; mimeType: string; size: number; type: 'INPUT' | 'OUTPUT'; position: number; expiresAt: string; deleted: boolean }
export interface Job {
  id: string; tool: string; status: JobStatus; options: Record<string, unknown>;
  errorCode: string | null; errorMessage: string | null; inputSize: number; outputSize: number | null;
  createdAt: string; startedAt: string | null; completedAt: string | null; expiresAt: string; files?: JobFile[];
}
export interface Page<T> { page: number; pageSize: number; total: number; items: T[] }
export interface Limits { maxUploadBytes: number; retentionMinutes: number }
export interface Usage {
  totalJobs: number; totalConversions: number; byStatus: Record<string, number>; bytesProcessed: number;
  storage: { bytesInUse: number; files: number; retentionMinutes: number }; jobsLast30Days: number;
  topTools: { tool: string; count: number }[]; activeApiKeys: number;
}
export interface ApiKeyInfo { id: string; name: string; prefix: string; lastUsedAt: string | null; createdAt: string; revokedAt: string | null; requests?: number }

export interface AdminStats {
  users: { total: number; disabled: number; admins: number; newLast7Days: number };
  jobs: { total: number; byStatus: Record<JobStatus, number>; last24Hours: Record<JobStatus, number> };
  topTools: { tool: string; count: number }[]; bytesProcessed: number; storage: { bytesInUse: number; files: number }; activeApiKeys: number;
}
export interface AdminUser extends User { disabled: boolean; disabledAt: string | null; jobCount: number; storageBytes: number }
export interface AdminJob extends Job { user: { id: string; email: string }; viaApiKey: boolean }
export interface AdminSystem {
  database: { ok: boolean; latencyMs: number; error?: string };
  redis: { ok: boolean; latencyMs: number; usedMemory: string | null; error?: string };
  queues: Record<string, { waiting: number; active: number; delayed: number; failed: number } | { error: string }>;
  workers: { count: number; items: { id: string; kinds: string[]; concurrency: number; startedAt: string; lastSeenMsAgo: number }[] };
  storage: { ok: boolean; bytesInUse: number; files: number; disk: { totalBytes: number; freeBytes: number } | null; retentionMinutes: number };
  cleanup: { at: string; filesDeleted: number; bytesFreed: number; jobsExpired: number; stuckJobsFailed: number; orphansDeleted: number; jobsPurged: number; durationMs: number } | null;
  app: { nodeVersion: string; uptimeSeconds: number; environment: string };
}
