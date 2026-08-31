import * as pdfjsLib from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';

import * as storage from '@/lib/storage';

export interface PdfViewProps {
  storageKey: string;
  night?: boolean;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

type LoadState =
  | { kind: 'loading'; label: string }
  | { kind: 'ready'; label?: string }
  | { kind: 'native'; label: string }
  | { kind: 'error'; message: string };

function clonePdfBytes(bytes: Uint8Array) {
  return bytes.slice();
}

function isPdf(bytes: Uint8Array) {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/** Web PDF rendering via PDF.js. Mobile browsers often refuse inline PDF iframes. */
export function PdfView({ storageKey, night }: PdfViewProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: 'loading', label: 'Loading PDF...' });

  useEffect(() => {
    let alive = true;
    setBytes(null);
    setUri(null);
    setState({ kind: 'loading', label: 'Loading PDF...' });
    (async () => {
      try {
        const [data, fileUri] = await Promise.all([
          storage.readBytes(storageKey),
          storage.getUri(storageKey),
        ]);
        if (!alive) return;
        if (!isPdf(data)) {
          setState({
            kind: 'error',
            message: 'This saved file is not a valid PDF. Convert it again with the latest FileMint server.',
          });
          return;
        }
        setBytes(data);
        setUri(fileUri);
      } catch (e) {
        if (alive)
          setState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load this PDF.' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [storageKey]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;
    const update = () => {
      const next = Math.floor(shell.clientWidth || 0);
      setWidth((prev) => {
        if (next < 120) return prev;
        if (prev === 0 || Math.abs(prev - next) > 32) return next;
        return prev;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = pagesRef.current;
    if (!bytes || !target || width < 120 || state.kind === 'native') return undefined;

    let cancelled = false;
    let task: pdfjsLib.PDFDocumentLoadingTask | undefined;
    let renderedAnyPage = false;
    target.innerHTML = '';
    setState({ kind: 'loading', label: 'Rendering PDF...' });
    const fallbackTimer = window.setTimeout(() => {
      if (cancelled || renderedAnyPage) return;
      cancelled = true;
      target.innerHTML = '';
      void task?.destroy();
      setState({ kind: 'native', label: 'Using browser PDF preview...' });
    }, 7000);

    (async () => {
      try {
        task = pdfjsLib.getDocument({
          data: clonePdfBytes(bytes),
          useWorkerFetch: false,
          isOffscreenCanvasSupported: false,
        });
        const pdf = await task.promise;
        const pageCount = pdf.numPages;
        const gap = width < 720 ? 12 : 18;
        const pageMaxWidth = Math.max(160, width - (width < 720 ? 20 : 44));

        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
          if (cancelled) break;
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
            'box-shadow:0 8px 28px rgba(0,0,0,.22)',
            'overflow:hidden',
            `width:${cssWidth}px`,
            `height:${cssHeight}px`,
            `margin:0 auto ${gap}px`,
          ].join(';');

          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.cssText = `display:block;width:${cssWidth}px;height:${cssHeight}px;background:#fff`;
          pageShell.appendChild(canvas);
          target.appendChild(pageShell);

          const context = canvas.getContext('2d', { alpha: false });
          if (!context) throw new Error('Canvas rendering is not available in this browser.');
          await page.render({ canvasContext: context, viewport, canvas } as never).promise;
          renderedAnyPage = true;
          if (pageNumber === 1)
            setState({ kind: 'ready', label: `Rendering ${pageCount} page${pageCount === 1 ? '' : 's'}...` });
          else setState({ kind: 'ready', label: `Rendered ${pageNumber} of ${pageCount} pages` });
        }

        await pdf.cleanup();
        if (!cancelled) setState({ kind: 'ready' });
      } catch (e) {
        if (!cancelled) {
          target.innerHTML = '';
          setState(
            uri
              ? { kind: 'native', label: 'Using browser PDF preview...' }
              : { kind: 'error', message: e instanceof Error ? e.message : 'Could not render this PDF.' },
          );
        }
      } finally {
        window.clearTimeout(fallbackTimer);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      task?.destroy();
    };
  }, [bytes, uri, width]);

  const nativeSrc = uri ? `${uri}#toolbar=0&navpanes=0&scrollbar=1` : undefined;

  return (
    <div
      ref={shellRef}
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        overflow: 'auto',
        background: night ? '#111827' : '#2C3138',
        boxSizing: 'border-box',
      }}
    >
      <div
        ref={pagesRef}
        style={{
          minHeight: '100%',
          padding: width < 720 ? '10px 0 18px' : '18px 0 28px',
          boxSizing: 'border-box',
          filter: night ? 'invert(0.92) hue-rotate(180deg)' : 'none',
        }}
      />
      {state.kind === 'native' && nativeSrc ? (
        <iframe
          title="PDF preview"
          src={nativeSrc}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 0,
            background: night ? '#111827' : '#2C3138',
          }}
        />
      ) : null}
      {state.kind === 'loading' || state.kind === 'error' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            pointerEvents: 'none',
            color: state.kind === 'error' ? '#FF7A7A' : '#EAF0F6',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
            textAlign: 'center',
          }}
        >
          {state.kind === 'error' ? state.message : state.label}
        </div>
      ) : null}
      {state.kind === 'native' ? (
        <div
          style={{
            position: 'absolute',
            left: 14,
            bottom: 14,
            borderRadius: 999,
            padding: '7px 11px',
            background: 'rgba(8,12,18,.72)',
            color: '#EAF0F6',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          {state.label}
        </div>
      ) : null}
    </div>
  );
}
