import { compressPdf, deletePdfPages, extractPdfPages, jpgToPdf, mergePdf, pdfToJpg, pdfToPng, pngToPdf, rotatePdf, splitPdf } from './pdf.js';
import { compressImage, jpgToPng, pngToJpg, resizeImage } from './image.js';
import type { Processor } from './types.js';

/**
 * Register a processor here to make a tool runnable. The tool's metadata/validation lives in
 * @nexora/shared; nothing else (queue, DB, storage) needs to change.
 */
const all = [
  jpgToPdf, pngToPdf, pdfToJpg, pdfToPng, mergePdf, splitPdf, compressPdf, rotatePdf, deletePdfPages, extractPdfPages,
  jpgToPng, pngToJpg, compressImage, resizeImage,
];

export const processors = new Map<string, Processor>(all.map((p) => [p.id, p.run]));
