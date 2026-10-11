import { basename, extname } from 'node:path';

/** "report.final.PDF" -> "report.final" */
export const baseName = (filename: string): string => basename(filename, extname(filename)) || 'file';

/** Make names unique inside one archive: a.png, a (2).png, ... */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) return n;
    const ext = extname(n);
    return `${basename(n, ext)} (${count})${ext}`;
  });
}
