'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { stashFiles } from '@/lib/pending';
import { formatBytes } from '@/lib/format';
import { toolsForFile } from '@/lib/tools';
import { Dropzone } from './Dropzone';
import { ToolIcon } from './ToolIcon';

/** Drop any file and see which tools can work with it. Choosing one carries the file over. */
export function HeroDrop() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [unsupported, setUnsupported] = useState('');

  function onFiles(files: File[]) {
    const f = files[0]!;
    if (toolsForFile(f.name).length === 0) { setFile(null); setUnsupported(`"${f.name}" isn't a PDF, JPG or PNG, so none of the tools can open it yet.`); return; }
    setUnsupported(''); setFile(f);
  }
  const choose = (toolId: string) => { if (file) stashFiles(toolId, [file]); router.push(`/tools/${toolId}`); };
  const options = file ? toolsForFile(file.name) : [];

  return (
    <div>
      <Dropzone accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onFiles={onFiles} title="Drop a file to get started" hint="PDF, JPG or PNG. We'll show what you can do with it." compact />
      {unsupported && <p role="alert" className="mt-3 text-sm text-danger">{unsupported}</p>}
      {file && (
        <div className="mt-4 rounded-lg border border-line bg-sheet p-4" aria-live="polite">
          <p className="truncate font-medium">{file.name} <span className="font-normal text-muted">({formatBytes(file.size)})</span></p>
          <p className="mb-3 text-sm text-muted">What do you want to do with it?</p>
          <ul className="flex flex-wrap gap-2">
            {options.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => choose(t.id)} className="btn btn-quiet btn-sm"><ToolIcon name={t.icon} className="h-4 w-4" />{t.name}</button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm"><Link href="/#tools" className="underline">Browse all tools</Link></p>
        </div>
      )}
    </div>
  );
}
