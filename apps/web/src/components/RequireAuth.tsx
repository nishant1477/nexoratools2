'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { EmptyState, PageLoading } from './ui';

/** Client-side gate for signed-in pages. The API still enforces every permission on its own. */
export function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => { if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(path)}`); }, [loading, user, router, path]);
  if (loading || !user) return <div className="mx-auto max-w-6xl px-4 sm:px-6"><PageLoading label="Checking your session…" /></div>;
  if (admin && user.role !== 'ADMIN') {
    return <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6"><EmptyState title="Administrators only" action={{ href: '/dashboard', label: 'Go to dashboard' }}>Your account doesn't have access to this area.</EmptyState></div>;
  }
  return <>{children}</>;
}

export const PageShell = ({ title, intro, children, wide }: { title: string; intro?: string; children: ReactNode; wide?: boolean }) => (
  <div className={`mx-auto px-4 py-10 sm:px-6 sm:py-14 ${wide ? 'max-w-6xl' : 'max-w-4xl'}`}>
    <h1 className="text-4xl font-extrabold sm:text-5xl">{title}</h1>
    {intro && <p className="mt-2 max-w-2xl text-lg text-muted">{intro}</p>}
    <div className="mt-10">{children}</div>
  </div>
);
