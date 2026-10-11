import Link from 'next/link';
import type { ToolDefinition } from '@nexora/shared';
import { ToolIcon } from './ToolIcon';

export function ToolCard({ tool }: { tool: ToolDefinition }) {
  return (
    <article className="sheet sheet-link flex h-full flex-col p-5">
      <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-pine text-on-pine"><ToolIcon name={tool.icon} /></span>
      <h3 className="text-xl">{tool.name}</h3>
      <p className="mt-1 flex-1 text-sm text-muted">{tool.description}</p>
      <Link href={`/tools/${tool.id}`} className="btn btn-quiet btn-sm mt-5 self-start after:absolute after:inset-0" aria-label={`Open tool: ${tool.name}`}>
        Open tool
      </Link>
    </article>
  );
}

export function PlannedCard({ name, description }: { name: string; description: string }) {
  return (
    <article className="rounded-lg border border-dashed border-line p-5" aria-label={`${name} (planned)`}>
      <h3 className="text-lg">{name}</h3>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <p className="mt-3 inline-block rounded bg-sunken px-2 py-0.5 text-xs font-semibold text-muted">Planned</p>
    </article>
  );
}
