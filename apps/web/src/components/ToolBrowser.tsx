'use client';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ALL_TOOLS, CATEGORIES, PLANNED_TOOLS, popularTools, type ToolCategory } from '@/lib/tools';
import { PlannedCard, ToolCard } from './ToolCard';

type Tab = 'all' | ToolCategory;
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'pdf', label: CATEGORIES.pdf.name }, { id: 'image', label: CATEGORIES.image.name }, { id: 'more', label: CATEGORIES.more.name },
];

export function ToolBrowser() {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const query = q.trim().toLowerCase();
  const match = (name: string, desc: string) => !query || name.toLowerCase().includes(query) || desc.toLowerCase().includes(query);

  const sections = useMemo(() => (['pdf', 'image'] as const).map((c) => ({
    id: c, ...CATEGORIES[c], tools: ALL_TOOLS.filter((t) => t.category === c && match(t.name, t.description)),
  })).filter((s) => (tab === 'all' || tab === s.id) && s.tools.length > 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [query, tab]);
  const planned = PLANNED_TOOLS.filter((p) => match(p.name, p.description));
  const showPlanned = (tab === 'all' || tab === 'more') && planned.length > 0;
  const popular = popularTools();
  const empty = sections.length === 0 && !showPlanned;

  return (
    <div>
      {!query && tab === 'all' && (
        <section aria-labelledby="popular-h" className="mb-14">
          <h2 id="popular-h" className="mb-5 text-2xl">Popular tools</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{popular.map((t) => <ToolCard key={t.id} tool={t} />)}</div>
        </section>
      )}

      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div role="tablist" aria-label="Tool categories" className="flex flex-wrap gap-1 border-b border-line">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`-mb-px rounded-t-lg border border-b-0 px-4 py-2 font-semibold ${tab === t.id ? 'border-line bg-sheet text-pine' : 'border-transparent text-muted hover:text-ink'}`}>{t.label}</button>
          ))}
        </div>
        <div className="relative md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools" aria-label="Search tools" className="field !pl-9" />
        </div>
      </div>

      {empty && <p role="status" className="py-10 text-muted">No tools match “{q}”. Try “pdf”, “merge” or “resize”.</p>}

      <div className="space-y-12">
        {sections.map((s) => (
          <section key={s.id} aria-labelledby={`cat-${s.id}`}>
            <h2 id={`cat-${s.id}`} className="text-2xl">{s.name}</h2>
            <p className="mb-5 text-muted">{s.description}</p>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{s.tools.map((t) => <ToolCard key={t.id} tool={t} />)}</div>
          </section>
        ))}
        {showPlanned && (
          <section aria-labelledby="cat-more">
            <h2 id="cat-more" className="text-2xl">{CATEGORIES.more.name}</h2>
            <p className="mb-5 text-muted">Not built yet. These are what we're working toward.</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{planned.map((p) => <PlannedCard key={p.name} {...p} />)}</div>
          </section>
        )}
      </div>
    </div>
  );
}
