'use client';
import { useState } from 'react';
import { AdminShell } from '@/components/AdminNav';
import { EmptyState, ErrorNotice, PageLoading, Pagination } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Ev { id: string; action: string; actor: string | null; targetType: string | null; targetId: string | null; createdAt: string }
const LABEL: Record<string, string> = { 'user.disabled': 'Disabled a user', 'user.enabled': 'Enabled a user', 'apikey.created': 'Created an API key', 'apikey.revoked': 'Revoked an API key' };

export default function Page() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<{ events: Ev[]; total: number; page: number; pageSize: number }>(`/admin/audit?page=${page}&pageSize=25`);
  return (
    <AdminShell title="Audit log">
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {loading && !data ? <PageLoading /> : data && (data.events.length === 0 ? <EmptyState title="Nothing recorded yet">Sensitive actions such as disabling users or managing API keys appear here.</EmptyState> : (<>
        <div className="overflow-x-auto"><table className="ledger"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th></tr></thead>
          <tbody>{data.events.map((e) => <tr key={e.id}><td className="whitespace-nowrap text-muted">{formatDate(e.createdAt)}</td><td>{e.actor ?? 'Deleted user'}</td><td>{LABEL[e.action] ?? e.action}</td><td className="text-muted">{e.targetType}{e.targetId ? ` ${e.targetId.slice(0, 8)}…` : ''}</td></tr>)}</tbody></table></div>
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
      </>))}
    </AdminShell>
  );
}
