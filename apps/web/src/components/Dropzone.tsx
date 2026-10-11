'use client';
import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { UploadCloud } from 'lucide-react';

interface Props {
  accept: string; // value for <input accept>, e.g. ".pdf,application/pdf"
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint: string;
  compact?: boolean;
}

/** Drag-and-drop target with a real file input behind it. Works with mouse, touch, and keyboard. */
export function Dropzone({ accept, multiple, disabled, onFiles, title, hint, compact }: Props) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0); // dragenter/leave fire for children too; count to avoid flicker

  const pick = () => !disabled && input.current?.click();
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); depth.current = 0; setOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };

  return (
    <div
      className={`drop relative rounded-lg border border-dashed border-line bg-sheet text-center transition-colors ${compact ? 'p-6' : 'p-8 sm:p-12'} ${over ? 'bg-marigold-soft' : ''} ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
      data-active={over}
      role="group"
      aria-label={title}
      onDragEnter={(e) => { e.preventDefault(); depth.current++; setOver(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setOver(false); }}
      onDrop={onDrop}
      onClick={pick}
    >
      <span className="crop crop-tl" /><span className="crop crop-tr" /><span className="crop crop-bl" /><span className="crop crop-br" />
      <UploadCloud className={`mx-auto text-pine ${compact ? 'h-8 w-8' : 'h-10 w-10'}`} aria-hidden strokeWidth={1.5} />
      <p className={`mt-3 font-display font-bold ${compact ? 'text-lg' : 'text-2xl'}`}>{over ? 'Drop to add' : title}</p>
      <p className="mt-1 text-sm text-muted">or</p>
      <button type="button" className="btn btn-primary mt-2" disabled={disabled} onKeyDown={onKey} onClick={(e) => { e.stopPropagation(); pick(); }}>
        Select {multiple ? 'files' : 'file'}
      </button>
      <p className="mt-4 text-sm text-muted">{hint}</p>
      <input
        ref={input} id={inputId} type="file" className="sr-only" tabIndex={-1} accept={accept} multiple={multiple} disabled={disabled}
        aria-label={title}
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) onFiles(f); }}
      />
    </div>
  );
}
