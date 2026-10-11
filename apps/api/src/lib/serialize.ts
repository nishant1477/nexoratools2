import type { File, Job, User } from '@nexora/database';

// BigInt is not JSON-serialisable; sizes are well below 2^53 so Number is safe.
export const publicUser = (u: User) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, plan: u.plan, createdAt: u.createdAt,
});

export const publicFile = (f: File) => ({
  id: f.id, filename: f.filename, mimeType: f.mimeType, size: Number(f.size), type: f.type,
  position: f.position, expiresAt: f.expiresAt, deleted: f.deletedAt !== null,
});

export const publicJob = (j: Job & { files?: File[] }) => ({
  id: j.id, tool: j.tool, status: j.status, options: j.options,
  errorCode: j.errorCode, errorMessage: j.errorMessage,
  inputSize: Number(j.inputSize), outputSize: j.outputSize === null ? null : Number(j.outputSize),
  createdAt: j.createdAt, startedAt: j.startedAt, completedAt: j.completedAt, expiresAt: j.expiresAt,
  files: j.files?.sort((a, b) => a.position - b.position).map(publicFile),
});
