import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import * as storage from '@/lib/storage';
import { decodeUtf8, parseCsvRows } from '@/lib/text';
import type { FileItem } from '@/types';

export interface TextDocumentViewProps {
  file: FileItem;
  night?: boolean;
}

const CODE_EXTS = new Set([
  'json',
  'xml',
  'yaml',
  'yml',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'scss',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'go',
  'rs',
  'php',
  'rb',
  'sh',
  'bat',
  'ps1',
  'sql',
  'log',
  'ini',
  'cfg',
  'conf',
]);

function isHtml(file: FileItem) {
  return file.ext === 'html' || file.ext === 'htm' || file.mime === 'text/html';
}

function isCode(file: FileItem) {
  return CODE_EXTS.has(file.ext);
}

function safeTitle(file: FileItem) {
  return file.ext ? file.ext.toUpperCase() : 'TEXT';
}

function renderCsvTable(rows: string[][]) {
  const hasHeader = rows.length > 1;
  const head = hasHeader ? rows[0] ?? [] : [];
  const body = hasHeader ? rows.slice(1) : rows;
  return (
    <div style={styles.tableShell}>
      <table style={styles.table}>
        {head.length ? (
          <thead>
            <tr>
              {head.map((cell, i) => (
                <th key={`${i}-${cell}`} style={styles.th}>
                  {cell || `Column ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {(body.length ? body : rows).map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={`${r}-${c}`} style={styles.td}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TextDocumentView({ file, night }: TextDocumentViewProps) {
  const [text, setText] = useState<string>('');
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setError(undefined);
    setText('');
    storage
      .readBytes(file.storageKey)
      .then((bytes) => {
        if (alive) setText(decodeUtf8(bytes));
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not read this file.');
      });
    return () => {
      alive = false;
    };
  }, [file.storageKey, file.modifiedAt, file.size]);

  const csvRows = useMemo(() => (file.kind === 'csv' ? parseCsvRows(text) : []), [file.kind, text]);
  const dark = Boolean(night);

  if (error) {
    return <div style={{ ...styles.center, color: '#FF6B6B' }}>{error}</div>;
  }

  if (isHtml(file)) {
    return (
      <div style={{ ...styles.root, background: dark ? '#111827' : '#525659' }}>
        <iframe
          title={file.name}
          sandbox=""
          srcDoc={text || '<!doctype html><html><body></body></html>'}
          style={{
            ...styles.htmlFrame,
            background: dark ? '#111827' : '#fff',
            filter: dark ? 'invert(0.92) hue-rotate(180deg)' : 'none',
          }}
        />
      </div>
    );
  }

  if (file.kind === 'csv') {
    return (
      <div style={{ ...styles.root, background: dark ? '#0B1117' : '#F3F6FA' }}>
        <div style={styles.documentHeader}>
          <strong>{file.name}</strong>
          <span>{csvRows.length} rows</span>
        </div>
        {csvRows.length ? renderCsvTable(csvRows) : <div style={styles.center}>Loading table...</div>}
      </div>
    );
  }

  return (
    <div style={{ ...styles.root, background: dark ? '#0B1117' : '#F3F6FA' }}>
      <div style={{ ...styles.textPage, background: dark ? '#111827' : '#fff', color: dark ? '#EAF0F6' : '#111827' }}>
        <div style={styles.documentHeader}>
          <strong>{file.name}</strong>
          <span>{safeTitle(file)}</span>
        </div>
        <pre style={{ ...styles.pre, fontFamily: isCode(file) ? 'ui-monospace, SFMono-Regular, Consolas, monospace' : 'system-ui, sans-serif' }}>
          {text || 'Loading...'}
        </pre>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    boxSizing: 'border-box',
    padding: '18px',
    fontFamily: 'system-ui, sans-serif',
  },
  center: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 14,
  },
  htmlFrame: {
    width: 'min(100%, 1120px)',
    minHeight: 'calc(100vh - 132px)',
    display: 'block',
    margin: '0 auto',
    border: 0,
    borderRadius: 8,
    boxShadow: '0 10px 30px rgba(0,0,0,.24)',
  },
  textPage: {
    width: 'min(100%, 1040px)',
    minHeight: 'calc(100vh - 132px)',
    margin: '0 auto',
    borderRadius: 8,
    boxShadow: '0 10px 30px rgba(0,0,0,.18)',
    overflow: 'hidden',
  },
  documentHeader: {
    display: 'flex',
    gap: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid rgba(148,163,184,.28)',
    color: 'inherit',
    fontSize: 13,
  },
  pre: {
    margin: 0,
    padding: 18,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 14,
    lineHeight: 1.65,
  },
  tableShell: {
    width: 'min(100%, 1120px)',
    margin: '0 auto',
    overflow: 'auto',
    background: '#fff',
    borderRadius: 8,
    boxShadow: '0 10px 30px rgba(0,0,0,.18)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    color: '#111827',
    fontSize: 13,
  },
  th: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: '#EAF0F6',
    border: '1px solid #CBD5E1',
    padding: '9px 10px',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  td: {
    border: '1px solid #E2E8F0',
    padding: '8px 10px',
    whiteSpace: 'pre-wrap',
    verticalAlign: 'top',
  },
};
