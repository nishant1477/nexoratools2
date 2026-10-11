'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

export function Navbar() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpen(false); setMenu(false); }, [pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); setOpen(false); } };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);

  const signOut = async () => { await logout(); window.location.assign('/'); };
  const link = (href: string, label: string) => (
    <Link href={href} aria-current={pathname === href ? 'page' : undefined} className={`rounded px-2 py-1 font-medium hover:text-pine ${pathname === href ? 'text-pine underline decoration-2 underline-offset-8' : ''}`}>{label}</Link>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur-sm">
      <a href="#main" className="sr-only-focusable btn btn-primary left-2 top-2 z-50">Skip to content</a>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="NexoraTools home"><Logo /></Link>
        <nav aria-label="Main" className="ml-4 hidden items-center gap-3 md:flex">
          {link('/#tools', 'Tools')}
          {link('/developers', 'Developers')}
          {user && link('/dashboard', 'Dashboard')}
          {user && link('/history', 'History')}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <div className="hidden items-center gap-2 md:flex">
            {loading ? <span className="h-9 w-24" aria-hidden /> : user ? (
              <div className="relative" ref={menuRef}>
                <button type="button" className="btn btn-quiet btn-sm" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((v) => !v)}>
                  <span className="max-w-[10rem] truncate">{user.name}</span><ChevronDown className="h-4 w-4" aria-hidden />
                </button>
                {menu && (
                  <div role="menu" className="absolute right-0 mt-2 w-56 rounded-lg border border-line bg-sheet p-1 shadow-lg">
                    <p className="truncate px-3 py-2 text-sm text-muted">{user.email}</p>
                    {[['/account', 'Account'], ['/api-keys', 'API keys'], ...(user.role === 'ADMIN' ? [['/admin', 'Admin']] : [])].map(([h, l]) => (
                      <Link key={h} role="menuitem" href={h as string} className="block rounded px-3 py-2 hover:bg-sunken">{l}</Link>
                    ))}
                    <button type="button" role="menuitem" onClick={signOut} className="block w-full rounded px-3 py-2 text-left hover:bg-sunken">Sign out</button>
                  </div>
                )}
              </div>
            ) : (<>
              <Link href="/login" className="btn btn-quiet btn-sm">Sign in</Link>
              <Link href="/register" className="btn btn-primary btn-sm">Create account</Link>
            </>)}
          </div>
          <button type="button" className="btn btn-quiet btn-sm !px-2.5 md:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((v) => !v)}>
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-line bg-paper px-4 pb-4 pt-2 md:hidden">
          <ul className="flex flex-col">
            {[['/#tools', 'Tools'], ['/developers', 'Developers'], ...(user ? [['/dashboard', 'Dashboard'], ['/history', 'History'], ['/account', 'Account'], ['/api-keys', 'API keys'], ...(user.role === 'ADMIN' ? [['/admin', 'Admin']] : [])] : [])].map(([h, l]) => (
              <li key={h}><Link href={h as string} className="block border-b border-line py-3 font-medium">{l}</Link></li>
            ))}
            {!loading && (user
              ? <li><button type="button" onClick={signOut} className="block w-full py-3 text-left font-medium">Sign out</button></li>
              : <li className="mt-3 flex gap-2"><Link href="/login" className="btn btn-quiet flex-1">Sign in</Link><Link href="/register" className="btn btn-primary flex-1">Create account</Link></li>)}
          </ul>
        </nav>
      )}
    </header>
  );
}
