'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6" role="alert">
      <h1 className="text-5xl font-extrabold">Something broke on this page.</h1>
      <p className="mt-4 text-lg text-muted">Reload to try again. If it keeps happening, tell us what you were doing.</p>
      <button type="button" className="btn btn-primary mt-8" onClick={reset}>Reload the page</button>
    </div>
  );
}
