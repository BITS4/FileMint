import { readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { makeWorkdir, run, saveUpload } from './conversion-files';

const workdirs: string[] = [];

afterEach(async () => {
  await Promise.all(workdirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('conversion process and upload utilities', () => {
  it('captures child-process output and exit codes', async () => {
    await expect(run(process.execPath, ['-e', 'process.stdout.write("ready")'])).resolves.toMatchObject({
      code: 0,
      stdout: 'ready',
      stderr: '',
    });
    await expect(
      run(process.execPath, ['-e', 'process.stderr.write("failed"); process.exit(3)']),
    ).resolves.toMatchObject({ code: 3, stderr: 'failed' });
  });

  it('creates isolated work directories and sanitizes upload names', async () => {
    const dir = await makeWorkdir();
    workdirs.push(dir);
    const upload = await saveUpload(dir, new File(['document'], '../unsafe:name.txt'));

    expect(basename(upload.path)).toBe('unsafe_name.txt');
    expect(upload.path).toBe(join(dir, upload.name));
    await expect(readFile(upload.path, 'utf8')).resolves.toBe('document');
  });

  it('rejects missing multipart files with a clear error', async () => {
    const dir = await makeWorkdir();
    workdirs.push(dir);
    await expect(saveUpload(dir, undefined)).rejects.toThrow('No file uploaded');
  });
});
