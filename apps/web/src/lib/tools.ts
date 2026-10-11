import { CATEGORIES, TOOLS, getTool, type ToolCategory, type ToolDefinition } from '@nexora/shared';

export { CATEGORIES };
export type { ToolCategory };
export const ALL_TOOLS: readonly ToolDefinition[] = TOOLS;
export const toolById = (id: string): ToolDefinition | undefined => getTool(id);
export const toolName = (id: string): string => getTool(id)?.name ?? id;
export const popularTools = (): ToolDefinition[] => ALL_TOOLS.filter((t) => t.popular);
export const toolsIn = (c: ToolCategory): ToolDefinition[] => ALL_TOOLS.filter((t) => t.category === c);

/** Tools that apply to a dropped file, based on its extension. */
export function toolsForFile(name: string): ToolDefinition[] {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const kind = ext === 'pdf' ? 'pdf' : ext === 'jpg' || ext === 'jpeg' ? 'jpg' : ext === 'png' ? 'png' : null;
  return kind ? ALL_TOOLS.filter((t) => t.accepts.includes(kind)) : [];
}

/** Defaults for the options form, taken from each tool's own schema so UI and API never disagree. */
export function defaultOptions(tool: ToolDefinition): Record<string, string> {
  const parsed = tool.options.safeParse({});
  const out: Record<string, string> = {};
  if (parsed.success) for (const [k, v] of Object.entries(parsed.data as Record<string, unknown>)) if (v !== undefined) out[k] = String(v);
  return out;
}

/** Planned tools are shown honestly as planned: no button, no fake page. */
export const PLANNED_TOOLS = [
  { name: 'PDF to Word', description: 'Turn PDFs into editable documents.' },
  { name: 'Word to PDF', description: 'Convert .docx files to PDF.' },
  { name: 'OCR', description: 'Make scanned PDFs searchable.' },
  { name: 'Add watermark', description: 'Stamp text or a logo on every page.' },
  { name: 'Page numbers', description: 'Number the pages of a PDF.' },
  { name: 'Protect PDF', description: 'Lock a PDF with a password.' },
  { name: 'Unlock PDF', description: 'Remove a password you know.' },
  { name: 'HEIC to JPG', description: 'Convert iPhone photos.' },
  { name: 'WebP converter', description: 'Convert to and from WebP.' },
  { name: 'HTML to PDF', description: 'Save a web page as PDF.' },
] as const;
