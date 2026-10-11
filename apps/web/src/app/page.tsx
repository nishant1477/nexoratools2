import { Hero } from '@/components/Hero';
import { ToolBrowser } from '@/components/ToolBrowser';

export default function Home() {
  return (
    <>
      <Hero />
      <div id="tools" className="mx-auto max-w-6xl scroll-mt-24 px-4 sm:px-6"><ToolBrowser /></div>
      <section aria-labelledby="privacy-h" className="mx-auto mt-24 max-w-6xl px-4 sm:px-6">
        <h2 id="privacy-h" className="mb-8 text-3xl">What happens to your files</h2>
        <dl className="grid gap-8 md:grid-cols-3">
          <div><dt className="font-display text-xl font-bold">Processed on our servers</dt><dd className="mt-2 text-muted">Your upload is checked, queued and handled by a background worker. Nothing runs in your browser tab, so big files won't freeze it.</dd></div>
          <div><dt className="font-display text-xl font-bold">Only you can download</dt><dd className="mt-2 text-muted">Results are tied to your account. Other people, and other accounts, can't open your files.</dd></div>
          <div><dt className="font-display text-xl font-bold">Deleted automatically</dt><dd className="mt-2 text-muted">Uploads and results expire on a timer and are removed from storage. There's no archive.</dd></div>
        </dl>
      </section>
    </>
  );
}
