import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { AppError } from '@nexora/shared';
import { run } from './exec.js';

export interface PdfInfo { pages: number; maxPageWidthPt: number; maxPageHeightPt: number }

/** Use poppler's pdfinfo as the first line of defence: it rejects corrupt/encrypted files cheaply. */
export async function pdfInfo(bin: string, path: string, maxPages: number, signal?: AbortSignal): Promise<PdfInfo> {
  let out: string;
  try {
    out = (await run(bin, ['-f', '1', '-l', String(maxPages + 1), path], { signal, timeoutMs: 60_000 })).stdout;
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new AppError('CORRUPT_PDF', undefined, { reason: (err as Error).message.slice(0, 300) });
  }
  if (/^Encrypted:\s+yes/mi.test(out)) {
    throw new AppError('CORRUPT_PDF', 'This PDF is password-protected. Remove the password first.');
  }
  const pages = Number(/^Pages:\s+(\d+)/m.exec(out)?.[1]);
  if (!Number.isInteger(pages) || pages < 1) throw new AppError('CORRUPT_PDF');
  if (pages > maxPages) throw new AppError('CONVERSION_FAILED', `This PDF has ${pages} pages; the limit is ${maxPages}.`);
  let w = 0, h = 0;
  for (const m of out.matchAll(/^Page\s+\d+\s+size:\s+([\d.]+)\s+x\s+([\d.]+)/gm)) {
    w = Math.max(w, Number(m[1])); h = Math.max(h, Number(m[2]));
  }
  return { pages, maxPageWidthPt: w, maxPageHeightPt: h };
}

/** Load with pdf-lib; anything unreadable becomes a user-facing CORRUPT_PDF error. */
export async function loadPdf(path: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(await readFile(path), { ignoreEncryption: false, updateMetadata: false });
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (/encrypted/i.test(msg)) throw new AppError('CORRUPT_PDF', 'This PDF is password-protected. Remove the password first.');
    throw new AppError('CORRUPT_PDF', undefined, { reason: msg.slice(0, 300) });
  }
}
