import type { AccentName } from '@/constants/theme';
import type { FileKind } from '@/types';

/** Human readable byte size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  const rounded = value >= 100 || i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]}`;
}

/** "3 pages" / "1 page" / "" when unknown. */
export function formatPages(pageCount?: number): string {
  if (!pageCount || pageCount <= 0) return '';
  return `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;
}

/** Compact relative date, e.g. "Just now", "3h ago", "Yesterday", "12 Mar". */
export function formatRelativeDate(timestamp: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (diff < min) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 2 * day) return 'Yesterday';

  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

const EXT_TO_KIND: Record<string, FileKind> = {
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  avif: 'image',
  heic: 'image',
  heif: 'image',
  gif: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  svg: 'image',
  svgz: 'image',
  doc: 'word',
  docx: 'word',
  odt: 'word',
  rtf: 'word',
  xls: 'excel',
  xlsx: 'excel',
  ods: 'excel',
  ppt: 'ppt',
  pptx: 'ppt',
  odp: 'ppt',
  txt: 'text',
  md: 'text',
  csv: 'csv',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
};

export function extFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function kindFromExt(ext: string): FileKind {
  return EXT_TO_KIND[ext.toLowerCase()] ?? 'other';
}

export function kindFromMime(mime?: string): FileKind | undefined {
  if (!mime) return undefined;
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.includes('word') || mime.includes('msword')) return 'word';
  if (mime.includes('sheet') || mime.includes('excel')) return 'excel';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'ppt';
  if (mime === 'text/csv') return 'csv';
  if (mime.startsWith('text/')) return 'text';
  if (mime.includes('zip') || mime.includes('compressed')) return 'archive';
  return undefined;
}

export interface KindMeta {
  label: string;
  accent: AccentName;
  icon: string; // MaterialCommunityIcons name
}

const KIND_META: Record<FileKind, KindMeta> = {
  pdf: { label: 'PDF', accent: 'red', icon: 'file-pdf-box' },
  image: { label: 'IMG', accent: 'violet', icon: 'file-image' },
  word: { label: 'DOC', accent: 'blue', icon: 'file-word-box' },
  excel: { label: 'XLS', accent: 'green', icon: 'file-excel-box' },
  ppt: { label: 'PPT', accent: 'orange', icon: 'file-powerpoint-box' },
  text: { label: 'TXT', accent: 'slate', icon: 'file-document-outline' },
  csv: { label: 'CSV', accent: 'emerald', icon: 'file-delimited-outline' },
  archive: { label: 'ZIP', accent: 'amber', icon: 'folder-zip-outline' },
  other: { label: 'FILE', accent: 'slate', icon: 'file-outline' },
};

export function kindMeta(kind: FileKind): KindMeta {
  return KIND_META[kind] ?? KIND_META.other;
}

/** Ensure a file name carries the expected extension. */
export function withExt(name: string, ext: string): string {
  const clean = name.trim();
  if (!clean) return `Untitled.${ext}`;
  return extFromName(clean) === ext.toLowerCase() ? clean : `${clean}.${ext}`;
}

/** Avoid duplicate names within a set by appending " (n)". */
export function uniqueName(name: string, existing: string[]): string {
  if (!existing.includes(name)) return name;
  const ext = extFromName(name);
  const stem = ext ? baseName(name) : name;
  let n = 2;
  let candidate = ext ? `${stem} (${n}).${ext}` : `${stem} (${n})`;
  while (existing.includes(candidate)) {
    n += 1;
    candidate = ext ? `${stem} (${n}).${ext}` : `${stem} (${n})`;
  }
  return candidate;
}
