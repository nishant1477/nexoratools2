'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { FILE_KINDS, type FileKind } from '@nexora/shared';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBytes, plural } from '@/lib/format';
import { useLimits } from '@/lib/hooks';
import { stashFiles, takeFiles } from '@/lib/pending';
import { defaultOptions, toolById } from '@/lib/tools';
import { uploadJob } from '@/lib/upload';
import type { Job } from '@/lib/types';
import { Dropzone } from './Dropzone';
import { FileList, type Picked } from './FileList';
import { ErrorNotice, Field, Notice } from './ui';

const ACTION: Record<string, string> = {
  'jpg-to-pdf': 'Convert to PDF', 'png-to-pdf': 'Convert to PDF', 'pdf-to-jpg': 'Convert to JPG', 'pdf-to-png': 'Convert to PNG',
  'merge-pdf': 'Merge PDFs', 'split-pdf': 'Split PDF', 'compress-pdf': 'Compress PDF', 'rotate-pdf': 'Rotate PDF',
  'delete-pdf-pages': 'Delete pages', 'extract-pdf-pages': 'Extract pages', 'jpg-to-png': 'Convert to PNG', 'png-to-jpg': 'Convert to JPG',
  'compress-image': 'Compress images', 'resize-image': 'Resize images',
};

type Phase = 'idle' | 'uploading' | 'processing' | 'done' | 'failed' | 'cancelled';
let uid = 0;

export function ToolRunner({ toolId }: { toolId: string }) {
  const tool = toolById(toolId)!;
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const limits = useLimits();
  const multi = tool.maxFiles > 1;

  const [items, setItems] = useState<Picked[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>(() => defaultOptions(tool));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  const accept = useMemo(() => tool.accepts.flatMap((k) => [...FILE_KINDS[k].extensions.map((e) => `.${e}`), ...FILE_KINDS[k].mimeTypes]).join(','), [tool]);
  const kindsLabel = tool.accepts.map((k) => k.toUpperCase()).join(' or ');
  const maxFiles = tool.maxFiles;

  // Files chosen on the home page, or before signing in, are waiting in memory.
  // Runs once per tool: addFiles is a stable-enough closure over state setters, and re-running it would re-add the files.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const f = takeFiles(tool.id); if (f.length) addFiles(f); }, [tool.id]);
  useEffect(() => () => abort.current?.abort(), []);

  const accepts = useCallback((file: File): string | null => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const ok = tool.accepts.some((k: FileKind) => (FILE_KINDS[k].extensions as readonly string[]).includes(ext));
    if (!ok) return `"${file.name}" isn't a ${kindsLabel} file.`;
    if (file.size === 0) return `"${file.name}" is empty.`;
    if (limits && file.size > limits.maxUploadBytes) return `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(limits.maxUploadBytes)} per file.`;
    return null;
  }, [tool, kindsLabel, limits]);

  function addFiles(files: File[]) {
    const problems: string[] = [];
    const good: Picked[] = [];
    for (const f of files) { const p = accepts(f); if (p) problems.push(p); else good.push({ id: `f${++uid}`, file: f }); }
    setItems((cur) => {
      const merged = multi ? [...cur, ...good] : good.slice(0, 1);
      if (merged.length > maxFiles) { problems.push(`${tool.name} accepts up to ${maxFiles} files; the extra ones were left out.`); return merged.slice(0, maxFiles); }
      return merged;
    });
    setRejected(problems);
  }

  const move = (from: number, to: number) => setItems((cur) => { const next = [...cur]; const [m] = next.splice(from, 1); next.splice(to, 0, m!); return next; });
  const reset = () => { abort.current?.abort(); setItems([]); setRejected([]); setPhase('idle'); setJob(null); setError(''); setProgress(0); setValues(defaultOptions(tool)); setFieldErrors({}); };

  function buildOptions(): Record<string, unknown> | null {
    const raw: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v.trim() !== '') raw[k] = v.trim();
    const parsed = tool.options.safeParse(raw);
    if (parsed.success) { setFieldErrors({}); return raw; }
    const errs: Record<string, string> = {};
    for (const i of parsed.error.issues) errs[String(i.path[0] ?? '_')] ??= i.message;
    setFieldErrors(errs);
    return null;
  }

  async function poll(first: Job, signal: AbortSignal) {
    let current = first;
    for (let n = 0; ; n++) {
      setJob(current);
      if (['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(current.status)) break;
      await new Promise<void>((res, rej) => { const t = setTimeout(res, n < 15 ? 800 : 2000); signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true }); });
      current = (await api<{ job: Job }>(`/jobs/${current.id}`, { signal })).job;
    }
    setPhase(current.status === 'COMPLETED' ? 'done' : current.status === 'CANCELLED' ? 'cancelled' : 'failed');
    if (current.status === 'FAILED' || current.status === 'EXPIRED') setError(current.errorMessage ?? 'The file could not be processed.');
  }

  async function start() {
    if (items.length < tool.minFiles) { setError(`${tool.name} needs at least ${plural(tool.minFiles, 'file')}.`); return; }
    if (!user) { stashFiles(tool.id, items.map((i) => i.file)); router.push(`/login?next=${encodeURIComponent(`/tools/${tool.id}`)}`); return; }
    const options = buildOptions();
    if (!options) return;
    setError(''); setProgress(0); setJob(null); setPhase('uploading');
    const ctl = new AbortController(); abort.current = ctl;
    try {
      const created = await uploadJob({ tool: tool.id, files: items.map((i) => i.file), options, onProgress: setProgress, signal: ctl.signal });
      setPhase('processing');
      await poll(created, ctl.signal);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      if (err instanceof ApiError && err.status === 401) { setError('Your session has expired. Sign in again to continue.'); }
      else setError(errorMessage(err));
      setPhase('failed');
    }
  }

  async function cancel() {
    if (phase === 'uploading') { abort.current?.abort(); setPhase('idle'); return; }
    if (!job) return;
    try { const d = await api<{ job: Job }>(`/jobs/${job.id}/cancel`, { method: 'POST' }); abort.current?.abort(); setJob(d.job); setPhase('cancelled'); }
    catch (err) { setError(errorMessage(err)); }
  }

  const busy = phase === 'uploading' || phase === 'processing';
  const outputs = job?.files?.filter((f) => f.type === 'OUTPUT') ?? [];
  const totalSize = items.reduce((n, i) => n + i.file.size, 0);
  const waiting = phase === 'processing' && job?.status === 'QUEUED';

  // ---------- result ----------
  if (phase === 'done' && job) {
    const saved = job.outputSize !== null && job.inputSize > 0 ? Math.round((1 - job.outputSize / job.inputSize) * 100) : null;
    return (
      <section aria-labelledby="done-title" className="rounded-lg border border-line bg-sheet p-6 sm:p-8">
        <Notice><p id="done-title" className="font-display text-xl font-bold">Conversion complete</p></Notice>
        <ul className="mt-5 divide-y divide-line">
          {outputs.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{f.filename}</p><p className="text-sm text-muted">{formatBytes(f.size)}</p></div>
              <a href={`/api/files/${f.id}/download`} download={f.filename} className="btn btn-primary"><Download className="h-4 w-4" aria-hidden />Download</a>
            </li>
          ))}
        </ul>
        {tool.id.startsWith('compress') && saved !== null && (
          <p className="mt-3 text-sm text-muted">{formatBytes(job.inputSize)} → {formatBytes(job.outputSize)}{saved > 0 ? ` (${saved}% smaller)` : ' — this file was already as small as it gets, so it was returned unchanged.'}</p>
        )}
        <p className="mt-3 text-sm text-muted">This file is deleted automatically{limits ? ` after ${plural(limits.retentionMinutes, 'minute')}` : ' after a short time'}. You can also find it in <Link href="/history" className="underline">History</Link> until then.</p>
        <button type="button" className="btn btn-quiet mt-5" onClick={reset}><RefreshCw className="h-4 w-4" aria-hidden />Start over</button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {!busy && (items.length === 0 || multi) && (
        <Dropzone
          accept={accept} multiple={multi} onFiles={addFiles}
          title={multi ? `Upload your ${kindsLabel} files` : `Upload your ${kindsLabel}`}
          hint={`${kindsLabel}${limits ? ` · up to ${formatBytes(limits.maxUploadBytes)} each` : ''}${multi ? ` · up to ${maxFiles} files` : ''}`}
          compact={items.length > 0}
        />
      )}

      {rejected.length > 0 && <ErrorNotice title="Some files weren't added" message={rejected.join(' ')} />}

      {items.length > 0 && (
        <>
          <FileList items={items} reorderable={!!tool.orderMatters} disabled={busy} onRemove={(id) => setItems((c) => c.filter((i) => i.id !== id))} onMove={move} />
          {multi && <p className="text-sm text-muted">{plural(items.length, 'file')} · {formatBytes(totalSize)}{tool.orderMatters ? ' · Drag or use the arrows to set the order.' : ''}</p>}
        </>
      )}

      {items.length > 0 && tool.optionFields && tool.optionFields.length > 0 && (
        <fieldset disabled={busy} className="grid gap-4 rounded-lg border border-line bg-sheet p-5 sm:grid-cols-2">
          <legend className="px-2 font-display text-lg font-bold">Options</legend>
          {tool.optionFields.map((f) => {
            const id = `opt-${f.key}`;
            const common = { id, className: 'field', 'aria-invalid': !!fieldErrors[f.key], 'aria-describedby': fieldErrors[f.key] ? `${id}-error` : f.help ? `${id}-hint` : undefined };
            return (
              <Field key={f.key} label={f.label} htmlFor={id} hint={f.help} error={fieldErrors[f.key]}>
                {f.type === 'select' ? (
                  <select {...common} value={values[f.key] ?? f.choices[0]?.value} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                    {f.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                ) : f.type === 'number' ? (
                  <input {...common} type="number" inputMode="numeric" min={f.min} max={f.max} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                ) : (
                  <input {...common} type="text" placeholder={f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                )}
              </Field>
            );
          })}
        </fieldset>
      )}

      {error && !busy && <ErrorNotice title={phase === 'failed' ? 'Processing failed' : 'Check your files'} message={error} />}
      {phase === 'cancelled' && <Notice tone="warn">Job cancelled. Nothing was kept.</Notice>}

      {!authLoading && !user && items.length > 0 && (
        <Notice tone="warn"><p>Create a free account or sign in to process files. Your selection is kept while you do.</p></Notice>
      )}

      {busy && (
        <div className="rounded-lg border border-line bg-sheet p-5" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-pine" aria-hidden />
            <p className="font-medium">
              {phase === 'uploading' && progress < 1 && `Uploading… ${Math.round(progress * 100)}%`}
              {phase === 'uploading' && progress >= 1 && 'Upload finished. Preparing your file…'}
              {waiting && 'Waiting in the queue…'}
              {phase === 'processing' && !waiting && 'Processing…'}
            </p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase === 'uploading' ? Math.round(progress * 100) : undefined} aria-label="Progress">
            {phase === 'uploading' && progress < 1
              ? <div className="h-full rounded-full bg-pine transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
              : <div className="progress-indeterminate h-full w-full" />}
          </div>
          <button type="button" className="btn btn-quiet btn-sm mt-4" onClick={cancel}>Cancel</button>
        </div>
      )}

      {!busy && items.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" onClick={start} disabled={items.length < tool.minFiles}>
            {!authLoading && !user ? 'Sign in to continue' : ACTION[tool.id] ?? 'Convert'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={reset}>Clear</button>
          {items.length < tool.minFiles && <p className="self-center text-sm text-muted">Add {plural(tool.minFiles - items.length, 'more file')} to continue.</p>}
        </div>
      )}
    </div>
  );
}
