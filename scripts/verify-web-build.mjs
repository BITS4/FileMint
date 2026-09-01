import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const required = [
  'index.html',
  'manifest.json',
  'register-sw.js',
  'sw.js',
  'icon-1024.png',
  'pdf.worker.min.mjs',
];

await Promise.all(required.map((file) => access(join(dist, file))));

const html = await readFile(join(dist, 'index.html'), 'utf8');
if (!html.includes('rel="manifest"') || !html.includes('/register-sw.js')) {
  throw new Error('The production web export is missing PWA bootstrap metadata.');
}

const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
if (manifest.display !== 'standalone' || !Array.isArray(manifest.icons) || manifest.icons.length === 0) {
  throw new Error('The production PWA manifest is incomplete.');
}

const icon = await readFile(join(dist, 'icon-1024.png'));
if (icon.readUInt32BE(16) !== 1024 || icon.readUInt32BE(20) !== 1024) {
  throw new Error('The install icon must be a real 1024x1024 PNG.');
}

for (const file of ['register-sw.js', 'sw.js']) {
  const checked = spawnSync(process.execPath, ['--check', join(dist, file)], { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(checked.stderr || `${file} is not valid JavaScript.`);
}

console.log(`Verified ${required.length} production web and offline assets.`);
