import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { csvRowsToPdf, optimizePdf, textToPdf } from './pdf';

describe('PDF content generation', () => {
  it('paginates long text and accepts characters outside WinAnsi safely', async () => {
    const text = Array.from({ length: 180 }, (_, index) => `Line ${index + 1}: FileMint document ✓`).join(
      '\n',
    );
    const bytes = await textToPdf(text, { title: 'Export ✓', fontSize: 12, pageSize: 'letter' });
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(document.getTitle()).toBeUndefined();
  });

  it('turns tabular rows into a readable multi-page PDF', async () => {
    const rows = [
      ['Name', 'Status', 'Notes'],
      ...Array.from({ length: 80 }, (_, index) => [
        `Document ${index + 1}`,
        index % 2 ? 'Ready' : 'Processing',
        'A deliberately descriptive cell that exercises wrapping.',
      ]),
    ];
    const document = await PDFDocument.load(await csvRowsToPdf(rows, 'Document inventory'));

    expect(document.getPageCount()).toBeGreaterThan(1);
  });

  it('uses document defaults for blank, monospace, and short content', async () => {
    const bytes = await textToPdf('\n   \nshort', { mono: true });
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(1);
  });

  it('renders empty and sparse tables without requiring populated cells', async () => {
    const empty = await PDFDocument.load(await csvRowsToPdf([]));
    expect(empty.getPageCount()).toBe(1);

    const sparse = await PDFDocument.load(await csvRowsToPdf([[], ['A very long heading that wraps']]));
    expect(sparse.getPageCount()).toBe(1);
  });

  it('optimizes an existing PDF and records FileMint metadata', async () => {
    const source = await textToPdf('Source document', { title: 'Before optimization' });
    const document = await PDFDocument.load(await optimizePdf(source));

    expect(document.getCreator()).toBe('FileMint');
    expect(document.getTitle()).toBe('');
  });
});
