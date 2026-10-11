'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Inbox, Loader2 } from 'lucide-react';
import type { JobStatus } from '@/lib/types';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <Loader2 aria-label={label} role="img" className="h-5 w-5 animate-spin text-pine" />;
}

export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center gap-3 py-16 text-muted" role="status"><Spinner label={label} /><span>{label}</span></div>;
}

export function ErrorNotice({ message, onRetry, title = 'Something went wrong' }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-danger/40 bg-danger-soft p-4 text-ink">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="text-sm break-words">{message}</p>
        {onRetry && <button type="button" onClick={onRetry} className="btn btn-quiet btn-sm mt-3">Try again</button>}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line p-8">
      <Inbox className="h-6 w-6 text-muted" aria-hidden />
      <p className="font-display text-xl font-bold">{title}</p>
      {children && <p className="max-w-prose text-muted">{children}</p>}
      {action && <Link href={action.href} className="btn btn-primary mt-2">{action.label}</Link>}
    </div>
  );
}

const STATUS: Record<JobStatus, { label: string; cls: string }> = {
  QUEUED: { label: 'Queued', cls: 'bg-sunken text-ink' },
  PROCESSING: { label: 'Processing', cls: 'bg-marigold-soft text-ink' },
  COMPLETED: { label: 'Completed', cls: 'bg-ok-soft text-ok' },
  FAILED: { label: 'Failed', cls: 'bg-danger-soft text-danger' },
  EXPIRED: { label: 'Expired', cls: 'bg-sunken text-muted' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-sunken text-muted' },
};
export function StatusBadge({ status }: { status: JobStatus }) {
  const s = STATUS[status];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

export function Notice({ tone = 'ok', children }: { tone?: 'ok' | 'warn'; children: ReactNode }) {
  return (
    <div role="status" className={`flex gap-3 rounded-lg p-4 ${tone === 'ok' ? 'bg-ok-soft' : 'bg-marigold-soft'}`}>
      <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${tone === 'ok' ? 'text-ok' : 'text-ink'}`} aria-hidden />
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold">{label}</label>
      {children}
      {hint && !error && <p id={`${htmlFor}-hint`} className="mt-1 text-sm text-muted">{hint}</p>}
      {error && <p id={`${htmlFor}-error`} role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">Page {page} of {pages} · {total} total</span>
      <span className="flex gap-2">
        <button type="button" className="btn btn-quiet btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </span>
    </nav>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="min-w-0 border-l-2 border-ink pl-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="font-display text-3xl font-bold tabular-nums">{value}</p>
      {note && <p className="text-sm text-muted">{note}</p>}
    </div>
  );
}
