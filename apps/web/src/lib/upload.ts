import { ApiError, parseEnvelope } from './api';
import type { Job } from './types';

export interface UploadArgs {
  tool: string; files: File[]; options: Record<string, unknown>;
  onProgress?: (fraction: number) => void; signal?: AbortSignal;
}

/**
 * Multipart upload with real byte-level progress (fetch can't report upload progress, XHR can).
 * Resolves with the created Job once the server has accepted and queued it.
 */
export function uploadJob({ tool, files, options, onProgress, signal }: UploadArgs): Promise<Job> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('tool', tool);
    form.append('options', JSON.stringify(options));
    for (const f of files) form.append('file', f, f.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/jobs');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onerror = () => reject(new ApiError('NETWORK', "Can't reach the server. Check your connection and try again.", 0));
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.onload = () => {
      onProgress?.(1);
      parseEnvelope<{ job: Job }>(xhr.status, xhr.responseText).then((d) => resolve(d.job), reject);
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
