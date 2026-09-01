import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const MAX_LINES = 500;
const ROOTS = ['src', 'server', 'scripts'];
const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.py', '.ts', '.tsx']);

async function codeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return codeFiles(path);
      return CODE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
    }),
  );
  return nested.flat();
}

function physicalLines(source) {
  if (!source) return 0;
  const lines = source.split(/\r?\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

const files = (await Promise.all(ROOTS.map(codeFiles))).flat();
const results = await Promise.all(
  files.map(async (file) => ({
    file: relative(process.cwd(), file).replaceAll('\\', '/'),
    lines: physicalLines(await readFile(file, 'utf8')),
  })),
);
const violations = results.filter(({ lines }) => lines > MAX_LINES).sort((a, b) => b.lines - a.lines);

if (violations.length) {
  console.error(`Code files must not exceed ${MAX_LINES} physical lines:`);
  for (const { file, lines } of violations) console.error(`- ${file}: ${lines}`);
  process.exitCode = 1;
} else {
  const largest = results.sort((a, b) => b.lines - a.lines)[0];
  console.log(`Checked ${results.length} code files; largest is ${largest.file} at ${largest.lines} lines.`);
}
