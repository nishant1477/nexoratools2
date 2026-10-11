import type { Metadata } from 'next';
import Link from 'next/link';
import { TOOLS } from '@nexora/shared';

export const metadata: Metadata = { title: 'Developers', description: 'Process files from your own code with the NexoraTools API.' };

const code = 'overflow-x-auto rounded-lg bg-sunken p-4 text-sm leading-relaxed';

export default function Developers() {
  const pub = TOOLS.filter((t) => 'publicApi' in t && t.publicApi);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-4xl font-extrabold sm:text-5xl">Developer API</h1>
      <p className="mt-2 text-lg text-muted">The same processing the website uses, over HTTP. Jobs are asynchronous: create one, poll it, download the result.</p>
      <p className="mt-6"><Link href="/api-keys" className="btn btn-primary">Get an API key</Link></p>

      <h2 className="mb-3 mt-14 text-2xl">Authentication</h2>
      <p className="mb-3 text-muted">Send your key as a bearer token. Keys are shown once at creation; revoke them any time from your account.</p>
      <pre className={code}><code>{'Authorization: Bearer nx_live_…'}</code></pre>

      <h2 className="mb-3 mt-14 text-2xl">1. Create a job</h2>
      <p className="mb-3 text-muted">Multipart form: <code>tool</code>, optional <code>options</code> (JSON), and one or more <code>file</code> parts. Upload order is preserved.</p>
      <pre className={code}><code>{`curl -X POST https://YOUR-DOMAIN/api/v1/jobs \\
  -H "Authorization: Bearer $NEXORA_KEY" \\
  -F tool=merge-pdf \\
  -F file=@first.pdf -F file=@second.pdf`}</code></pre>

      <h2 className="mb-3 mt-14 text-2xl">2. Poll until it finishes</h2>
      <pre className={code}><code>{`curl https://YOUR-DOMAIN/api/v1/jobs/JOB_ID \\
  -H "Authorization: Bearer $NEXORA_KEY"`}</code></pre>
      <p className="mt-3 text-muted">Status is one of QUEUED, PROCESSING, COMPLETED, FAILED, EXPIRED or CANCELLED. Failed jobs include an <code>errorMessage</code>.</p>

      <h2 className="mb-3 mt-14 text-2xl">3. Download the result</h2>
      <pre className={code}><code>{`curl -L -o merged.pdf https://YOUR-DOMAIN/api/v1/files/FILE_ID/download \\
  -H "Authorization: Bearer $NEXORA_KEY"`}</code></pre>
      <p className="mt-3 text-muted">Use the id of the file with <code>type: "OUTPUT"</code> from the job. Files are deleted automatically after the retention window.</p>

      <h2 className="mb-3 mt-14 text-2xl">Responses and errors</h2>
      <pre className={code}><code>{`{ "ok": true,  "data": { … } }
{ "ok": false, "error": { "code": "UNSUPPORTED_FILE", "message": "…" } }`}</code></pre>
      <p className="mt-3 text-muted">Rate limits apply per key; exceeding them returns HTTP 429.</p>

      <h2 className="mb-3 mt-14 text-2xl">Tools available through the API</h2>
      <div className="overflow-x-auto"><table className="ledger">
        <thead><tr><th>Tool id</th><th>Name</th><th>Files</th></tr></thead>
        <tbody>{pub.map((t) => <tr key={t.id}><td><code>{t.id}</code></td><td>{t.name}</td><td>{t.minFiles === t.maxFiles ? t.minFiles : `${t.minFiles}–${t.maxFiles}`}</td></tr>)}</tbody>
      </table></div>
      <p className="mt-3 text-sm text-muted">Call <code>GET /api/v1/tools</code> with your key for the current list and each tool's options.</p>
    </div>
  );
}
