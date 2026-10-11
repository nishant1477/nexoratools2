import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@nexora/shared';

/**
 * Local-disk storage. Callers only ever handle opaque storage keys; the original filename
 * never touches the filesystem. Keys are validated and resolved inside the storage root.
 */
const KEY_RE = /^(inputs|outputs)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$/;

export class Storage {
  readonly root: string;
  constructor(dir: string) {
    this.root = path.resolve(dir);
  }

  newKey(kind: 'inputs' | 'outputs', ext: string): string {
    return `${kind}/${randomUUID()}.${ext.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5) || 'bin'}`;
  }

  /** Resolve a key to an absolute path, refusing anything outside the root. */
  resolve(key: string): string {
    if (!KEY_RE.test(key)) throw new AppError('STORAGE_FAILURE', 'Invalid storage key');
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new AppError('STORAGE_FAILURE', 'Path escape blocked');
    return full;
  }

  async init(): Promise<void> {
    await mkdir(path.join(this.root, 'inputs'), { recursive: true, mode: 0o750 });
    await mkdir(path.join(this.root, 'outputs'), { recursive: true, mode: 0o750 });
    await mkdir(path.join(this.root, 'tmp'), { recursive: true, mode: 0o750 });
  }

  /** Scratch directory for one job (same filesystem as final storage, so finishing is a cheap rename). */
  async workDir(jobId: string): Promise<string> {
    if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new AppError('STORAGE_FAILURE', 'Invalid job id');
    const dir = path.join(this.root, 'tmp', jobId);
    await mkdir(dir, { recursive: true, mode: 0o750 });
    return dir;
  }

  async removeWorkDir(jobId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(jobId)) return;
    await rm(path.join(this.root, 'tmp', jobId), { recursive: true, force: true });
  }

  /** Move a finished file from a work directory into permanent (temporary-retention) storage under `key`. */
  async adopt(absPath: string, key: string): Promise<void> {
    const dest = this.resolve(key);
    try {
      await rename(absPath, dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      await copyFile(absPath, dest);
      await rm(absPath, { force: true });
    }
  }

  createWriteStream(key: string) {
    return createWriteStream(this.resolve(key), { flags: 'wx', mode: 0o640 });
  }

  createReadStream(key: string) {
    return createReadStream(this.resolve(key));
  }

  async size(key: string): Promise<number> {
    return (await stat(this.resolve(key))).size;
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
