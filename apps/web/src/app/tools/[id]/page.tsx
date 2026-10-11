import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ToolIcon } from '@/components/ToolIcon';
import { ToolRunner } from '@/components/ToolRunner';
import { ALL_TOOLS, CATEGORIES, toolById } from '@/lib/tools';

type Props = { params: Promise<{ id: string }> };
export const dynamicParams = false;
export const generateStaticParams = () => ALL_TOOLS.map((t) => ({ id: t.id }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tool = toolById((await params).id);
  return tool ? { title: tool.name, description: tool.description } : {};
}

export default async function ToolPage({ params }: Props) {
  const tool = toolById((await params).id);
  if (!tool) notFound();
  const heading: Record<string, string> = { 'merge-pdf': 'Merge PDF files', 'split-pdf': 'Split a PDF', 'compress-pdf': 'Compress a PDF' };
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
        <Link href="/#tools" className="hover:text-pine hover:underline">Tools</Link> / <span>{CATEGORIES[tool.category].name}</span>
      </nav>
      <div className="mb-8 flex items-start gap-4">
        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-pine text-on-pine"><ToolIcon name={tool.icon} className="h-7 w-7" /></span>
        <div>
          <h1 className="text-4xl font-extrabold sm:text-5xl">{heading[tool.id] ?? tool.name}</h1>
          <p className="mt-2 text-lg text-muted">{tool.description}</p>
        </div>
      </div>
      <ToolRunner toolId={tool.id} />
    </div>
  );
}
