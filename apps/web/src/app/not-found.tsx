import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
      <h1 className="text-5xl font-extrabold">This page doesn't exist.</h1>
      <p className="mt-4 text-lg text-muted">The link may be old, or the address mistyped.</p>
      <Link href="/" className="btn btn-primary mt-8">Back to all tools</Link>
    </div>
  );
}
