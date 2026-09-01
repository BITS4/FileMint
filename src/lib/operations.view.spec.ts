import { describe, expect, it } from 'vitest';

import { VIEW_OPERATIONS } from './operations.view';

describe('document view operations', () => {
  it('keeps specialized PDF import metadata separate from the generic viewer', () => {
    expect(VIEW_OPERATIONS['import-pdf']).toMatchObject({
      mode: 'open',
      libraryKinds: ['pdf'],
      deviceTypes: 'application/pdf',
    });
    expect(VIEW_OPERATIONS['open-pdf'].pickTitle).toBe('Open a PDF');
  });

  it('accepts every library kind supported by the document viewer', () => {
    expect(VIEW_OPERATIONS['open-document']).toMatchObject({
      mode: 'open',
      deviceTypes: '*/*',
      pickIcon: 'file-eye-outline',
    });
    expect(VIEW_OPERATIONS['open-document'].libraryKinds).toEqual(
      expect.arrayContaining(['pdf', 'image', 'word', 'excel', 'ppt', 'text', 'csv', 'other']),
    );
  });
});
