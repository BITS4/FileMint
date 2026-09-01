import JSZip from 'jszip';

export interface PptxSlideOutline {
  slideNumber: number;
  lines: string[];
}

export interface PptxOutline {
  slides: PptxSlideOutline[];
  textCharacters: number;
}

export interface PptxOutlineLimits {
  maxArchiveBytes: number;
  maxSlides: number;
  maxSlideXmlBytes: number;
  maxTextCharacters: number;
}

export const DEFAULT_PPTX_OUTLINE_LIMITS: Readonly<PptxOutlineLimits> = Object.freeze({
  maxArchiveBytes: 50 * 1024 * 1024,
  maxSlides: 300,
  maxSlideXmlBytes: 2 * 1024 * 1024,
  maxTextCharacters: 500_000,
});

const SLIDE_PATH = /^ppt\/slides\/slide([1-9]\d*)\.xml$/i;
const XML_TEXT = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t\s*>/gi;
const XML_PARAGRAPH = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p\s*>/gi;

type ZipEntryWithSize = JSZip.JSZipObject & {
  _data?: { uncompressedSize?: number };
};

function validXmlCodePoint(value: number) {
  return (
    value === 0x09 ||
    value === 0x0a ||
    value === 0x0d ||
    (value >= 0x20 && value <= 0xd7ff) ||
    (value >= 0xe000 && value <= 0xfffd) ||
    (value >= 0x10000 && value <= 0x10ffff)
  );
}

function decodeXmlEntities(value: string) {
  return value.replace(/&(?:#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (entity) => {
    const normalized = entity.toLowerCase();
    if (normalized === '&amp;') return '&';
    if (normalized === '&apos;') return "'";
    if (normalized === '&gt;') return '>';
    if (normalized === '&lt;') return '<';
    if (normalized === '&quot;') return '"';

    const hex = normalized.startsWith('&#x');
    const value = Number.parseInt(normalized.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return validXmlCodePoint(value) ? String.fromCodePoint(value) : '\uFFFD';
  });
}

function extractRuns(xml: string) {
  return [...xml.matchAll(XML_TEXT)]
    .map((match) => decodeXmlEntities(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function extractPptxSlideLines(xml: string) {
  const paragraphs = [...xml.matchAll(XML_PARAGRAPH)];
  if (!paragraphs.length) return extractRuns(xml);

  return paragraphs.map((paragraph) => extractRuns(paragraph[1]).join(' ').trim()).filter(Boolean);
}

function mergeLimits(overrides?: Partial<PptxOutlineLimits>): PptxOutlineLimits {
  const merged = { ...DEFAULT_PPTX_OUTLINE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Invalid PowerPoint preview limit: ${name}.`);
    }
  }
  return merged;
}

function listedSlideEntries(zip: JSZip, maxSlides: number) {
  const entries = Object.values(zip.files)
    .map((entry) => {
      const match = SLIDE_PATH.exec(entry.name);
      return match && !entry.dir ? { entry, slideNumber: Number(match[1]) } : undefined;
    })
    .filter((item): item is { entry: JSZip.JSZipObject; slideNumber: number } => Boolean(item))
    .sort((a, b) => a.slideNumber - b.slideNumber);

  if (!entries.length) throw new Error('This file does not contain any PowerPoint slides.');
  if (entries.length > maxSlides) {
    throw new Error(`This presentation exceeds the ${maxSlides}-slide preview limit.`);
  }
  return entries;
}

async function readSlideXml(entry: JSZip.JSZipObject, maxBytes: number) {
  const declaredSize = (entry as ZipEntryWithSize)._data?.uncompressedSize;
  if (typeof declaredSize === 'number' && declaredSize > maxBytes) {
    throw new Error(`Slide ${entry.name} exceeds the local preview size limit.`);
  }

  const bytes = await entry.async('uint8array');
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Slide ${entry.name} exceeds the local preview size limit.`);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Slide ${entry.name} contains invalid XML text.`);
  }
}

export async function parsePptxOutline(
  bytes: Uint8Array,
  overrides?: Partial<PptxOutlineLimits>,
): Promise<PptxOutline> {
  const limits = mergeLimits(overrides);
  if (!bytes.byteLength) throw new Error('The PowerPoint file is empty.');
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new Error(`This presentation exceeds the ${limits.maxArchiveBytes}-byte local preview limit.`);
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('The PowerPoint file is not a readable PPTX archive.');
  }

  const slides: PptxSlideOutline[] = [];
  let textCharacters = 0;
  for (const { entry, slideNumber } of listedSlideEntries(zip, limits.maxSlides)) {
    const xml = await readSlideXml(entry, limits.maxSlideXmlBytes);
    const lines = extractPptxSlideLines(xml);
    textCharacters += lines.reduce((total, line) => total + line.length, 0);
    if (textCharacters > limits.maxTextCharacters) {
      throw new Error('This presentation contains too much text for a safe local preview.');
    }
    slides.push({ slideNumber, lines });
  }

  return { slides, textCharacters };
}
