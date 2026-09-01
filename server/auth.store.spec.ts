import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  writeFile: vi.fn(),
}));

const observabilityMocks = vi.hoisted(() => ({
  logger: { error: vi.fn() },
  reportException: vi.fn(),
}));

vi.mock('node:fs/promises', () => fsMocks);
vi.mock('./observability', () => observabilityMocks);

async function loadStore() {
  return import('./auth.store');
}

describe('local auth database loading', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', '');
    for (const mock of Object.values(fsMocks)) mock.mockReset();
    observabilityMocks.logger.error.mockReset();
    observabilityMocks.reportException.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('initializes a new database only when the local file does not exist', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    fsMocks.readFile.mockRejectedValue(missing);
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeFile.mockResolvedValue(undefined);
    fsMocks.rename.mockResolvedValue(undefined);

    const { emptyDb, loadDb } = await loadStore();

    await expect(loadDb()).resolves.toEqual(emptyDb());
    expect(fsMocks.writeFile).toHaveBeenCalledOnce();
    expect(fsMocks.rename).toHaveBeenCalledOnce();
    expect(observabilityMocks.logger.error).not.toHaveBeenCalled();
    expect(observabilityMocks.reportException).not.toHaveBeenCalled();
  });

  it('reports corrupt JSON and leaves the existing database untouched', async () => {
    fsMocks.readFile.mockResolvedValue('{"users":');

    const { loadDb } = await loadStore();

    await expect(loadDb()).rejects.toBeInstanceOf(SyntaxError);
    expect(fsMocks.mkdir).not.toHaveBeenCalled();
    expect(fsMocks.writeFile).not.toHaveBeenCalled();
    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(observabilityMocks.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(SyntaxError),
        path: expect.stringContaining('auth-db.json'),
      }),
      'failed to load local auth database',
    );
    expect(observabilityMocks.reportException).toHaveBeenCalledWith(
      expect.any(SyntaxError),
      expect.objectContaining({ component: 'auth-store', path: expect.stringContaining('auth-db.json') }),
    );
  });

  it('reports and rethrows non-missing I/O errors without writing', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    fsMocks.readFile.mockRejectedValue(denied);

    const { loadDb } = await loadStore();

    await expect(loadDb()).rejects.toBe(denied);
    expect(fsMocks.mkdir).not.toHaveBeenCalled();
    expect(fsMocks.writeFile).not.toHaveBeenCalled();
    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(observabilityMocks.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: denied, path: expect.stringContaining('auth-db.json') }),
      'failed to load local auth database',
    );
    expect(observabilityMocks.reportException).toHaveBeenCalledWith(
      denied,
      expect.objectContaining({ component: 'auth-store', path: expect.stringContaining('auth-db.json') }),
    );
  });
});
