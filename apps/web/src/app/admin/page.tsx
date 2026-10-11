'use client';
import { AdminShell } from '@/components/AdminNav';
import { ErrorNotice, PageLoading, Stat } from '@/components/ui';
import { formatBytes } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { toolName } from '@/lib/tools';
import type { AdminStats, JobStatus } from '@/lib/types';

const ORDER: JobStatus[] = ['COMPLETED', 'PROCESSING', 'QUEUED', 'FAILED', 'EXPIRED', 'CANCELLED'];

export default function Page() {
  const { data, error, loading, reload } = useApi<AdminStats>('/admin/stats', '/admin/stats', 15000);
  const max = Math.max(1, ...(data?.topTools.map((t) => t.count) ?? [1]));
  return (
    <AdminShell title="Admin">
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data ? <PageLoading /> : data && (<>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Users" value={data.users.total} note={`${data.users.newLast7Days} new this week · ${data.users.disabled} disabled`} />
          <Stat label="Jobs" value={data.jobs.total} note={`${data.jobs.last24Hours.COMPLETED + data.jobs.last24Hours.FAILED + data.jobs.last24Hours.QUEUED + data.jobs.last24Hours.PROCESSING + data.jobs.last24Hours.EXPIRED + data.jobs.last24Hours.CANCELLED} in the last 24 hours`} />
          <Stat label="Completed" value={data.jobs.byStatus.COMPLETED + data.jobs.byStatus.EXPIRED} note="finished successfully" />
          <Stat label="Failed" value={data.jobs.byStatus.FAILED} note={`${data.jobs.last24Hours.FAILED} in the last 24 hours`} />
          <Stat label="Processing now" value={data.jobs.byStatus.PROCESSING + data.jobs.byStatus.QUEUED} note={`${data.jobs.byStatus.PROCESSING} running, ${data.jobs.byStatus.QUEUED} queued`} />
          <Stat label="Storage in use" value={formatBytes(data.storage.bytesInUse)} note={`${data.storage.files} files · ${formatBytes(data.bytesProcessed)} processed overall`} />
        </div>

        <div className="mt-16 grid gap-12 lg:grid-cols-2">
          <section aria-labelledby="st-h">
            <h2 id="st-h" className="mb-4 text-2xl">Jobs by status</h2>
            <table className="ledger"><tbody>{ORDER.map((s) => <tr key={s}><td>{s[0] + s.slice(1).toLowerCase()}</td><td className="text-right tabular-nums">{data.jobs.byStatus[s]}</td></tr>)}</tbody></table>
          </section>
          <section aria-labelledby="tt-h">
            <h2 id="tt-h" className="mb-4 text-2xl">Most used tools</h2>
            {data.topTools.length === 0 ? <p className="text-muted">No jobs yet.</p> : (
              <ul className="space-y-3">{data.topTools.map((t) => (
                <li key={t.tool}>
                  <div className="flex justify-between text-sm"><span>{toolName(t.tool)}</span><span className="tabular-nums text-muted">{t.count}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-sunken"><div className="h-full rounded-full bg-pine" style={{ width: `${(t.count / max) * 100}%` }} /></div>
                </li>))}</ul>)}
            <p className="mt-6 text-sm text-muted">{data.activeApiKeys} active API keys · {data.users.admins} administrators</p>
          </section>
        </div>
      </>)}
    </AdminShell>
  );
}
