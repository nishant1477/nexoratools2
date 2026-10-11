'use client';
import { useState } from 'react';
import { PageShell, RequireAuth } from '@/components/RequireAuth';
import { JobsTable } from '@/components/JobsTable';
import { EmptyState, ErrorNotice, PageLoading, Pagination } from '@/components/ui';
import { useApi } from '@/lib/hooks';
import { ALL_TOOLS } from '@/lib/tools';
import type { Job } from '@/lib/types';

const STATUSES = ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'];

function History() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [tool, setTool] = useState('');
  const qs = new URLSearchParams({ page: String(page), pageSize: '15', ...(status && { status }), ...(tool && { tool }) }).toString();
  const { data, error, loading, reload } = useApi<{ jobs: Job[]; total: number; page: number; pageSize: number }>(`/jobs?${qs}`);
  const filtered = status !== '' || tool !== '';

  return (
    <PageShell title="History" intro="Every job you've run. Results are removed on a timer, but the record stays." wide>
      <div className="mb-6 flex flex-wrap gap-4">
        <div><label htmlFor="f-status" className="mb-1 block text-sm font-semibold">Status</label>
          <select id="f-status" className="field !w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}</select></div>
        <div><label htmlFor="f-tool" className="mb-1 block text-sm font-semibold">Tool</label>
          <select id="f-tool" className="field !w-auto" value={tool} onChange={(e) => { setTool(e.target.value); setPage(1); }}><option value="">All</option>{ALL_TOOLS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      </div>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data ? <PageLoading /> : data && (data.jobs.length === 0
        ? <EmptyState title={filtered ? 'No jobs match those filters' : 'No jobs yet'} action={filtered ? undefined : { href: '/#tools', label: 'Pick a tool' }}>{filtered ? 'Try clearing a filter.' : 'Run a tool and it will appear here.'}</EmptyState>
        : <><JobsTable jobs={data.jobs} /><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></>)}
    </PageShell>
  );
}
export default function Page() { return <RequireAuth><History /></RequireAuth>; }
