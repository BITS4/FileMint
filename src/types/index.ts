import type { AccentName } from '@/constants/theme';

/** Logical document categories used for badges, filters and icons. */
export type FileKind = 'pdf' | 'image' | 'word' | 'excel' | 'ppt' | 'text' | 'csv' | 'archive' | 'other';

export type FileSource = 'import' | 'scan' | 'convert' | 'created';

export interface FileItem {
  id: string;
  /** Display name including extension, e.g. "Invoice 2024.pdf". */
  name: string;
  kind: FileKind;
  /** Lowercase extension without the dot, e.g. "pdf". */
  ext: string;
  mime?: string;
  /** Size in bytes. */
  size: number;
  /** Page count for paged documents (pdf). */
  pageCount?: number;
  createdAt: number;
  modifiedAt: number;
  favorite: boolean;
  folderId?: string | null;
  trashed?: boolean;
  trashedAt?: number;
  /** Key the storage layer uses to resolve the underlying bytes / uri. */
  storageKey: string;
  /** Cached thumbnail uri when available. */
  thumbnailUri?: string;
  /** Optional quality report produced by server-side conversion tools. */
  conversionReport?: ConversionReport;
  source: FileSource;
}

export interface ConversionReport {
  engine?: string;
  requestedMode?: string;
  resolvedMode?: string;
  pdfType?: 'digital' | 'scanned' | 'mixed' | 'unknown' | string;
  pagesConverted?: number;
  editableTextDetected?: boolean;
  tablesDetected?: number;
  imagesDetected?: number;
  lowConfidenceOcrAreas?: number;
  editableTextBoxes?: number;
  editableCharacters?: number;
  outputEditableCharacters?: number;
  outputTextRuns?: number;
  outputImages?: number;
  outputTables?: number;
  ocrTextCandidates?: number;
  textCoverageEstimate?: number;
  visualObjectsPreserved?: number;
  visualFragmentsPreserved?: number;
  rulesRebuiltAsWord?: number;
  hiddenTextLayer?: boolean;
  visibleEditableTextLayer?: boolean;
  tablesRebuiltAsWord?: number;
  ocrPasses?: string[];
  ocrLanguage?: string | null;
  autoDetectLanguage?: boolean;
  tableDetectionEnabled?: boolean;
  layoutPreservationEnabled?: boolean;
  keepVisualObjects?: boolean;
  visualObjectFormat?: string;
  docxQuality?: string;
  nonEditableVisualFallback?: boolean;
  warnings?: string[];
  notes?: string[];
}

export interface Folder {
  id: string;
  name: string;
  color?: AccentName;
  createdAt: number;
}

export type SortKey = 'name' | 'date' | 'size' | 'type';
export type ViewMode = 'list' | 'grid';

/** Home filter chips. */
export type FileFilter = 'all' | 'pdf' | 'docs' | 'excel' | 'ppt' | 'images' | 'recent' | 'favorites';

export type ToolCategory =
  | 'convert'
  | 'edit'
  | 'organize'
  | 'scan'
  | 'security'
  | 'ocr'
  | 'export'
  | 'view';

/**
 * Honest per-tool capability state so the UI never pretends something works:
 * - ready: fully functional offline in the client.
 * - beta: works but with known limitations.
 * - backend: needs the conversion server (LibreOffice / qpdf / ocr engine).
 * - soon: planned, screen exists but processing is not wired yet.
 */
export type ToolStatus = 'ready' | 'beta' | 'backend' | 'soon';

/** What a tool needs the user to provide before it can run. */
export type ToolInput = 'pdf' | 'images' | 'office' | 'any' | 'none' | 'camera';

export interface ToolDef {
  id: string;
  title: string;
  subtitle?: string;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
  accent: AccentName;
  category: ToolCategory;
  status: ToolStatus;
  /** Route to navigate to when the tool is tapped. */
  route: string;
  input: ToolInput;
  /** Highlighted in the Home quick-action grid. */
  quick?: boolean;
  keywords?: string[];
}

export interface ConvertJob {
  id: string;
  toolId: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  progress: number; // 0..1
  message?: string;
  resultFileId?: string;
}
