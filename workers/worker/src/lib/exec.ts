import { execFile } from 'node:child_process';

export interface ExecResult { stdout: string; stderr: string }

/**
 * Run an external tool WITHOUT a shell (arguments are passed as an array, so filenames and
 * options can never be interpreted as shell syntax). Killed on timeout or abort.
 */
export function run(bin: string, args: string[], opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: opts.timeoutMs ?? 300_000, signal: opts.signal, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { code?: string | number };
        return reject(Object.assign(new Error(`${bin} failed (${e.code ?? 'error'}): ${String(stderr).slice(0, 2000)}`), { stderr: String(stderr), exitCode: e.code }));
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
