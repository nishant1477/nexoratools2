'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RequireAuth } from './RequireAuth';

const TABS = [['/admin', 'Overview'], ['/admin/users', 'Users'], ['/admin/jobs', 'Jobs'], ['/admin/system', 'System'], ['/admin/audit', 'Audit log']] as const;

export function AdminShell({ title, children }: { title: string; children: React.ReactNode }) {
  const path = usePathname();
  return (
    <RequireAuth admin>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-4xl font-extrabold sm:text-5xl">{title}</h1>
        <nav aria-label="Admin" className="mt-6 flex flex-wrap gap-1 border-b border-line">
          {TABS.map(([href, label]) => {
            const on = href === '/admin' ? path === href : path.startsWith(href);
            return <Link key={href} href={href} aria-current={on ? 'page' : undefined} className={`-mb-px rounded-t-lg border border-b-0 px-4 py-2 font-semibold ${on ? 'border-line bg-sheet text-pine' : 'border-transparent text-muted hover:text-ink'}`}>{label}</Link>;
          })}
        </nav>
        <div className="mt-10">{children}</div>
      </div>
    </RequireAuth>
  );
}
