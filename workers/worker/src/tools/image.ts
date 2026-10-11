import { copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { AppError } from '@nexora/shared';
import { baseName } from '../lib/files.js';
import { defineProcessor, type InputFile, type OutputFile, type ProcessorContext } from './types.js';

const MAX_INPUT_PIXELS = 100_000_000;
const MIME = { jpg: 'image/jpeg', png: 'image/png' } as const;

const open = (input: InputFile): Sharp => sharp(input.path, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });

/** Run per-file work, translating decoder failures into a friendly per-file message. */
async function forEachImage(ctx: ProcessorContext<never> | ProcessorContext<Record<string, unknown>>, fn: (input: InputFile, index: number) => Promise<OutputFile>): Promise<OutputFile[]> {
  const outputs: OutputFile[] = [];
  for (const [i, input] of ctx.inputs.entries()) {
    ctx.signal.throwIfAborted();
    try {
      outputs.push(await fn(input, i));
    } catch (err) {
      if (err instanceof AppError) throw err;
      ctx.log.warn({ err, file: input.filename }, 'image processing failed');
      throw new AppError('UNSUPPORTED_FILE', `"${input.filename}" is corrupt, too large, or can't be read as an image.`);
    }
  }
  return outputs;
}

export const jpgToPng = defineProcessor('jpg-to-png', (ctx) =>
  forEachImage(ctx, async (input, i) => {
    const out = path.join(ctx.workDir, `out-${i}.png`);
    await open(input).rotate().png({ compressionLevel: 6 }).toFile(out);
    return { path: out, filename: `${baseName(input.filename)}.png`, mimeType: MIME.png };
  }));

export const pngToJpg = defineProcessor('png-to-jpg', (ctx) =>
  forEachImage(ctx, async (input, i) => {
    const out = path.join(ctx.workDir, `out-${i}.jpg`);
    // JPG has no transparency: composite onto the chosen background instead of turning it black.
    await open(input).rotate().flatten({ background: ctx.options.background }).jpeg({ quality: ctx.options.quality, mozjpeg: true }).toFile(out);
    return { path: out, filename: `${baseName(input.filename)}.jpg`, mimeType: MIME.jpg };
  }));

export const compressImage = defineProcessor('compress-image', (ctx) =>
  forEachImage(ctx, async (input, i) => {
    const ext = input.kind === 'png' ? 'png' : 'jpg';
    const out = path.join(ctx.workDir, `out-${i}.${ext}`);
    const img = open(input).rotate();
    if (input.kind === 'png') await img.png({ quality: ctx.options.quality, palette: true, compressionLevel: 9, effort: 7 }).toFile(out);
    else await img.jpeg({ quality: ctx.options.quality, mozjpeg: true }).toFile(out);
    const filename = `${baseName(input.filename)}-compressed.${ext}`;
    if ((await stat(out)).size >= input.size) {
      // Never return something bigger than what was uploaded.
      const keep = path.join(ctx.workDir, `orig-${i}.${ext}`);
      await copyFile(input.path, keep);
      return { path: keep, filename, mimeType: MIME[ext] };
    }
    return { path: out, filename, mimeType: MIME[ext] };
  }));

export const resizeImage = defineProcessor('resize-image', (ctx) =>
  forEachImage(ctx, async (input, i) => {
    const ext = input.kind === 'png' ? 'png' : 'jpg';
    const out = path.join(ctx.workDir, `out-${i}.${ext}`);
    let { width, height } = ctx.options;
    if (ctx.options.percent) {
      const meta = await open(input).metadata();
      const swap = (meta.orientation ?? 1) >= 5; // EXIF-rotated images report swapped dimensions
      const [w, h] = swap ? [meta.height, meta.width] : [meta.width, meta.height];
      if (!w || !h) throw new AppError('UNSUPPORTED_FILE', `"${input.filename}" has no readable dimensions.`);
      width = Math.max(1, Math.round((w * ctx.options.percent) / 100));
      height = Math.max(1, Math.round((h * ctx.options.percent) / 100));
    }
    if ((width ?? 1) * (height ?? 1) > MAX_INPUT_PIXELS) throw new AppError('INVALID_OPTIONS', 'The requested size is too large.');
    const img = open(input).rotate().resize({ width, height, fit: ctx.options.fit });
    if (input.kind === 'png') await img.png({ compressionLevel: 6 }).toFile(out);
    else await img.jpeg({ quality: 90, mozjpeg: true }).toFile(out);
    return { path: out, filename: `${baseName(input.filename)}-resized.${ext}`, mimeType: MIME[ext] };
  }));
