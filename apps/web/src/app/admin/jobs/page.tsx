'use client';
import { useState } from 'react';
import { AdminShell } from '@/components/AdminNav';
import { JobsTable } from '@/components/JobsTable';
import { EmptyState, ErrorNotice, PageLoading, Pagination } from '@/components/ui';
import { useApi } from '@/lib/hooks';
import { ALL_TOOLS } from '@/lib/tools';
import type { AdminJob } from '@/lib/types';

const STATUSES = ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'];

export default function Page() {
  const [f, setF] = useState({ status: '', tool: '', q: '', from: '', to: '' });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({
    page: String(page), pageSize: '20',
    ...(applied.status && { status: applied.status }), ...(applied.tool && { tool: applied.tool }), ...(applied.q && { q: applied.q }),
    ...(applied.from && { from: new Date(`${applied.from}T00:00:00`).toISOString() }), ...(applied.to && { to: new Date(`${applied.to}T23:59:59`).toISOString() }),
  }).toString();
  const { data, error, loading, reload } = useApi<{ jobs: AdminJob[]; total: number; page: number; pageSize: number }>(`/admin/jobs?${qs}`, qs, 8000);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((c) => ({ ...c, [k]: e.target.value }));

  return (
    <AdminShell title="Jobs">
      <form className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); setApplied(f); setPage(1); }}>
        <div className="lg:col-span-2"><label htmlFor="j-q" className="mb-1 block text-sm font-semibold">User email or job ID</label><input id="j-q" className="field" value={f.q} onChange={set('q')} /></div>
        <div><label htmlFor="j-status" className="mb-1 block text-sm font-semibold">Status</label><select id="j-status" className="field" value={f.status} onChange={set('status')}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}</select></div>
        <div><label htmlFor="j-tool" className="mb-1 block text-sm font-semibold">Tool</label><select id="j-tool" className="field" value={f.tool} onChange={set('tool')}><option value="">All</option>{ALL_TOOLS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div><label htmlFor="j-from" className="mb-1 block text-sm font-semibold">From</label><input id="j-from" type="date" className="field" value={f.from} onChange={set('from')} /></div>
        <div><label htmlFor="j-to" className="mb-1 block text-sm font-semibold">To</label><input id="j-to" type="date" className="field" value={f.to} onChange={set('to')} /></div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6"><button type="submit" className="btn btn-primary">Apply filters</button><button type="button" className="btn btn-quiet" onClick={() => { const empty = { status: '', tool: '', q: '', from: '', to: '' }; setF(empty); setApplied(empty); setPage(1); }}>Clear</button></div>
      </form>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data ? <PageLoading /> : data && (data.jobs.length === 0 ? <EmptyState title="No jobs match">Adjust the filters and try again.</EmptyState> : (<><JobsTable jobs={data.jobs} admin /><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>))}
    </AdminShell>
  );
}
