'use client';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/AdminNav';
import { ErrorNotice, PageLoading } from '@/components/ui';
import { formatBytes, formatDate, formatDuration, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { AdminSystem } from '@/lib/types';

const Dot = ({ ok }: { ok: boolean }) => <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-ok' : 'bg-danger'}`} aria-hidden />;
const Panel = ({ title, ok, children }: { title: string; ok?: boolean; children: ReactNode }) => (
  <section className="rounded-lg border border-line bg-sheet p-5" aria-label={title}>
    <h2 className="mb-3 flex items-center gap-2.5 text-xl">{ok !== undefined && <Dot ok={ok} />}{title}{ok !== undefined && <span className="sr-only">{ok ? 'healthy' : 'problem'}</span>}</h2>
    <div className="space-y-1 text-sm">{children}</div>
  </section>
);
const Row = ({ k, v }: { k: string; v: ReactNode }) => <div className="flex justify-between gap-4"><span className="text-muted">{k}</span><span className="text-right font-medium tabular-nums">{v}</span></div>;

export default function Page() {
  const { data: s, error, loading, reload } = useApi<AdminSystem>('/admin/system', '/admin/system', 5000);
  return (
    <AdminShell title="System">
      <p className="-mt-6 mb-8 text-sm text-muted">Refreshes every few seconds.</p>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !s ? <PageLoading /> : s && (
        <div className="grid gap-5 md:grid-cols-2">
          <Panel title="Database" ok={s.database.ok}><Row k="Response time" v={`${s.database.latencyMs} ms`} />{s.database.error && <p className="text-danger">{s.database.error}</p>}</Panel>
          <Panel title="Redis" ok={s.redis.ok}><Row k="Response time" v={`${s.redis.latencyMs} ms`} /><Row k="Memory used" v={s.redis.usedMemory ?? '—'} />{s.redis.error && <p className="text-danger">{s.redis.error}</p>}</Panel>
          <Panel title="Queues" ok={Object.values(s.queues).every((q) => !('error' in q))}>
            {Object.entries(s.queues).map(([name, q]) => 'error' in q ? <Row key={name} k={name} v="unavailable" /> : <Row key={name} k={`${name[0]!.toUpperCase()}${name.slice(1)}`} v={`${q.waiting} waiting · ${q.active} active · ${q.failed} failed`} />)}
          </Panel>
          <Panel title="Workers" ok={s.workers.count > 0}>
            {s.workers.count === 0 ? <p className="text-danger">No worker is reporting in. Jobs will wait in the queue.</p> : s.workers.items.map((w) => (
              <div key={w.id} className="border-b border-line pb-2 last:border-0"><Row k={w.id} v={`${w.kinds.join(' + ')} · ${w.concurrency} at a time`} /><Row k="Up since" v={formatDate(w.startedAt)} /><Row k="Last heartbeat" v={`${Math.round(w.lastSeenMsAgo / 1000)} s ago`} /></div>))}
          </Panel>
          <Panel title="Storage" ok={s.storage.ok}>
            <Row k="Held by active files" v={`${formatBytes(s.storage.bytesInUse)} · ${s.storage.files} files`} />
            {s.storage.disk && <Row k="Disk free" v={`${formatBytes(s.storage.disk.freeBytes)} of ${formatBytes(s.storage.disk.totalBytes)}`} />}
            <Row k="Retention" v={`${s.storage.retentionMinutes} min`} />
          </Panel>
          <Panel title="Last cleanup">
            {s.cleanup ? (<><Row k="Ran" v={timeAgo(s.cleanup.at)} /><Row k="Took" v={formatDuration(s.cleanup.durationMs)} /><Row k="Files deleted" v={`${s.cleanup.filesDeleted} (${formatBytes(s.cleanup.bytesFreed)})`} /><Row k="Jobs expired" v={s.cleanup.jobsExpired} /><Row k="Stuck jobs failed" v={s.cleanup.stuckJobsFailed} /><Row k="Orphans removed" v={s.cleanup.orphansDeleted} /></>) : <p className="text-muted">No cleanup has run yet.</p>}
          </Panel>
          <p className="text-sm text-muted md:col-span-2">API server: Node {s.app.nodeVersion.replace('v', '')}, up {formatDuration(s.app.uptimeSeconds * 1000)}, {s.app.environment}.</p>
        </div>
      )}
    </AdminShell>
  );
}
