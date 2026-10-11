import Link from 'next/link';
import { Logo } from './Logo';

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:justify-between">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-3 text-sm text-muted">Simple tools for your files. Uploads are deleted automatically.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm sm:grid-cols-3">
          <Link href="/#tools" className="hover:text-pine">All tools</Link>
          <Link href="/tools/merge-pdf" className="hover:text-pine">Merge PDF</Link>
          <Link href="/tools/compress-pdf" className="hover:text-pine">Compress PDF</Link>
          <Link href="/developers" className="hover:text-pine">API</Link>
          <Link href="/register" className="hover:text-pine">Create account</Link>
          <Link href="/login" className="hover:text-pine">Sign in</Link>
        </nav>
      </div>
      <p className="mx-auto max-w-6xl px-4 pb-8 text-sm text-muted sm:px-6">Made by Nishant</p>
    </footer>
  );
}
