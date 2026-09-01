import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthDb } from './auth.models';

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  writeFile: vi.fn(),
  query: vi.fn(),
  poolOptions: [] as Record<string, unknown>[],
}));

const originalMaxListeners = process.getMaxListeners();

beforeAll(() => process.setMaxListeners(Math.max(originalMaxListeners, 50)));
afterAll(() => process.setMaxListeners(originalMaxListeners));

vi.mock('node:fs/promises', () => ({
  mkdir: mocks.mkdir,
  readFile: mocks.readFile,
  rename: mocks.rename,
  writeFile: mocks.writeFile,
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.query;

    constructor(options: Record<string, unknown>) {
      mocks.poolOptions.push(options);
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.poolOptions.length = 0;
  vi.unstubAllEnvs();
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.rename.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
});

describe('authentication file persistence', () => {
  it('loads and normalizes a valid JSON database from disk', async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({ users: [{ id: 'user-1' }], codes: 'invalid', sessions: [], usage: null }),
    );
    const { loadDb } = await import('./auth.store');

    const db = await loadDb();

    expect(db.users).toEqual([{ id: 'user-1' }]);
    expect(db.codes).toEqual([]);
    expect(db.usage).toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('creates and atomically persists an empty database when the file cannot be read', async () => {
    mocks.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const { loadDb } = await import('./auth.store');

    const db = await loadDb();

    expect(db).toEqual({ users: [], codes: [], sessions: [], purchases: [], paymentEvents: [], usage: [] });
    expect(mocks.mkdir).toHaveBeenCalled();
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/auth-db\.json\.\d+\.\d+\.tmp$/),
      expect.stringContaining('"users": []'),
      'utf8',
    );
    expect(mocks.rename).toHaveBeenCalledWith(
      expect.stringMatching(/\.tmp$/),
      expect.stringMatching(/auth-db\.json$/),
    );
  });

  it('serializes successful mutations and continues after a failed mutation', async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({ users: [] }));
    const { mutateDb } = await import('./auth.store');
    const order: string[] = [];

    await expect(
      mutateDb(() => {
        order.push('failed');
        throw new Error('mutation failed');
      }),
    ).rejects.toThrow('mutation failed');
    const result = await mutateDb(async (db) => {
      order.push('recovered');
      db.users.push({ id: 'user-2' } as never);
      return 'saved';
    });

    expect(result).toBe('saved');
    expect(order).toEqual(['failed', 'recovered']);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
  });

  it('surfaces non-missing file errors and prunes only unusable security records', async () => {
    mocks.readFile.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    const { loadDb, emptyDb, prune } = await import('./auth.store');
    await expect(loadDb()).rejects.toThrow('permission denied');
    expect(mocks.writeFile).not.toHaveBeenCalled();

    const db = emptyDb();
    db.codes.push({
      id: 'valid-code',
      email: 'reader@example.com',
      purpose: 'verify_email',
      codeHash: 'hash',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    db.sessions.push({
      id: 'valid-session',
      userId: 'user-1',
      tokenHash: 'hash',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      revokedAt: null,
    });
    prune(db);
    expect(db.codes).toHaveLength(1);
    expect(db.sessions).toHaveLength(1);
  });
});

describe('authentication PostgreSQL persistence', () => {
  it('loads an existing PostgreSQL JSON document with TLS and pool limits', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@db.neon.tech/main?sslmode=require');
    vi.stubEnv('DATABASE_POOL_MAX', '9');
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT data')) return { rows: [{ data: { users: [{ id: 'pg-user' }] } }] };
      return { rows: [] };
    });
    const { loadDb } = await import('./auth.store');

    const db = await loadDb();

    expect(db.users).toEqual([{ id: 'pg-user' }]);
    expect(mocks.poolOptions[0]).toMatchObject({
      connectionString: expect.stringContaining('neon.tech'),
      ssl: { rejectUnauthorized: false },
      max: 9,
    });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('CREATE TABLE'))).toBe(true);
  });

  it('initializes missing PostgreSQL data and writes subsequent updates without filesystem access', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/filemint');
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT data')) return { rows: [] };
      return { rows: [] };
    });
    const { loadDb, writeDb } = await import('./auth.store');

    const db = await loadDb();
    db.usage.push({
      userId: 'user-1',
      date: '2026-09-01',
      conversions: 1,
      ocrTasks: 0,
      compressions: 0,
      scans: 0,
      batchJobs: 0,
    });
    await writeDb(db);

    expect(db.users).toEqual([]);
    expect(mocks.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO'))).toHaveLength(2);
    expect(mocks.poolOptions[0]).toMatchObject({ ssl: undefined, max: 4 });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('normalizes non-object database payloads into independent collections', async () => {
    const { emptyDb, normalizeDb } = await import('./auth.store');
    expect(normalizeDb(null)).toEqual(emptyDb());
    expect(normalizeDb('invalid')).toEqual(emptyDb());
    const first: AuthDb = emptyDb();
    const second: AuthDb = emptyDb();
    first.paymentEvents.push({} as never);
    expect(second.paymentEvents).toEqual([]);
  });
});
