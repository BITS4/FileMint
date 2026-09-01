import { parsePptxOutline, type PptxOutline } from './pptx-outline';

export type PptxPreviewMode = 'converted-pdf' | 'local-outline';

export interface PptxPreviewOptions {
  bytes: Uint8Array;
  container: HTMLElement;
  renderConvertedPdf: () => Promise<void>;
  parseOutline?: (bytes: Uint8Array) => Promise<PptxOutline>;
}

function createTextElement(tag: 'div' | 'h2' | 'li' | 'ol' | 'p', text?: string) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

export function renderPptxOutline(outline: PptxOutline, container: HTMLElement) {
  const shell = createTextElement('div');
  shell.setAttribute('data-filemint-pptx-outline', 'true');
  shell.style.cssText =
    'min-height:100%;box-sizing:border-box;padding:24px;background:#f4f5f7;color:#18212b;font-family:system-ui,sans-serif;';

  const notice = createTextElement(
    'p',
    'Text-only local preview. Connect the conversion server for full slide layout and graphics.',
  );
  notice.setAttribute('role', 'status');
  notice.style.cssText =
    'max-width:900px;margin:0 auto 16px;padding:12px 14px;border:1px solid #c9d3df;border-radius:8px;background:#fff;font-size:13px;';
  shell.appendChild(notice);

  for (const slide of outline.slides) {
    const card = createTextElement('div');
    card.style.cssText =
      'max-width:900px;margin:0 auto 16px;padding:20px;border-radius:10px;background:#fff;box-shadow:0 3px 14px rgba(24,33,43,.12);';

    const heading = createTextElement('h2', `Slide ${slide.slideNumber}`);
    heading.style.cssText = 'margin:0 0 12px;font-size:18px;';
    card.appendChild(heading);

    if (slide.lines.length) {
      const list = createTextElement('ol');
      list.style.cssText = 'margin:0;padding-left:24px;line-height:1.55;white-space:pre-wrap;';
      for (const line of slide.lines) list.appendChild(createTextElement('li', line));
      card.appendChild(list);
    } else {
      const empty = createTextElement('p', 'No readable text on this slide.');
      empty.style.cssText = 'margin:0;color:#647181;font-style:italic;';
      card.appendChild(empty);
    }
    shell.appendChild(card);
  }

  container.replaceChildren(shell);
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : 'unknown error';
}

export async function renderPptxPreview(options: PptxPreviewOptions): Promise<PptxPreviewMode> {
  try {
    await options.renderConvertedPdf();
    return 'converted-pdf';
  } catch (conversionError) {
    try {
      const outline = await (options.parseOutline ?? parsePptxOutline)(options.bytes);
      renderPptxOutline(outline, options.container);
      return 'local-outline';
    } catch (outlineError) {
      throw new Error(
        `PowerPoint preview failed. Server conversion: ${errorMessage(conversionError)}. Local outline: ${errorMessage(outlineError)}.`,
      );
    }
  }
}
