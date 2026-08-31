/**
 * Web: render Office documents in their native form (not as PDF).
 *  - Word  -> docx-preview (faithful page layout)
 *  - Excel -> read-excel-file with safe DOM rendering and sheet tabs
 *  - PPT   -> pptx-preview (stacked slides)
 */
import { renderAsync } from 'docx-preview';
import * as pdfjsLib from 'pdfjs-dist';
import { init as initPptx } from 'pptx-preview';
import readExcelFile from 'read-excel-file/browser';
import { useEffect, useRef, useState } from 'react';

import { convertFile } from '@/lib/api';
import * as storage from '@/lib/storage';
import type { FileItem } from '@/types';

export interface OfficeViewProps {
  file: FileItem;
  night?: boolean;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

async function renderXlsx(bytes: Uint8Array, container: HTMLElement) {
  const sheets = await readExcelFile(toArrayBuffer(bytes));
  const names = sheets.map(({ sheet }) => sheet);

  const wrap = document.createElement('div');
  wrap.style.cssText =
    'display:flex;flex-direction:column;height:100%;font-family:system-ui,sans-serif;background:#fff;';

  const tabs = document.createElement('div');
  tabs.style.cssText =
    'display:flex;gap:6px;padding:8px;overflow-x:auto;border-bottom:1px solid #e2e2e2;background:#f5f5f5;flex:0 0 auto;';

  const tableWrap = document.createElement('div');
  tableWrap.style.cssText = 'flex:1 1 auto;overflow:auto;';

  const showSheet = (name: string) => {
    const selected = sheets.find(({ sheet }) => sheet === name);
    tableWrap.replaceChildren();

    const table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse;font-size:13px;color:#111;min-width:100%;';
    selected?.data.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      row.forEach((value) => {
        const cell = document.createElement(rowIndex === 0 ? 'th' : 'td');
        cell.textContent = value instanceof Date ? value.toLocaleDateString() : String(value ?? '');
        cell.style.cssText = [
          'border:1px solid #e0e0e0',
          'padding:4px 8px',
          'white-space:nowrap',
          rowIndex === 0 ? 'background:#f5f5f5;text-align:left;font-weight:700' : '',
        ].join(';');
        tr.appendChild(cell);
      });
      table.appendChild(tr);
    });
    tableWrap.appendChild(table);

    Array.from(tabs.children).forEach((btn, i) => {
      const active = names[i] === name;
      (btn as HTMLElement).style.background = active ? '#fff' : 'transparent';
      (btn as HTMLElement).style.fontWeight = active ? '700' : '400';
    });
  };

  names.forEach((name) => {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.style.cssText =
      'border:1px solid #ddd;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;color:#111;';
    btn.onclick = () => showSheet(name);
    tabs.appendChild(btn);
  });

  wrap.appendChild(tabs);
  wrap.appendChild(tableWrap);
  container.appendChild(wrap);
  if (names.length) showSheet(names[0]);
}

function fitDocxPages(container: HTMLElement) {
  const wrapper = container.querySelector('.docx-wrapper') as HTMLElement | null;
  if (!wrapper) return;

  const mobile = container.clientWidth < 720;
  const available = Math.max(260, container.clientWidth - (mobile ? 18 : 56));
  wrapper.style.width = '100%';
  wrapper.style.minWidth = '0';
  wrapper.style.boxSizing = 'border-box';
  wrapper.style.overflow = 'visible';
  wrapper.style.padding = mobile ? '12px 0 20px' : '30px 0';
  wrapper.style.alignItems = 'center';

  container.querySelectorAll('section.docx').forEach((node) => {
    const page = node as HTMLElement;
    page.style.setProperty('zoom', '1');
    const pageWidth = page.offsetWidth || page.getBoundingClientRect().width || 1;
    const scale = Math.min(1, Math.max(0.34, available / pageWidth));
    page.style.setProperty('zoom', scale.toFixed(4));
    page.style.marginBottom = `${Math.max(12, Math.round(30 * scale))}px`;
    page.style.boxShadow = mobile ? '0 5px 18px rgba(0,0,0,.24)' : '0 0 10px rgba(0,0,0,.5)';
  });
}

function hasLargePageImage(page: HTMLElement) {
  const pageRect = page.getBoundingClientRect();
  const pageWidth = pageRect.width || page.offsetWidth || 1;
  const pageHeight = pageRect.height || page.offsetHeight || 1;
  const minWidth = Math.max(180, pageWidth * 0.55);
  const minHeight = Math.max(240, pageHeight * 0.35);

  return Array.from(page.querySelectorAll('img')).some((image) => {
    const rect = image.getBoundingClientRect();
    const width = rect.width || image.naturalWidth || image.width;
    const height = rect.height || image.naturalHeight || image.height;
    return width >= minWidth && height >= minHeight;
  });
}

function suppressHiddenOcrPreviewLayer(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('section.docx').forEach((page) => {
    if (!hasLargePageImage(page)) return;

    page.querySelectorAll<SVGElement>('svg').forEach((svg) => {
      if (!svg.querySelector('foreignObject, text')) return;
      svg.setAttribute('data-filemint-hidden-ocr-preview', 'true');
      svg.style.display = 'none';
      svg.style.visibility = 'hidden';
      svg.setAttribute('aria-hidden', 'true');
    });
  });
}

function refineDocxPreview(container: HTMLElement, hideHiddenOcrPreviewLayer: boolean) {
  fitDocxPages(container);
  if (hideHiddenOcrPreviewLayer) suppressHiddenOcrPreviewLayer(container);
}

function needsServerPdfWordPreview(file: FileItem) {
  const report = file.conversionReport;
  if (!report || file.kind !== 'word') return false;
  const mode = `${report.resolvedMode ?? report.requestedMode ?? ''}`.toLowerCase();
  return (
    mode.includes('ocr-editable-visual') ||
    mode.includes('exact-ocr-visual') ||
    Boolean(report.hiddenTextLayer) ||
    Number(report.visualFragmentsPreserved ?? 0) > 0 ||
    Number(report.rulesRebuiltAsWord ?? 0) > 0
  );
}

function docxPreviewLooksBlank(container: HTMLElement) {
  const text = (container.textContent ?? '').replace(/\s+/g, '').trim();
  const visualCount = container.querySelectorAll('img, svg, canvas, table').length;
  return text.length === 0 && visualCount === 0;
}

async function renderPdfBytes(bytes: Uint8Array, container: HTMLElement, night = false) {
  const pdf = await pdfjsLib.getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
  }).promise;

  const width = Math.max(320, container.clientWidth || 960);
  const pageMaxWidth = Math.max(260, width - (width < 720 ? 20 : 56));
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'min-height:100%',
    'box-sizing:border-box',
    `padding:${width < 720 ? '10px 0 18px' : '22px 0 32px'}`,
    `background:${night ? '#111827' : '#525659'}`,
  ].join(';');

  container.innerHTML = '';
  container.appendChild(wrap);

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.35, pageMaxWidth / baseViewport.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * dpr });
      const cssWidth = Math.round(baseViewport.width * scale);
      const cssHeight = Math.round(baseViewport.height * scale);

      const pageShell = document.createElement('div');
      pageShell.style.cssText = [
        'background:#fff',
        'border-radius:4px',
        'box-shadow:0 8px 28px rgba(0,0,0,.25)',
        'overflow:hidden',
        `width:${cssWidth}px`,
        `height:${cssHeight}px`,
        `margin:0 auto ${width < 720 ? 12 : 18}px`,
      ].join(';');

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.cssText = `display:block;width:${cssWidth}px;height:${cssHeight}px;background:#fff;filter:${night ? 'invert(0.92) hue-rotate(180deg)' : 'none'}`;
      pageShell.appendChild(canvas);
      wrap.appendChild(pageShell);

      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas rendering is not available in this browser.');
      await page.render({ canvasContext: context, viewport, canvas } as never).promise;
    }
  } finally {
    await pdf.cleanup();
  }
}

async function renderServerPdfWordPreview(file: FileItem, container: HTMLElement, night = false) {
  const uri = await storage.getUri(file.storageKey);
  const res = await convertFile({
    endpoint: 'convert',
    fileUri: uri,
    fileName: file.name,
    mime: file.mime,
    fields: { target: 'pdf' },
  });
  await renderPdfBytes(res.bytes, container, night);
}

export function OfficeView({ file, night }: OfficeViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const container = ref.current;
    setError(undefined);
    setStatus(undefined);
    (async () => {
      try {
        const bytes = await storage.readBytes(file.storageKey);
        if (!alive || !container) return;
        container.innerHTML = '';
        if (file.kind === 'word') {
          if (needsServerPdfWordPreview(file)) {
            setStatus('Preparing Word preview...');
            await renderServerPdfWordPreview(file, container, night);
            if (alive) setStatus(undefined);
            return;
          }
          await renderAsync(toArrayBuffer(bytes), container, undefined, {
            className: 'docx',
            inWrapper: true,
            breakPages: true,
          });
          refineDocxPreview(container, Boolean(file.conversionReport?.hiddenTextLayer));
          if (file.source === 'convert' && docxPreviewLooksBlank(container)) {
            setStatus('Preparing Word preview...');
            await renderServerPdfWordPreview(file, container, night);
            if (alive) setStatus(undefined);
          }
        } else if (file.kind === 'excel') {
          await renderXlsx(bytes, container);
        } else if (file.kind === 'ppt') {
          const width = container.clientWidth || 960;
          const previewer = initPptx(container, {
            width,
            height: Math.round((width * 9) / 16),
            mode: 'list',
          });
          previewer.preview(toArrayBuffer(bytes));
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not render this document.');
      } finally {
        if (alive) setStatus(undefined);
      }
    })();
    return () => {
      alive = false;
    };
  }, [file.storageKey, file.kind, file.modifiedAt, file.size, night]);

  useEffect(() => {
    const container = ref.current;
    if (!container || file.kind !== 'word') return undefined;
    const fit = () => refineDocxPreview(container, Boolean(file.conversionReport?.hiddenTextLayer));
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    const id = window.setTimeout(fit, 50);
    return () => {
      window.clearTimeout(id);
      observer.disconnect();
    };
  }, [file.kind, file.storageKey, file.modifiedAt, file.size]);

  if (error) {
    return (
      <div style={{ padding: 24, color: '#FF5C5C', fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>
        {error}
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        boxSizing: 'border-box',
        background: file.kind === 'excel' ? '#fff' : '#525659',
      }}
    >
      <div
        ref={ref}
        style={{
          height: '100%',
          width: '100%',
          overflow: 'auto',
          boxSizing: 'border-box',
          background: file.kind === 'excel' ? '#fff' : '#525659',
          padding: file.kind === 'excel' ? 0 : 0,
        }}
      />
      {status ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#EAF0F6',
            background: 'rgba(17,24,39,.72)',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
            pointerEvents: 'none',
          }}
        >
          {status}
        </div>
      ) : null}
    </div>
  );
}
