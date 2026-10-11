'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AdminShell } from '@/components/AdminNav';
import { EmptyState, ErrorNotice, PageLoading, Pagination } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBytes, formatDate } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { AdminUser } from '@/lib/types';

export default function Page() {
  const me = useAuth().user;
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [actionErr, setActionErr] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const qs = new URLSearchParams({ page: String(page), pageSize: '20', ...(debounced && { search: debounced }), ...(status && { status }) }).toString();
  const { data, error, loading, reload } = useApi<{ users: AdminUser[]; total: number; page: number; pageSize: number }>(`/admin/users?${qs}`);

  async function toggle(u: AdminUser) {
    setActionErr('');
    try { await api(`/admin/users/${u.id}`, { method: 'PATCH', json: { disabled: !u.disabled } }); setConfirm(null); await reload(); } catch (err) { setActionErr(errorMessage(err)); }
  }
  // Wait for a pause in typing before querying.
  const onSearch = (v: string) => { setSearch(v); window.clearTimeout((onSearch as unknown as { t?: number }).t); (onSearch as unknown as { t?: number }).t = window.setTimeout(() => { setDebounced(v.trim()); setPage(1); }, 300); };

  return (
    <AdminShell title="Users">
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="sm:w-80"><label htmlFor="u-search" className="mb-1 block text-sm font-semibold">Search</label><input id="u-search" type="search" className="field" placeholder="Name or email" value={search} onChange={(e) => onSearch(e.target.value)} /></div>
        <div><label htmlFor="u-status" className="mb-1 block text-sm font-semibold">Status</label><select id="u-status" className="field !w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="active">Active</option><option value="disabled">Disabled</option></select></div>
      </div>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {actionErr && <ErrorNotice title="Action failed" message={actionErr} />}
      {loading && !data ? <PageLoading /> : data && (data.users.length === 0 ? <EmptyState title="No users found">Try a different search.</EmptyState> : (<>
        <div className="overflow-x-auto"><table className="ledger">
          <thead><tr><th>User</th><th>Role</th><th>Joined</th><th className="text-right">Jobs</th><th className="text-right">Storage</th><th>Account</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{data.users.map((u) => (
            <tr key={u.id}>
              <td className="max-w-[16rem]"><Link href={`/admin/users/${u.id}`} className="font-medium underline">{u.name}</Link><div className="truncate text-sm text-muted">{u.email}</div></td>
              <td>{u.role === 'ADMIN' ? 'Admin' : 'User'}</td>
              <td className="whitespace-nowrap text-muted">{formatDate(u.createdAt)}</td>
              <td className="text-right tabular-nums">{u.jobCount}</td>
              <td className="whitespace-nowrap text-right tabular-nums">{formatBytes(u.storageBytes)}</td>
              <td>{u.disabled ? <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger">Disabled</span> : <span className="rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-semibold text-ok">Active</span>}</td>
              <td className="whitespace-nowrap text-right">
                {u.id === me?.id ? <span className="text-sm text-muted">You</span> : confirm === u.id
                  ? <span className="inline-flex gap-2"><button type="button" className={`btn btn-sm ${u.disabled ? 'btn-primary' : 'btn-danger'}`} onClick={() => toggle(u)}>{u.disabled ? 'Enable' : 'Disable'} {u.name.split(' ')[0]}</button><button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirm(null)}>Cancel</button></span>
                  : <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirm(u.id)}>{u.disabled ? 'Enable' : 'Disable'}</button>}
              </td>
            </tr>))}</tbody>
        </table></div>
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
      </>))}
    </AdminShell>
  );
}
