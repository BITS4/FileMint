/**
 * Client for the FileMint conversion server (see /server). The server shells
 * out to LibreOffice / qpdf / Ghostscript / OCR when available and advertises
 * what it can do via /health, so the UI can show honest availability.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { base64ToBytes } from '@/lib/base64';
import { decodeUtf8 } from '@/lib/text';
import { useSettings } from '@/store/useSettings';
import type { ConversionReport } from '@/types';

export interface ServerCapabilities {
  libreoffice: boolean;
  qpdf: boolean;
  ghostscript: boolean;
  pdfRepair: boolean;
  ocr: boolean;
  pdf2docx: boolean;
  pdfExport: boolean;
  imageNormalize: boolean;
  pdfUtility: boolean;
  pdfEdit: boolean;
  collabora: boolean;
}

export interface ServerStatus {
  online: boolean;
  version?: string;
  capabilities: ServerCapabilities;
}

const OFFLINE: ServerStatus = {
  online: false,
  capabilities: { libreoffice: false, qpdf: false, ghostscript: false, pdfRepair: false, ocr: false, pdf2docx: false, pdfExport: false, imageNormalize: false, pdfUtility: false, pdfEdit: false, collabora: false },
};

function baseUrl(): string {
  return useSettings.getState().serverUrl.replace(/\/+$/, '');
}

export function getServerBaseUrl(): string {
  return baseUrl();
}

function isLocalServerUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function browserLanCandidates(): string[] {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return [];
  const { hostname, protocol } = window.location;
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return [];
  const scheme = protocol === 'https:' ? 'https:' : 'http:';
  return ['8788', '8787'].map((port) => `${scheme}//${hostname}:${port}`);
}

function hostFromDevUri(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.includes('://') ? value.trim() : `http://${value.trim()}`;
  try {
    const { hostname } = new URL(normalized);
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return undefined;
    return hostname;
  } catch {
    return undefined;
  }
}

function nativeLanCandidates(): string[] {
  if (Platform.OS === 'web') return [];
  const constants = Constants as typeof Constants & {
    manifest?: { debuggerHost?: string };
    expoGoConfig?: { debuggerHost?: string } | null;
  };
  const hosts = [
    hostFromDevUri(Constants.expoConfig?.hostUri),
    hostFromDevUri(constants.expoGoConfig?.debuggerHost),
    hostFromDevUri(constants.manifest?.debuggerHost),
    hostFromDevUri(Constants.experienceUrl),
    Platform.OS === 'android' ? '10.0.2.2' : undefined,
  ].filter((host): host is string => !!host);

  return [...new Set(hosts)].flatMap((host) => ['8788', '8787'].map((port) => `http://${host}:${port}`));
}

function localServerCandidates(): string[] {
  const configured = baseUrl();
  const nativeCandidates = nativeLanCandidates();
  const candidates = isLocalServerUrl(configured) && Platform.OS !== 'web'
    ? [...nativeCandidates, configured]
    : [configured, ...browserLanCandidates(), ...nativeCandidates];
  if (isLocalServerUrl(configured)) {
    try {
      const url = new URL(configured);
      for (const port of ['8788', '8787']) {
        candidates.push(`${url.protocol}//${url.hostname}:${port}`);
      }
    } catch {
      // keep the configured URL only
    }
  }
  return [...new Set(candidates.map((u) => u.replace(/\/+$/, '')))];
}

function capabilityScore(capabilities: ServerCapabilities): number {
  return Object.values(capabilities).filter(Boolean).length;
}

async function readServerStatusAt(url: string, timeoutMs: number): Promise<ServerStatus> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return OFFLINE;
    const data = (await res.json()) as Partial<ServerStatus>;
    return {
      online: true,
      version: data.version,
      capabilities: { ...OFFLINE.capabilities, ...(data.capabilities ?? {}) },
    };
  } catch {
    return OFFLINE;
  }
}

async function resolveServerUrl(requiredCapability?: keyof ServerCapabilities, timeoutMs = 1500): Promise<string> {
  const configured = baseUrl();
  let best: { url: string; status: ServerStatus } | null = null;

  for (const url of localServerCandidates()) {
    const status = await readServerStatusAt(url, timeoutMs);
    if (!status.online) continue;
    if (requiredCapability && !status.capabilities[requiredCapability]) continue;
    if (!best || capabilityScore(status.capabilities) > capabilityScore(best.status.capabilities)) {
      best = { url, status };
    }
  }

  if (best && best.url !== configured) {
    useSettings.getState().update({ serverUrl: best.url });
  }
  return best?.url ?? configured;
}

export async function checkServer(timeoutMs = 4000): Promise<ServerStatus> {
  let best: { url: string; status: ServerStatus } | null = null;
  for (const url of localServerCandidates()) {
    const status = await readServerStatusAt(url, timeoutMs);
    if (!status.online) continue;
    if (!best || capabilityScore(status.capabilities) > capabilityScore(best.status.capabilities)) {
      best = { url, status };
    }
  }
  if (!best) return OFFLINE;
  if (best.url !== baseUrl()) {
    useSettings.getState().update({ serverUrl: best.url });
  }
  return best.status;
}

export interface ConvertResult {
  bytes: Uint8Array;
  filename: string;
  mime: string;
  report?: ConversionReport;
}

export interface ConvertRequest {
  /** Server path after the origin, e.g. "convert" or "secure/lock". */
  endpoint: string;
  fileUri: string;
  fileName: string;
  mime?: string;
  fields?: Record<string, string | number | boolean>;
}

function parseFilename(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : fallback;
}

function parseReport(header: string | null): ConversionReport | undefined {
  if (!header) return undefined;
  try {
    const b64 = header.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
    return JSON.parse(decodeUtf8(base64ToBytes(padded))) as ConversionReport;
  } catch {
    return undefined;
  }
}

async function buildForm(req: ConvertRequest): Promise<FormData> {
  const form = new FormData();

  if (Platform.OS === 'web') {
    const blob = await (await fetch(req.fileUri)).blob();
    form.append('file', blob, req.fileName);
  } else {
    // React Native multipart file part.
    form.append('file', {
      uri: req.fileUri,
      name: req.fileName,
      type: req.mime ?? 'application/octet-stream',
    } as unknown as Blob);
  }

  for (const [key, value] of Object.entries(req.fields ?? {})) {
    form.append(key, String(value));
  }
  return form;
}

function capabilityForRequest(endpoint: string, fields?: Record<string, string | number | boolean>): keyof ServerCapabilities | undefined {
  const normalized = endpoint.replace(/^\/+/, '');
  if (normalized === 'image/normalize') return 'imageNormalize';
  if (normalized === 'pdf/render' || normalized === 'pdf/text') return 'pdfUtility';
  if (normalized === 'edit/redact') return 'pdfEdit';
  if (normalized === 'ocr') return 'ocr';
  if (normalized.startsWith('secure/')) return 'qpdf';
  if (normalized === 'repair') return 'pdfRepair';
  if (normalized === 'convert') {
    const target = String(fields?.target ?? '').toLowerCase();
    if (target === 'docx') return 'pdf2docx';
    if (target === 'xlsx' || target === 'pptx' || target === 'html') return 'pdfExport';
    if (target === 'pdf') return 'libreoffice';
  }
  return undefined;
}

async function parseError(res: Response, endpoint: string, url: string): Promise<string> {
  let message = `Server error (${res.status})`;
  let bodyText = '';
  try {
    bodyText = await res.text();
    const json = JSON.parse(bodyText);
    message = json.error ?? json.message ?? bodyText ?? message;
  } catch {
    if (bodyText.trim()) message = bodyText.trim().slice(0, 500);
  }
  if (res.status === 404) {
    message = `Server endpoint "/${endpoint}" was not found at ${url}. This usually means an old FileMint server is still running or Settings points to the wrong port. Stop the old server, run "npm run server" again, then use the URL printed by the server.`;
  }
  return message;
}

export async function convertFile(req: ConvertRequest): Promise<ConvertResult> {
  const endpoint = req.endpoint.replace(/^\/+/, '');
  const requiredCapability = capabilityForRequest(endpoint, req.fields);
  const resolvedUrl = await resolveServerUrl(requiredCapability);
  const candidates = [...new Set([resolvedUrl, ...localServerCandidates()])];
  let lastError = `Can't reach the conversion server at ${baseUrl()}. Start it with "npm run server", then set the address in Settings.`;

  let res: Response;
  for (const url of candidates) {
    try {
      res = await fetch(`${url}/${endpoint}`, {
        method: 'POST',
        body: await buildForm(req),
      });
    } catch {
      lastError = `Can't reach the conversion server at ${url}. Start it with "npm run server", then set the address in Settings.`;
      continue;
    }

    if (!res.ok) {
      lastError = await parseError(res, endpoint, url);
      if (res.status === 404) continue;
      throw new Error(lastError);
    }

    if (url !== baseUrl()) {
      useSettings.getState().update({ serverUrl: url });
    }

    const buffer = await res.arrayBuffer();
    const mime = res.headers.get('content-type') ?? 'application/octet-stream';
    const filename = parseFilename(res.headers.get('content-disposition'), 'result');
    const report = parseReport(res.headers.get('x-filemint-report'));
    return { bytes: new Uint8Array(buffer), filename, mime, report };
  }

  throw new Error(lastError);
}

// ----------------------------------------------------- Collabora editing (WOPI)
async function appendFilePart(form: FormData, fileUri: string, fileName: string, mime?: string) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(fileUri)).blob();
    form.append('file', blob, fileName);
  } else {
    form.append('file', { uri: fileUri, name: fileName, type: mime ?? 'application/octet-stream' } as unknown as Blob);
  }
}

export interface EditSession {
  id: string;
  token: string;
  fileName: string;
}

export async function uploadForEdit(fileUri: string, fileName: string, mime: string | undefined, origin: string): Promise<EditSession> {
  const form = new FormData();
  await appendFilePart(form, fileUri, fileName, mime);
  form.append('origin', origin);
  const serverUrl = await resolveServerUrl('collabora');
  let res: Response;
  try {
    res = await fetch(`${serverUrl}/edit/upload`, { method: 'POST', body: form });
  } catch {
    throw new Error(`Can't reach the conversion server at ${serverUrl}. Start it with "npm run server".`);
  }
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
  if (serverUrl !== baseUrl()) {
    useSettings.getState().update({ serverUrl });
  }
  return (await res.json()) as EditSession;
}

export async function getEditorUrl(id: string, token: string): Promise<string> {
  const res = await fetch(`${baseUrl()}/edit/url/${id}?access_token=${encodeURIComponent(token)}`);
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? 'The editor (Collabora) is unavailable. Is it running in Docker?');
  return data.url;
}

export async function getEditVersion(id: string, token: string): Promise<number> {
  try {
    const res = await fetch(`${baseUrl()}/edit/status/${id}?access_token=${encodeURIComponent(token)}`);
    if (!res.ok) return 0;
    return ((await res.json()) as { version?: number }).version ?? 0;
  } catch {
    return 0;
  }
}

export async function downloadEdited(id: string, token: string): Promise<Uint8Array> {
  const res = await fetch(`${baseUrl()}/edit/download/${id}?access_token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error('Could not download the edited file.');
  return new Uint8Array(await res.arrayBuffer());
}

export async function closeEdit(id: string, token: string): Promise<void> {
  await fetch(`${baseUrl()}/edit/close/${id}?access_token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
}
