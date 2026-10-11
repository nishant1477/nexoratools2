'use client';
import { useState } from 'react';
import { ArrowDown, ArrowUp, File as FileIcon, GripVertical, X } from 'lucide-react';
import { formatBytes } from '@/lib/format';

export interface Picked { id: string; file: File }

interface Props {
  items: Picked[]; reorderable?: boolean; disabled?: boolean;
  onRemove: (id: string) => void; onMove: (from: number, to: number) => void;
}

export function FileList({ items, reorderable, disabled, onRemove, onMove }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-sheet" aria-label="Selected files">
      {items.map((it, i) => (
        <li
          key={it.id}
          draggable={reorderable && !disabled}
          onDragStart={() => setDragFrom(i)}
          onDragOver={(e) => { if (dragFrom !== null) { e.preventDefault(); setDragOver(i); } }}
          onDrop={(e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== i) onMove(dragFrom, i); setDragFrom(null); setDragOver(null); }}
          onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
          className={`flex items-center gap-3 p-3 ${dragOver === i && dragFrom !== i ? 'border-t-2 border-marigold' : ''} ${dragFrom === i ? 'opacity-50' : ''}`}
        >
          {reorderable && <GripVertical className="hidden h-5 w-5 shrink-0 cursor-grab text-muted sm:block" aria-hidden />}
          <FileIcon className="h-6 w-6 shrink-0 text-pine" aria-hidden strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={it.file.name}>{it.file.name}</p>
            <p className="text-sm text-muted">{formatBytes(it.file.size)}{reorderable && items.length > 1 ? ` · position ${i + 1} of ${items.length}` : ''}</p>
          </div>
          {reorderable && items.length > 1 && (
            <span className="flex">
              <button type="button" className="btn btn-quiet btn-sm !min-h-9 !px-2 !border-transparent" disabled={disabled || i === 0} onClick={() => onMove(i, i - 1)} aria-label={`Move ${it.file.name} up`}><ArrowUp className="h-4 w-4" aria-hidden /></button>
              <button type="button" className="btn btn-quiet btn-sm !min-h-9 !px-2 !border-transparent" disabled={disabled || i === items.length - 1} onClick={() => onMove(i, i + 1)} aria-label={`Move ${it.file.name} down`}><ArrowDown className="h-4 w-4" aria-hidden /></button>
            </span>
          )}
          <button type="button" className="btn btn-quiet btn-sm !min-h-9 !px-2 !border-transparent" disabled={disabled} onClick={() => onRemove(it.id)} aria-label={`Remove ${it.file.name}`}><X className="h-4 w-4" aria-hidden /></button>
        </li>
      ))}
    </ul>
  );
}
