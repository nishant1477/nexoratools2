import type { FileKind } from '@nexora/shared';
import { FILE_KINDS } from '@nexora/shared';

/** Detect the real type from leading bytes. Never trust the client's MIME type or extension. */
export function sniffKind(head: Buffer): FileKind | null {
  if (head.length >= 5 && head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

export const extensionOf = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
};

export const canonicalMime = (kind: FileKind): string => FILE_KINDS[kind].mimeTypes[0];
export const canonicalExt = (kind: FileKind): string => FILE_KINDS[kind].extensions[0];
export const extensionMatches = (kind: FileKind, ext: string): boolean =>
  (FILE_KINDS[kind].extensions as readonly string[]).includes(ext);

/** Display-only filename: strips paths, control chars and odd characters. */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f"<>|:*?]/g, '').replace(/^\.+/, '').trim().slice(0, 120);
  return cleaned || 'file';
}
