import type { AccentName } from '@/constants/theme';
import type { ToolCategory, ToolDef } from '@/types';

export interface CategoryMeta {
  key: ToolCategory;
  label: string;
  icon: string;
  accent: AccentName;
}

export const CATEGORIES: CategoryMeta[] = [
  { key: 'convert', label: 'Convert', icon: 'swap-horizontal', accent: 'violet' },
  { key: 'organize', label: 'Organize', icon: 'file-document-multiple-outline', accent: 'teal' },
  { key: 'edit', label: 'Edit PDF', icon: 'pencil-outline', accent: 'green' },
  { key: 'scan', label: 'Scan', icon: 'line-scan', accent: 'sky' },
  { key: 'ocr', label: 'OCR', icon: 'text-recognition', accent: 'purple' },
  { key: 'security', label: 'Security', icon: 'shield-lock-outline', accent: 'red' },
  { key: 'view', label: 'View & Read', icon: 'book-open-variant', accent: 'cyan' },
];

export const STATUS_LABEL: Record<ToolDef['status'], string> = {
  ready: 'Ready',
  beta: 'Beta',
  backend: 'Server',
  soon: 'Soon',
};
