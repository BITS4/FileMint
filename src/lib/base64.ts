/**
 * Dependency-free base64 <-> bytes helpers. React Native has no reliable global
 * btoa/atob or Buffer, and we need to round-trip binary PDF/image data through
 * expo-file-system (which speaks base64 strings).
 */
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < CHARS.length; i++) table[CHARS.charCodeAt(i)] = i;
  return table;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += CHARS[b0 >> 2];
    result += CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < len ? CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < len ? CHARS[b2 & 63] : '=';
  }
  return result;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = LOOKUP[clean.charCodeAt(i)];
    const c1 = LOOKUP[clean.charCodeAt(i + 1)];
    const c2 = LOOKUP[clean.charCodeAt(i + 2)];
    const c3 = LOOKUP[clean.charCodeAt(i + 3)];
    if (p < outLen) out[p++] = (c0 << 2) | (c1 >> 4);
    if (p < outLen) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (p < outLen) out[p++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

export function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
