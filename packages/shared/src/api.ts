/** Consistent JSON envelope for every API response. */
export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const JOB_STATUSES = ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'];

/** Payload placed on the BullMQ queue. Workers load everything else from PostgreSQL. */
export type JobPayload = { jobId: string; toolId: string };

export const QUEUE_NAMES = { pdf: 'nexora-pdf', image: 'nexora-image' } as const;
export type WorkerKind = keyof typeof QUEUE_NAMES;
