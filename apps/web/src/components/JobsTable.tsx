'use client';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { formatBytes, formatDate } from '@/lib/format';
import { toolName } from '@/lib/tools';
import type { AdminJob, Job } from '@/lib/types';
import { StatusBadge } from './ui';

export const inputName = (j: Job) => {
  const ins = j.files?.filter((f) => f.type === 'INPUT') ?? [];
  return ins.length === 0 ? '—' : ins.length === 1 ? ins[0]!.filename : `${ins[0]!.filename} + ${ins.length - 1} more`;
};

/** First downloadable result for a job, if it still exists. */
export const downloadable = (j: Job) => (j.status === 'COMPLETED' ? j.files?.find((f) => f.type === 'OUTPUT' && !f.deleted && new Date(f.expiresAt) > new Date()) : undefined);

export function JobsTable({ jobs, admin }: { jobs: (Job | AdminJob)[]; admin?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="ledger">
        <thead><tr><th>Tool</th><th>File</th>{admin && <th>User</th>}<th>Status</th><th>Date</th><th className="text-right">Size</th><th><span className="sr-only">Actions</span>{admin ? 'Error' : ''}</th></tr></thead>
        <tbody>
          {jobs.map((j) => {
            const dl = downloadable(j);
            return (
              <tr key={j.id}>
                <td className="whitespace-nowrap font-medium">{toolName(j.tool)}</td>
                <td className="max-w-[16rem] truncate" title={inputName(j)}>{inputName(j)}</td>
                {admin && <td className="max-w-[12rem] truncate">{'user' in j ? <Link className="underline" href={`/admin/users/${j.user.id}`}>{j.user.email}</Link> : null}{'viaApiKey' in j && j.viaApiKey ? <span className="ml-1 rounded bg-sunken px-1.5 text-xs">API</span> : null}</td>}
                <td><StatusBadge status={j.status} /></td>
                <td className="whitespace-nowrap text-muted">{formatDate(j.createdAt)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{formatBytes(j.inputSize)}{j.outputSize !== null ? <span className="text-muted"> → {formatBytes(j.outputSize)}</span> : null}</td>
                <td className="min-w-[8rem]">
                  {dl ? <a className="btn btn-quiet btn-sm" href={`/api/files/${dl.id}/download`} download={dl.filename}><Download className="h-4 w-4" aria-hidden />Download</a>
                    : j.status === 'EXPIRED' ? <span className="text-sm text-muted">File deleted</span>
                    : j.errorMessage && (j.status === 'FAILED' || admin) ? <span className="text-sm text-danger" title={j.errorMessage}>{j.errorMessage.length > 70 && !admin ? `${j.errorMessage.slice(0, 70)}…` : j.errorMessage}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
