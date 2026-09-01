// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { renderPptxOutline, renderPptxPreview } from './pptx-preview';

describe('safe PowerPoint previews', () => {
  it('prefers a high-fidelity converted PDF and skips local parsing', async () => {
    const container = document.createElement('div');
    const renderConvertedPdf = vi.fn(async () => {
      container.textContent = 'rendered PDF';
    });
    const parseOutline = vi.fn();

    await expect(
      renderPptxPreview({ bytes: new Uint8Array([1]), container, renderConvertedPdf, parseOutline }),
    ).resolves.toBe('converted-pdf');
    expect(parseOutline).not.toHaveBeenCalled();
    expect(container.textContent).toBe('rendered PDF');
  });

  it('uses textContent-only local rendering when conversion is unavailable', async () => {
    const container = document.createElement('div');
    container.innerHTML = '<span>stale content</span>';
    const malicious = '<img src=x onerror="attack()">';

    await expect(
      renderPptxPreview({
        bytes: new Uint8Array([7]),
        container,
        renderConvertedPdf: vi.fn().mockRejectedValue(new Error('server offline')),
        parseOutline: vi.fn().mockResolvedValue({
          slides: [
            { slideNumber: 1, lines: [malicious, 'Safe second line'] },
            { slideNumber: 2, lines: [] },
          ],
          textCharacters: malicious.length + 16,
        }),
      }),
    ).resolves.toBe('local-outline');

    expect(container.querySelector('[data-filemint-pptx-outline="true"]')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('span')).toBeNull();
    expect(container.textContent).toContain(malicious);
    expect(container.textContent).toContain('No readable text on this slide.');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Text-only local preview');
  });

  it('renders outlines directly without interpreting markup', () => {
    const container = document.createElement('div');
    renderPptxOutline(
      { slides: [{ slideNumber: 4, lines: ['<script>attack()</script>'] }], textCharacters: 25 },
      container,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('Slide 4');
    expect(container.querySelector('li')?.textContent).toBe('<script>attack()</script>');
  });

  it('reports both failures without hiding non-Error causes', async () => {
    await expect(
      renderPptxPreview({
        bytes: new Uint8Array([1]),
        container: document.createElement('div'),
        renderConvertedPdf: vi.fn().mockRejectedValue('offline'),
        parseOutline: vi.fn().mockRejectedValue(new Error('broken archive')),
      }),
    ).rejects.toThrow(
      'PowerPoint preview failed. Server conversion: unknown error. Local outline: broken archive.',
    );
  });

  it('uses the real parser by default and reports unreadable archives', async () => {
    await expect(
      renderPptxPreview({
        bytes: new Uint8Array([1, 2]),
        container: document.createElement('div'),
        renderConvertedPdf: vi.fn().mockRejectedValue(new Error('conversion unavailable')),
      }),
    ).rejects.toThrow('Local outline: The PowerPoint file is not a readable PPTX archive.');
  });
});
