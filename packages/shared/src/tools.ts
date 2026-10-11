import { z } from 'zod';
import type { WorkerKind } from './api.js';

export type ToolCategory = 'pdf' | 'image' | 'more';
export type OutputKind = 'pdf' | 'jpg' | 'png' | 'zip' | 'same';

export const CATEGORIES: Record<ToolCategory, { name: string; description: string }> = {
  pdf: { name: 'PDF Tools', description: 'Convert, merge, split and tidy PDF documents.' },
  image: { name: 'Image Tools', description: 'Convert, shrink and resize pictures.' },
  more: { name: 'More Tools', description: 'More tools are on the way.' },
};

/** Accepted upload types. Extension AND detected content type must both match. */
export const FILE_KINDS = {
  pdf: { extensions: ['pdf'], mimeTypes: ['application/pdf'] },
  jpg: { extensions: ['jpg', 'jpeg'], mimeTypes: ['image/jpeg'] },
  png: { extensions: ['png'], mimeTypes: ['image/png'] },
} as const;
export type FileKind = keyof typeof FILE_KINDS;

export type ToolOptionField =
  | { key: string; label: string; type: 'number'; min?: number; max?: number; help?: string }
  | { key: string; label: string; type: 'select'; choices: readonly { value: string; label: string }[]; help?: string }
  | { key: string; label: string; type: 'text'; placeholder?: string; help?: string };

/**
 * A tool is pure metadata + validation. Processing code lives in the worker package
 * and is looked up by `id`; the upload/job/queue plumbing is shared by every tool.
 */
export interface ToolDefinition<O extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string; // stable identifier stored in Job.tool, e.g. "pdf-to-jpg"
  name: string;
  description: string;
  category: ToolCategory;
  icon: string; // lucide icon name, resolved by the frontend
  worker: WorkerKind; // which queue processes this tool
  accepts: readonly FileKind[];
  minFiles: number;
  maxFiles: number;
  orderMatters?: boolean; // e.g. merge-pdf: upload order = output order
  output: OutputKind; // 'zip' when a job can yield multiple files
  options: O; // zod schema for tool options (parse {} to get defaults)
  optionFields?: readonly ToolOptionField[]; // drives the frontend options form
  popular?: boolean;
  publicApi?: boolean; // exposed through API keys in V1
}

/** Page range like "1-3,5,8-10". Validated structurally here, against the page count in the worker. */
export const pageRangeSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^\d+(-\d+)?(\s*,\s*\d+(-\d+)?)*$/, 'Use a format like 1-3,5,8-10');

const quality = z.coerce.number().int().min(1).max(100);
const pageSize = z.enum(['fit', 'a4', 'letter']).default('fit');
const pageSizeField = {
  key: 'pageSize', label: 'Page size', type: 'select',
  choices: [{ value: 'fit', label: 'Fit to image' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'US Letter' }],
} as const;

export const TOOLS = [
  {
    id: 'jpg-to-pdf', name: 'JPG to PDF', description: 'Combine JPG images into a single PDF.',
    category: 'pdf', icon: 'FileImage', worker: 'pdf', accepts: ['jpg'], minFiles: 1, maxFiles: 50,
    orderMatters: true, output: 'pdf', popular: true, publicApi: true,
    options: z.object({ pageSize }), optionFields: [pageSizeField],
  },
  {
    id: 'png-to-pdf', name: 'PNG to PDF', description: 'Combine PNG images into a single PDF.',
    category: 'pdf', icon: 'FileImage', worker: 'pdf', accepts: ['png'], minFiles: 1, maxFiles: 50,
    orderMatters: true, output: 'pdf', publicApi: true,
    options: z.object({ pageSize }), optionFields: [pageSizeField],
  },
  {
    id: 'pdf-to-jpg', name: 'PDF to JPG', description: 'Turn every PDF page into a JPG image.',
    category: 'pdf', icon: 'Images', worker: 'pdf', accepts: ['pdf'], minFiles: 1, maxFiles: 1,
    output: 'zip', popular: true, publicApi: true,
    options: z.object({ dpi: z.coerce.number().int().min(72).max(300).default(150), quality: quality.default(85) }),
    optionFields: [
      { key: 'dpi', label: 'Resolution (DPI)', type: 'number', min: 72, max: 300 },
      { key: 'quality', label: 'JPG quality', type: 'number', min: 1, max: 100 }],
  },
  {
    id: 'pdf-to-png', name: 'PDF to PNG', description: 'Turn every PDF page into a PNG image.',
    category: 'pdf', icon: 'Images', worker: 'pdf', accepts: ['pdf'], minFiles: 1, maxFiles: 1,
    output: 'zip', publicApi: true,
    options: z.object({ dpi: z.coerce.number().int().min(72).max(300).default(150) }),
    optionFields: [{ key: 'dpi', label: 'Resolution (DPI)', type: 'number', min: 72, max: 300 }],
  },
  {
    id: 'merge-pdf', name: 'Merge PDF', description: 'Join several PDFs into one, in the order you choose.',
    category: 'pdf', icon: 'Combine', worker: 'pdf', accepts: ['pdf'], minFiles: 2, maxFiles: 20,
    orderMatters: true, output: 'pdf', popular: true, publicApi: true, options: z.object({}),
  },
  {
    id: 'split-pdf', name: 'Split PDF', description: 'Split a PDF into single pages or custom ranges.',
    category: 'pdf', icon: 'Scissors', worker: 'pdf', accepts: ['pdf'], minFiles: 1, maxFiles: 1,
    output: 'zip', popular: true,
    options: z.object({ mode: z.enum(['every-page', 'ranges']).default('every-page'), ranges: pageRangeSchema.optional() })
      .refine((o) => o.mode !== 'ranges' || !!o.ranges, { message: 'Enter the page ranges to split by', path: ['ranges'] }),
    optionFields: [
      { key: 'mode', label: 'Split mode', type: 'select', choices: [
        { value: 'every-page', label: 'One file per page' }, { value: 'ranges', label: 'Custom ranges' }] },
      { key: 'ranges', label: 'Ranges', type: 'text', placeholder: '1-3,4-6', help: 'Each comma-separated range becomes its own PDF.' }],
  },
  {
    id: 'compress-pdf', name: 'Compress PDF', description: 'Reduce PDF file size while keeping it readable.',
    category: 'pdf', icon: 'Minimize2', worker: 'pdf', accepts: ['pdf'], minFiles: 1, maxFiles: 1,
    output: 'pdf', popular: true, publicApi: true,
    options: z.object({ level: z.enum(['low', 'medium', 'high']).default('medium') }),
    optionFields: [{ key: 'level', label: 'Compression', type: 'select', choices: [
      { value: 'low', label: 'Light (best quality)' }, { value: 'medium', label: 'Balanced' }, { value: 'high', label: 'Strong (smallest)' }] }],
  },
  {
    id: 'rotate-pdf', name: 'Rotate PDF', description: 'Rotate all pages, or only the ones you pick.',
    category: 'pdf', icon: 'RotateCw', worker: 'pdf', accepts: ['pdf'], minFiles: 1, maxFiles: 1,
    output: 'pdf', publicApi: true,
    options: z.object({
      angle: z.coerce.number().refine((n) => [90, 180, 270].includes(n), 'Angle must be 90, 180 or 270').default(90),
      pages: pageRangeSchema.optional(),
    }),
    optionFields: [
      { key: 'angle', label: 'Rotate clockwise by', type: 'select', choices: [
        { value: '90', label: '90°' }, { value: '180', label: '180°' }, { value: '270', label: '270°' }] },
      { key: 'pages', label: 'Pages (optional)', type: 'text', placeholder: 'All pages', help: 'Leave empty to rotate every page.' }],
  },
  {
    id: 'delete-pdf-pages', name: 'Delete PDF pages', description: 'Remove unwanted pages from a PDF.',
    category: 'pdf', icon: 'Trash2', worker: 'pdf', accepts: ['pdf'], minFiles: 1, maxFiles: 1,
    output: 'pdf', publicApi: true, options: z.object({ pages: pageRangeSchema }),
    optionFields: [{ key: 'pages', label: 'Pages to delete', type: 'text', placeholder: '2,4-6' }],
  },
  {
    id: 'extract-pdf-pages', name: 'Extract PDF pages', description: 'Keep only the pages you need.',
    category: 'pdf', icon: 'FileOutput', worker: 'pdf', accepts: ['pdf'], minFiles: 1, maxFiles: 1,
    output: 'pdf', publicApi: true, options: z.object({ pages: pageRangeSchema }),
    optionFields: [{ key: 'pages', label: 'Pages to keep', type: 'text', placeholder: '1-3,7' }],
  },
  {
    id: 'jpg-to-png', name: 'JPG to PNG', description: 'Convert JPG images to lossless PNG.',
    category: 'image', icon: 'Image', worker: 'image', accepts: ['jpg'], minFiles: 1, maxFiles: 20,
    output: 'png', publicApi: true, options: z.object({}),
  },
  {
    id: 'png-to-jpg', name: 'PNG to JPG', description: 'Convert PNG images to compact JPG.',
    category: 'image', icon: 'Image', worker: 'image', accepts: ['png'], minFiles: 1, maxFiles: 20,
    output: 'jpg', popular: true, publicApi: true,
    options: z.object({ quality: quality.default(90), background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff') }),
    optionFields: [{ key: 'quality', label: 'JPG quality', type: 'number', min: 1, max: 100 }],
  },
  {
    id: 'compress-image', name: 'Image compressor', description: 'Make JPG and PNG images much smaller.',
    category: 'image', icon: 'Shrink', worker: 'image', accepts: ['jpg', 'png'], minFiles: 1, maxFiles: 20,
    output: 'same', popular: true, publicApi: true, options: z.object({ quality: quality.default(75) }),
    optionFields: [{ key: 'quality', label: 'Quality', type: 'number', min: 1, max: 100, help: 'Lower = smaller file.' }],
  },
  {
    id: 'resize-image', name: 'Image resizer', description: 'Resize images by width, height or percentage.',
    category: 'image', icon: 'Scaling', worker: 'image', accepts: ['jpg', 'png'], minFiles: 1, maxFiles: 20,
    output: 'same', publicApi: true,
    options: z.object({
      width: z.coerce.number().int().min(1).max(20000).optional(),
      height: z.coerce.number().int().min(1).max(20000).optional(),
      percent: z.coerce.number().min(1).max(400).optional(),
      fit: z.enum(['inside', 'cover', 'fill']).default('inside'),
    }).refine((o) => o.width || o.height || o.percent, { message: 'Set a width, height or percentage', path: ['width'] }),
    optionFields: [
      { key: 'width', label: 'Width (px)', type: 'number', min: 1, max: 20000 },
      { key: 'height', label: 'Height (px)', type: 'number', min: 1, max: 20000 },
      { key: 'percent', label: 'Or scale (%)', type: 'number', min: 1, max: 400 }],
  },
] as const satisfies readonly ToolDefinition[];

export type ToolId = (typeof TOOLS)[number]['id'];
const byId = new Map<string, ToolDefinition>(TOOLS.map((t) => [t.id, t as ToolDefinition]));

export const getTool = (id: string): ToolDefinition | undefined => byId.get(id);
export const isToolId = (id: string): id is ToolId => byId.has(id);

/** Parsed (defaults applied) options type for a tool, e.g. ToolOptions<'pdf-to-jpg'>. */
export type ToolOptions<Id extends ToolId> = z.infer<Extract<(typeof TOOLS)[number], { id: Id }>['options']>;
