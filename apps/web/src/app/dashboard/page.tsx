'use client';
import Link from 'next/link';
import { PageShell, RequireAuth } from '@/components/RequireAuth';
import { JobsTable } from '@/components/JobsTable';
import { ToolCard } from '@/components/ToolCard';
import { EmptyState, ErrorNotice, PageLoading, Stat } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatBytes, plural } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { popularTools, toolName } from '@/lib/tools';
import type { Job, Usage } from '@/lib/types';

function Dashboard() {
  const { user } = useAuth();
  const usage = useApi<Usage>('/me/usage');
  const jobs = useApi<{ jobs: Job[]; total: number }>('/jobs?pageSize=5');

  return (
    <PageShell title={`Hello, ${user?.name.split(' ')[0] ?? ''}`} intro="Your activity, and quick ways back into the tools." wide>
      {usage.error && <ErrorNotice message={usage.error} onRetry={usage.reload} />}
      {usage.loading && !usage.data ? <PageLoading /> : usage.data && (
        <>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Conversions" value={usage.data.totalConversions} note={`${plural(usage.data.totalJobs, 'job')} in total`} />
            <Stat label="Last 30 days" value={usage.data.jobsLast30Days} note="jobs started" />
            <Stat label="Stored right now" value={formatBytes(usage.data.storage.bytesInUse)} note={`${plural(usage.data.storage.files, 'file')}, deleted after ${plural(usage.data.storage.retentionMinutes, 'minute')}`} />
            <Stat label="Processed so far" value={formatBytes(usage.data.bytesProcessed)} note={usage.data.topTools[0] ? `Most used: ${toolName(usage.data.topTools[0].tool)}` : undefined} />
          </div>
        </>
      )}

      <section className="mt-16" aria-labelledby="recent-h">
        <div className="mb-4 flex items-baseline justify-between"><h2 id="recent-h" className="text-2xl">Recent jobs</h2><Link href="/history" className="text-sm font-semibold text-pine underline">All history</Link></div>
        {jobs.error && <ErrorNotice message={jobs.error} onRetry={jobs.reload} />}
        {jobs.loading && !jobs.data ? <PageLoading /> : jobs.data && (jobs.data.jobs.length === 0
          ? <EmptyState title="No jobs yet" action={{ href: '/#tools', label: 'Pick a tool' }}>Run a tool and it will show up here with its status and download link.</EmptyState>
          : <JobsTable jobs={jobs.data.jobs} />)}
      </section>

      <section className="mt-16" aria-labelledby="quick-h">
        <h2 id="quick-h" className="mb-5 text-2xl">Quick access</h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{popularTools().slice(0, 6).map((t) => <ToolCard key={t.id} tool={t} />)}</div>
      </section>
    </PageShell>
  );
}
export default function Page() { return <RequireAuth><Dashboard /></RequireAuth>; }
