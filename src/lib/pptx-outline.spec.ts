import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { extractPptxSlideLines, parsePptxOutline } from './pptx-outline';

function slideXml(paragraphs: string[]) {
  return `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld>${paragraphs
    .map((paragraph) => `<a:p>${paragraph}</a:p>`)
    .join('')}</p:cSld></p:sld>`;
}

async function pptx(slides: Array<{ number: number; xml: string | Uint8Array }>) {
  const zip = new JSZip();
  for (const slide of slides) zip.file(`ppt/slides/slide${slide.number}.xml`, slide.xml);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('PowerPoint outline parsing', () => {
  it('extracts paragraphs, joins runs, decodes XML entities, and sorts slides', async () => {
    const bytes = await pptx([
      { number: 2, xml: slideXml(['<a:r><a:t>Second slide</a:t></a:r>']) },
      {
        number: 1,
        xml: slideXml([
          '<a:r><a:t>Quarterly &amp; safe</a:t></a:r><a:r><a:t> overview</a:t></a:r>',
          '<a:r><a:t>&lt;img onerror=&quot;attack()&quot;&gt; &#x1F680; &#55296;</a:t></a:r>',
          '<a:r><a:t>   </a:t></a:r>',
        ]),
      },
    ]);

    await expect(parsePptxOutline(bytes)).resolves.toEqual({
      slides: [
        {
          slideNumber: 1,
          lines: ['Quarterly & safe overview', '<img onerror="attack()"> 🚀 �'],
        },
        { slideNumber: 2, lines: ['Second slide'] },
      ],
      textCharacters: 66,
    });
  });

  it('falls back to loose text runs when a slide has no paragraph elements', () => {
    expect(extractPptxSlideLines('<p:sld><a:t>One</a:t><a:t>Two &apos;words&apos;</a:t></p:sld>')).toEqual([
      'One',
      "Two 'words'",
    ]);
  });

  it('retains unknown entities as inert text', () => {
    expect(extractPptxSlideLines('<a:p><a:t>A &custom; value</a:t></a:p>')).toEqual(['A &custom; value']);
  });

  it('rejects empty, malformed, and slide-free archives with clear errors', async () => {
    await expect(parsePptxOutline(new Uint8Array())).rejects.toThrow('PowerPoint file is empty');
    await expect(parsePptxOutline(new Uint8Array([1, 2, 3]))).rejects.toThrow('not a readable PPTX archive');
    const emptyZip = await new JSZip().generateAsync({ type: 'uint8array' });
    await expect(parsePptxOutline(emptyZip)).rejects.toThrow('does not contain any PowerPoint slides');
  });

  it('enforces archive, slide count, slide XML, and total text bounds', async () => {
    const twoSlides = await pptx([
      { number: 1, xml: slideXml(['<a:t>first</a:t>']) },
      { number: 2, xml: slideXml(['<a:t>second</a:t>']) },
    ]);
    await expect(parsePptxOutline(twoSlides, { maxArchiveBytes: 1 })).rejects.toThrow(
      '1-byte local preview limit',
    );
    await expect(parsePptxOutline(twoSlides, { maxSlides: 1 })).rejects.toThrow('1-slide preview limit');
    await expect(parsePptxOutline(twoSlides, { maxSlideXmlBytes: 5 })).rejects.toThrow(
      'exceeds the local preview size limit',
    );
    await expect(parsePptxOutline(twoSlides, { maxTextCharacters: 5 })).rejects.toThrow(
      'too much text for a safe local preview',
    );
  });

  it('rejects invalid limits and invalid UTF-8 slide XML', async () => {
    const valid = await pptx([{ number: 1, xml: slideXml(['<a:t>ok</a:t>']) }]);
    await expect(parsePptxOutline(valid, { maxSlides: 0 })).rejects.toThrow(
      'Invalid PowerPoint preview limit: maxSlides',
    );

    const invalid = await pptx([{ number: 1, xml: new Uint8Array([0xc3, 0x28]) }]);
    await expect(parsePptxOutline(invalid)).rejects.toThrow('contains invalid XML text');
  });

  it('ignores directories and unrelated slide-like paths', async () => {
    const zip = new JSZip();
    zip.folder('ppt/slides/slide1.xml');
    zip.file('ppt/notesSlides/slide1.xml', slideXml(['<a:t>secret note</a:t>']));
    zip.file('ppt/slides/slide01.xml', slideXml(['<a:t>invalid number</a:t>']));
    zip.file('ppt/slides/slide3.xml', slideXml([]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    await expect(parsePptxOutline(bytes)).resolves.toEqual({
      slides: [{ slideNumber: 3, lines: [] }],
      textCharacters: 0,
    });
  });
});
