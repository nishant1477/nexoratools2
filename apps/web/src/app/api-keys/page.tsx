'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { PageShell, RequireAuth } from '@/components/RequireAuth';
import { EmptyState, ErrorNotice, Field, PageLoading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { ApiKeyInfo } from '@/lib/types';

function Keys() {
  const { data, error, loading, reload } = useApi<{ keys: ApiKeyInfo[] }>('/keys');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setFormErr('Give the key a name so you can recognise it later.'); return; }
    setFormErr(''); setBusy(true); setCopied(false);
    try { const d = await api<{ secret: string }>('/keys', { json: { name: name.trim() } }); setSecret({ name: name.trim(), value: d.secret }); setName(''); await reload(); }
    catch (err) { setFormErr(errorMessage(err)); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setActionErr('');
    try { await api(`/keys/${id}`, { method: 'DELETE' }); setConfirm(null); await reload(); } catch (err) { setActionErr(errorMessage(err)); }
  }
  async function copy() { if (secret) { await navigator.clipboard.writeText(secret.value).catch(() => undefined); setCopied(true); } }
  const active = data?.keys.filter((k) => !k.revokedAt) ?? [];
  const revoked = data?.keys.filter((k) => k.revokedAt) ?? [];

  return (
    <PageShell title="API keys" intro="Use keys to process files from your own code. See the developer guide for the endpoints.">
      <p className="-mt-6 mb-8"><Link href="/developers" className="font-semibold text-pine underline">Read the developer guide</Link></p>

      {secret && (
        <div role="status" className="mb-8 rounded-lg border-2 border-marigold bg-marigold-soft p-5">
          <p className="font-display text-xl font-bold">Copy your new key now</p>
          <p className="mt-1 text-sm">“{secret.name}” is shown only this once. We store a fingerprint, not the key itself, so we can't show it again.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-sheet px-3 py-2.5 text-sm" data-testid="new-key">{secret.value}</code>
            <button type="button" className="btn btn-primary" onClick={copy}>{copied ? <><Check className="h-4 w-4" aria-hidden />Copied</> : <><Copy className="h-4 w-4" aria-hidden />Copy</>}</button>
          </div>
          <button type="button" className="btn btn-quiet btn-sm mt-3" onClick={() => setSecret(null)}>I've saved it</button>
        </div>
      )}

      <form onSubmit={create} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-80"><Field label="Key name" htmlFor="key-name" error={formErr}><input id="key-name" className="field" placeholder="e.g. Build server" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!formErr} /></Field></div>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create key'}</button>
      </form>

      <section className="mt-12" aria-labelledby="active-h">
        <h2 id="active-h" className="mb-4 text-2xl">Active keys</h2>
        {error && <ErrorNotice message={error} onRetry={reload} />}
        {actionErr && <ErrorNotice message={actionErr} />}
        {loading && !data ? <PageLoading /> : data && (active.length === 0
          ? <EmptyState title="No active keys">Create a key above to start using the API.</EmptyState>
          : <div className="overflow-x-auto"><table className="ledger">
              <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th className="text-right">Requests</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{active.map((k) => (
                <tr key={k.id}>
                  <td className="font-medium">{k.name}</td>
                  <td><code className="text-sm">{k.prefix}…</code></td>
                  <td className="whitespace-nowrap text-muted">{formatDate(k.createdAt)}</td>
                  <td className="whitespace-nowrap text-muted">{k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'Never'}</td>
                  <td className="text-right tabular-nums">{k.requests ?? 0}</td>
                  <td className="whitespace-nowrap text-right">
                    {confirm === k.id
                      ? <span className="inline-flex gap-2"><button type="button" className="btn btn-danger btn-sm" onClick={() => revoke(k.id)}>Revoke “{k.name}”</button><button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirm(null)}>Keep</button></span>
                      : <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirm(k.id)}>Revoke</button>}
                  </td>
                </tr>))}</tbody>
            </table></div>)}
      </section>

      {revoked.length > 0 && (
        <section className="mt-12" aria-labelledby="rev-h">
          <h2 id="rev-h" className="mb-4 text-2xl">Revoked</h2>
          <ul className="divide-y divide-line text-sm text-muted">{revoked.map((k) => <li key={k.id} className="py-2">{k.name} · <code>{k.prefix}…</code> · revoked {formatDate(k.revokedAt)}</li>)}</ul>
        </section>
      )}
    </PageShell>
  );
}
export default function Page() { return <RequireAuth><Keys /></RequireAuth>; }
