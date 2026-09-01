import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { DAY_MS, type AuthDb } from './auth.models';
import { logger, reportException } from './observability';

const DATA_DIR = fileURLToPath(new URL('./data', import.meta.url));
const DB_PATH = join(DATA_DIR, 'auth-db.json');

let saveChain = Promise.resolve();
let pgPool: Pool | null = null;
let pgReady: Promise<void> | null = null;

export function normalizeDb(value: unknown): AuthDb {
  const parsed = typeof value === 'object' && value ? (value as Partial<AuthDb>) : {};
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    codes: Array.isArray(parsed.codes) ? parsed.codes : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
    paymentEvents: Array.isArray(parsed.paymentEvents) ? parsed.paymentEvents : [],
    usage: Array.isArray(parsed.usage) ? parsed.usage : [],
  };
}

export function emptyDb(): AuthDb {
  return { users: [], codes: [], sessions: [], purchases: [], paymentEvents: [], usage: [] };
}

function databaseUrl(): string | null {
  return process.env.DATABASE_URL?.trim() || null;
}

function databasePoolMax(): number {
  const configured = Number(process.env.DATABASE_POOL_MAX);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 50 ? configured : 4;
}

function getPgPool(): Pool | null {
  const url = databaseUrl();
  if (!url) return null;
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: url,
      ssl:
        url.includes('sslmode=require') || /neon\.tech/i.test(url)
          ? { rejectUnauthorized: process.env.DATABASE_TLS_REJECT_UNAUTHORIZED !== 'false' }
          : undefined,
      max: databasePoolMax(),
    });
  }
  return pgPool;
}

async function ensurePgStore(): Promise<Pool | null> {
  const pool = getPgPool();
  if (!pool) return null;
  if (!pgReady) {
    pgReady = pool
      .query(
        `CREATE TABLE IF NOT EXISTS filemint_auth_store (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      )
      .then(() => undefined);
  }
  await pgReady;
  return pool;
}

async function loadPgDb(): Promise<AuthDb | null> {
  const pool = await ensurePgStore();
  if (!pool) return null;
  const res = await pool.query<{ data: unknown }>('SELECT data FROM filemint_auth_store WHERE id = $1', [
    'main',
  ]);
  if (res.rows[0]?.data) return normalizeDb(res.rows[0].data);
  const db = emptyDb();
  await writePgDb(db);
  return db;
}

async function writePgDb(db: AuthDb): Promise<boolean> {
  const pool = await ensurePgStore();
  if (!pool) return false;
  await pool.query(
    `INSERT INTO filemint_auth_store (id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    ['main', JSON.stringify(db)],
  );
  return true;
}

export async function loadDb(): Promise<AuthDb> {
  const pgDb = await loadPgDb();
  if (pgDb) return pgDb;
  try {
    const raw = await readFile(DB_PATH, 'utf8');
    return normalizeDb(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.error({ err: error, path: DB_PATH }, 'failed to load local auth database');
      reportException(error, { component: 'auth-store', path: DB_PATH });
      throw error;
    }
    await mkdir(dirname(DB_PATH), { recursive: true });
    const db = emptyDb();
    await writeDb(db);
    return db;
  }
}

export async function writeDb(db: AuthDb): Promise<void> {
  if (await writePgDb(db)) return;
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  await rename(tmp, DB_PATH);
}

export async function mutateDb<T>(fn: (db: AuthDb) => T | Promise<T>): Promise<T> {
  const run = async () => {
    const db = await loadDb();
    prune(db);
    const result = await fn(db);
    await writeDb(db);
    return result;
  };
  const next = saveChain.then(run, run);
  saveChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function prune(db: AuthDb): void {
  const cutoff = Date.now() - 7 * DAY_MS;
  db.codes = db.codes.filter((code) => !code.usedAt && new Date(code.expiresAt).getTime() > cutoff);
  db.sessions = db.sessions.filter(
    (session) => !session.revokedAt && new Date(session.expiresAt).getTime() > cutoff,
  );
}
