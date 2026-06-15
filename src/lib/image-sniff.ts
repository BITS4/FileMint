/** Detect image type from magic bytes (independent of file extension/mime). */
export type ImageSig = 'jpg' | 'png' | 'webp' | 'gif' | 'bmp' | 'tiff' | 'heic' | 'avif' | 'svg' | 'unknown';

function ascii(b: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < Math.min(end, b.length); i++) out += String.fromCharCode(b[i]);
  return out;
}

export function sniffImageType(b: Uint8Array): ImageSig {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  )
    return 'webp';
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (
    b.length >= 4 &&
    ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a))
  )
    return 'tiff';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12).toLowerCase();
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  const head = ascii(b, 0, 256).trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml') && head.includes('<svg')) return 'svg';
  return 'unknown';
}

export function imageMime(sig: ImageSig, ext = ''): string {
  if (sig === 'jpg') return 'image/jpeg';
  if (sig === 'png') return 'image/png';
  if (sig === 'webp') return 'image/webp';
  if (sig === 'gif') return 'image/gif';
  if (sig === 'bmp') return 'image/bmp';
  if (sig === 'tiff') return 'image/tiff';
  if (sig === 'heic') return 'image/heic';
  if (sig === 'avif') return 'image/avif';
  if (sig === 'svg') return 'image/svg+xml';

  const e = ext.toLowerCase().replace(/^\./, '');
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (['png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif'].includes(e)) return `image/${e === 'tif' ? 'tiff' : e}`;
  if (e === 'svg' || e === 'svgz') return 'image/svg+xml';
  return 'application/octet-stream';
}
