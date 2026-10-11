'use client';
import Link from 'next/link';
import { use } from 'react';
import { AdminShell } from '@/components/AdminNav';
import { JobsTable } from '@/components/JobsTable';
import { ErrorNotice, PageLoading, Stat } from '@/components/ui';
import { formatBytes, formatDate, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { toolName } from '@/lib/tools';
import type { AdminUser, ApiKeyInfo, Job } from '@/lib/types';

interface Detail {
  user: AdminUser;
  usage: { jobsByStatus: Record<string, number>; bytesProcessed: number; lastJobAt: string | null; storage: { bytesInUse: number; files: number }; topTools: { tool: string; count: number }[]; apiRequests: number };
  apiKeys: ApiKeyInfo[]; recentJobs: Job[];
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useApi<Detail>(`/admin/users/${id}`);
  const total = data ? Object.values(data.usage.jobsByStatus).reduce((a, b) => a + b, 0) : 0;
  return (
    <AdminShell title={data?.user.name ?? 'User'}>
      <p className="-mt-6 mb-8"><Link href="/admin/users" className="text-sm font-semibold text-pine underline">All users</Link></p>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data ? <PageLoading /> : data && (<>
        <p className="text-muted">{data.user.email} · {data.user.role === 'ADMIN' ? 'Administrator' : 'User'} · joined {formatDate(data.user.createdAt)}{data.user.disabled ? ' · account disabled' : ''}</p>
        <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Jobs" value={total} note={data.usage.lastJobAt ? `last ${timeAgo(data.usage.lastJobAt)}` : 'none yet'} />
          <Stat label="Completed" value={(data.usage.jobsByStatus.COMPLETED ?? 0) + (data.usage.jobsByStatus.EXPIRED ?? 0)} note={`${data.usage.jobsByStatus.FAILED ?? 0} failed`} />
          <Stat label="Stored now" value={formatBytes(data.usage.storage.bytesInUse)} note={`${data.usage.storage.files} files`} />
          <Stat label="API requests" value={data.usage.apiRequests} note={`${formatBytes(data.usage.bytesProcessed)} processed`} />
        </div>
        {data.usage.topTools.length > 0 && <p className="mt-6 text-sm text-muted">Most used: {data.usage.topTools.map((t) => `${toolName(t.tool)} (${t.count})`).join(', ')}</p>}

        <h2 className="mb-4 mt-14 text-2xl">API keys</h2>
        {data.apiKeys.length === 0 ? <p className="text-muted">No keys.</p> : (
          <table className="ledger"><thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th>State</th></tr></thead>
            <tbody>{data.apiKeys.map((k) => <tr key={k.id}><td>{k.name}</td><td><code>{k.prefix}…</code></td><td className="text-muted">{formatDate(k.createdAt)}</td><td className="text-muted">{k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'Never'}</td><td>{k.revokedAt ? 'Revoked' : 'Active'}</td></tr>)}</tbody></table>)}

        <h2 className="mb-4 mt-14 text-2xl">Recent jobs</h2>
        {data.recentJobs.length === 0 ? <p className="text-muted">No jobs.</p> : <JobsTable jobs={data.recentJobs} admin />}
      </>)}
    </AdminShell>
  );
}
