import { AppError } from '@nexora/shared';

export interface PageRange { start: number; end: number } // 1-based, inclusive

/** Parse "1-3,5,8-10" and validate against the real page count. */
export function parseRanges(input: string, pageCount: number): PageRange[] {
  return input.split(',').map((part) => {
    const [a, b] = part.trim().split('-');
    const start = Number(a);
    const end = b === undefined ? start : Number(b);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw new AppError('INVALID_OPTIONS', `"${part.trim()}" is not a valid page range.`);
    }
    if (end > pageCount) {
      throw new AppError('INVALID_OPTIONS', `Page ${end} doesn't exist — this PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
    }
    return { start, end };
  });
}

/** Expand ranges to unique 0-based page indexes, keeping the order the user typed. */
export function rangesToIndexes(ranges: PageRange[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of ranges) for (let p = r.start; p <= r.end; p++) if (!seen.has(p - 1)) { seen.add(p - 1); out.push(p - 1); }
  return out;
}
