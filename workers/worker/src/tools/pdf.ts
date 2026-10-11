import { copyFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument, degrees } from 'pdf-lib';
import { AppError } from '@nexora/shared';
import { run } from '../lib/exec.js';
import { baseName } from '../lib/files.js';
import { loadPdf, pdfInfo } from '../lib/pdf.js';
import { parseRanges, rangesToIndexes } from '../lib/ranges.js';
import { defineProcessor, type ProcessorContext } from './types.js';

const PDF_MIME = 'application/pdf';
const pdfOut = (p: string, filename: string) => [{ path: p, filename, mimeType: PDF_MIME }];

async function saveDoc(doc: PDFDocument, dir: string, name: string): Promise<string> {
  const out = path.join(dir, name);
  await writeFile(out, await doc.save());
  return out;
}

// ---------- images -> PDF ----------
const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;
const MAX_FIT_PT = 1440; // "fit to image" pages are capped at 20 inches on the long side

async function imagesToPdf(ctx: ProcessorContext<{ pageSize: 'fit' | 'a4' | 'letter' }>, kind: 'jpg' | 'png') {
  const doc = await PDFDocument.create();
  for (const input of ctx.inputs) {
    ctx.signal.throwIfAborted();
    let image;
    try {
      // Normalise through sharp: bakes in EXIF rotation and turns unusual PNGs (16-bit, interlaced) into safe ones.
      const pipeline = sharp(input.path, { limitInputPixels: 150_000_000, failOn: 'error' }).rotate();
      const buf = kind === 'jpg' ? await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer() : await pipeline.png().toBuffer();
      image = kind === 'jpg' ? await doc.embedJpg(buf) : await doc.embedPng(buf);
    } catch (err) {
      ctx.log.warn({ err, file: input.filename }, 'image could not be read');
      throw new AppError('UNSUPPORTED_FILE', `"${input.filename}" is corrupt or can't be read as a ${kind.toUpperCase()} image.`);
    }
    let pageW: number, pageH: number, scale: number, margin = 0;
    if (ctx.options.pageSize === 'fit') {
      scale = Math.min(1, MAX_FIT_PT / Math.max(image.width, image.height));
      pageW = image.width * scale; pageH = image.height * scale;
    } else {
      const [w, h] = PAGE_SIZES[ctx.options.pageSize];
      const landscape = image.width > image.height;
      pageW = landscape ? h : w; pageH = landscape ? w : h; margin = 24;
      scale = Math.min((pageW - 2 * margin) / image.width, (pageH - 2 * margin) / image.height);
    }
    const w = image.width * scale, h = image.height * scale;
    const page = doc.addPage([pageW, pageH]);
    page.drawImage(image, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
  }
  return pdfOut(await saveDoc(doc, ctx.workDir, 'images.pdf'), 'images.pdf');
}

export const jpgToPdf = defineProcessor('jpg-to-pdf', (ctx) => imagesToPdf(ctx, 'jpg'));
export const pngToPdf = defineProcessor('png-to-pdf', (ctx) => imagesToPdf(ctx, 'png'));

// ---------- PDF -> images (poppler) ----------
async function pdfToImages(ctx: ProcessorContext<{ dpi: number; quality?: number }>, format: 'jpg' | 'png') {
  const input = ctx.inputs[0]!;
  const info = await pdfInfo('pdfinfo', input.path, ctx.env.MAX_PDF_PAGES, ctx.signal);
  const px = (Math.max(info.maxPageWidthPt, 1) / 72) * ctx.options.dpi * ((Math.max(info.maxPageHeightPt, 1) / 72) * ctx.options.dpi);
  if (px > 120_000_000) {
    throw new AppError('CONVERSION_FAILED', 'The pages in this PDF are too large to render at that resolution. Try a lower DPI.');
  }
  const prefix = path.join(ctx.workDir, 'page');
  const args = ['-r', String(ctx.options.dpi), ...(format === 'jpg' ? ['-jpeg', '-jpegopt', `quality=${ctx.options.quality ?? 85}`] : ['-png']), input.path, prefix];
  try {
    await run(ctx.env.PDFTOPPM_BIN, args, { signal: ctx.signal, timeoutMs: ctx.env.JOB_TIMEOUT_SECONDS * 1000 });
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    ctx.log.warn({ err }, 'pdftoppm failed');
    throw new AppError('CORRUPT_PDF', 'The PDF could not be rendered. It may be damaged.');
  }
  const ext = format;
  const files = (await readdir(ctx.workDir)).filter((f) => f.startsWith('page-') && f.endsWith(`.${format === 'jpg' ? 'jpg' : 'png'}`)).sort();
  if (files.length === 0) throw new AppError('CONVERSION_FAILED', 'No pages could be rendered from this PDF.');
  const base = baseName(input.filename);
  return files.map((f, i) => ({
    path: path.join(ctx.workDir, f),
    filename: `${base}-page-${String(i + 1).padStart(String(files.length).length, '0')}.${ext}`,
    mimeType: format === 'jpg' ? 'image/jpeg' : 'image/png',
  }));
}

export const pdfToJpg = defineProcessor('pdf-to-jpg', (ctx) => pdfToImages(ctx, 'jpg'));
export const pdfToPng = defineProcessor('pdf-to-png', (ctx) => pdfToImages(ctx, 'png'));

// ---------- merge ----------
export const mergePdf = defineProcessor('merge-pdf', async (ctx) => {
  const merged = await PDFDocument.create();
  let total = 0;
  for (const input of ctx.inputs) {
    ctx.signal.throwIfAborted();
    let src: PDFDocument;
    try { src = await loadPdf(input.path); } catch (err) {
      if (err instanceof AppError) throw new AppError(err.code, `"${input.filename}": ${err.message}`);
      throw err;
    }
    total += src.getPageCount();
    if (total > ctx.env.MAX_PDF_PAGES * 2) throw new AppError('CONVERSION_FAILED', 'The merged PDF would be too large.');
    for (const page of await merged.copyPages(src, src.getPageIndices())) merged.addPage(page);
  }
  return pdfOut(await saveDoc(merged, ctx.workDir, 'merged.pdf'), 'merged.pdf');
});

// ---------- split ----------
export const splitPdf = defineProcessor('split-pdf', async (ctx) => {
  const input = ctx.inputs[0]!;
  await pdfInfo('pdfinfo', input.path, ctx.env.MAX_PDF_PAGES, ctx.signal);
  const src = await loadPdf(input.path);
  const n = src.getPageCount();
  const base = baseName(input.filename);
  const groups: { label: string; indexes: number[] }[] =
    ctx.options.mode === 'ranges'
      ? parseRanges(ctx.options.ranges ?? '', n).map((r) => ({ label: r.start === r.end ? `page-${r.start}` : `pages-${r.start}-${r.end}`, indexes: rangesToIndexes([r]) }))
      : src.getPageIndices().map((i) => ({ label: `page-${String(i + 1).padStart(String(n).length, '0')}`, indexes: [i] }));

  const outputs = [];
  for (const g of groups) {
    ctx.signal.throwIfAborted();
    const doc = await PDFDocument.create();
    for (const page of await doc.copyPages(src, g.indexes)) doc.addPage(page);
    const filename = `${base}-${g.label}.pdf`;
    outputs.push({ path: await saveDoc(doc, ctx.workDir, `out-${outputs.length}.pdf`), filename, mimeType: PDF_MIME });
  }
  return outputs;
});

// ---------- rotate ----------
export const rotatePdf = defineProcessor('rotate-pdf', async (ctx) => {
  const input = ctx.inputs[0]!;
  const doc = await loadPdf(input.path);
  const pages = doc.getPages();
  const targets = ctx.options.pages ? rangesToIndexes(parseRanges(ctx.options.pages, pages.length)) : pages.map((_, i) => i);
  for (const i of targets) {
    const page = pages[i]!;
    page.setRotation(degrees((page.getRotation().angle + ctx.options.angle) % 360));
  }
  return pdfOut(await saveDoc(doc, ctx.workDir, 'rotated.pdf'), `${baseName(input.filename)}-rotated.pdf`);
});

// ---------- delete / extract pages ----------
export const deletePdfPages = defineProcessor('delete-pdf-pages', async (ctx) => {
  const input = ctx.inputs[0]!;
  const doc = await loadPdf(input.path);
  const n = doc.getPageCount();
  const toDelete = new Set(rangesToIndexes(parseRanges(ctx.options.pages, n)));
  if (toDelete.size >= n) throw new AppError('INVALID_OPTIONS', 'You can\'t delete every page — at least one page must remain.');
  // Remove from the end so indexes stay valid.
  for (const i of [...toDelete].sort((a, b) => b - a)) doc.removePage(i);
  return pdfOut(await saveDoc(doc, ctx.workDir, 'edited.pdf'), `${baseName(input.filename)}-edited.pdf`);
});

export const extractPdfPages = defineProcessor('extract-pdf-pages', async (ctx) => {
  const input = ctx.inputs[0]!;
  const src = await loadPdf(input.path);
  const indexes = rangesToIndexes(parseRanges(ctx.options.pages, src.getPageCount()));
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(src, indexes)) out.addPage(page);
  return pdfOut(await saveDoc(out, ctx.workDir, 'extracted.pdf'), `${baseName(input.filename)}-extracted.pdf`);
});

// ---------- compress (Ghostscript) ----------
const GS_PRESET = { low: '/printer', medium: '/ebook', high: '/screen' } as const;

export const compressPdf = defineProcessor('compress-pdf', async (ctx) => {
  const input = ctx.inputs[0]!;
  await pdfInfo('pdfinfo', input.path, ctx.env.MAX_PDF_PAGES, ctx.signal);
  const out = path.join(ctx.workDir, 'compressed.pdf');
  try {
    await run(ctx.env.GHOSTSCRIPT_BIN, [
      '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=${GS_PRESET[ctx.options.level]}`,
      '-dNOPAUSE', '-dBATCH', '-dQUIET', '-dSAFER', `-sOutputFile=${out}`, input.path,
    ], { signal: ctx.signal, timeoutMs: ctx.env.JOB_TIMEOUT_SECONDS * 1000 });
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    ctx.log.warn({ err }, 'ghostscript failed');
    throw new AppError('CORRUPT_PDF', 'This PDF could not be compressed. It may be damaged.');
  }
  const [before, after] = [(await stat(input.path)).size, (await stat(out)).size];
  const filename = `${baseName(input.filename)}-compressed.pdf`;
  if (after >= before) {
    // Already optimised: don't hand back a bigger file. Return the original unchanged.
    const keep = path.join(ctx.workDir, 'original.pdf');
    await copyFile(input.path, keep);
    ctx.log.info({ before, after }, 'compression did not reduce size; returning original');
    return pdfOut(keep, filename);
  }
  await readFile(out).then((b) => { if (b.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError('CONVERSION_FAILED'); });
  return pdfOut(out, filename);
});
