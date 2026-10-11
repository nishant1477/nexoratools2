import { createWriteStream } from 'node:fs';
import archiver from 'archiver';
import { uniqueNames } from './files.js';

/** Stream files into a zip on disk (never holds the archive in memory). */
export async function zipFiles(outPath: string, files: { path: string; name: string }[]): Promise<void> {
  const names = uniqueNames(files.map((f) => f.name));
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(outPath);
    const zip = archiver('zip', { zlib: { level: 3 } });
    out.on('close', () => resolve());
    out.on('error', reject);
    zip.on('error', reject);
    zip.pipe(out);
    files.forEach((f, i) => zip.file(f.path, { name: names[i] as string }));
    void zip.finalize();
  });
}
