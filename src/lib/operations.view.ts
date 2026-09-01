import type { ToolOperation } from './operations.helpers';

export const VIEW_OPERATIONS: Record<string, ToolOperation> = {
  'import-pdf': {
    mode: 'open',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    pickTitle: 'Import a PDF',
  },
  'open-pdf': {
    mode: 'open',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    pickTitle: 'Open a PDF',
  },
  'open-document': {
    mode: 'open',
    libraryKinds: ['pdf', 'image', 'word', 'excel', 'ppt', 'text', 'csv', 'other'],
    deviceTypes: '*/*',
    pickTitle: 'Open a document',
    pickSubtitle: 'Read PDFs, Word, PowerPoint, Excel, CSV, HTML, text, and code files.',
    pickIcon: 'file-eye-outline',
  },
};
