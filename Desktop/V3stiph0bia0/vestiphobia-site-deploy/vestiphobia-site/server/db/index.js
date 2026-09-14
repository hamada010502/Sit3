/**
 * VESTIPHOBIA — database adapter.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * Every query in the application goes through this adapter, and every query is
 * written in portable SQL with `?` placeholders. That is the whole reason
 * moving to Postgres/Supabase is a swap rather than a rewrite: the Postgres
 * driver below translates `?` to `$1, $2, …` and nothing else changes.
 *
 * Local development  : SQLite via node:sqlite (zero dependencies, zero cost)
 * Production         : PostgreSQL / Supabase (set DATABASE_URL)
 *
 * The SQLite driver is synchronous and the Postgres driver is not, so the
 * adapter's API is async throughout. Application code awaits everything, which
 * means it already works against Postgres today — there is no synchronous
 * assumption anywhere to unpick later.
 *
 * See server/db/postgres.md for the migration runbook.
 * ===========================================================================
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Application-generated ids keep the schema free of dialect-specific identity syntax. */
export const newId = () => randomUUID();

/** ISO-8601 UTC. Stored as TEXT; Postgres casts it to timestamptz directly. */
export const now = () => new Date().toISOString();

/* ------------------------------------------------------------ SQLite driver */

// node:sqlite has no ESM named export in Node 22, and the driver below is
// synchronous, so it is pulled in through createRequire rather than a dynamic
// import (which would force the whole adapter to be async at construction).
const require = createRequire(import.meta.url);

/**
 * True for a failure that means "someone else was writing", not "this is
 * wrong". Both engines have one: SQLITE_BUSY / SQLITE_LOCKED on SQLite,
 * deadlock and serialisation failures on Postgres.
 */
const isLockConflict = (err) => {
  const text = `${err?.code || ''} ${err?.errstr || ''} ${err?.message || ''}`;
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked|deadlock|could not serialize|40001|40P01/i.test(
    text
  );
};

/**
 * Retry a transaction that lost a race for the write lock.
 *
 * Safe because a rolled-back transaction wrote nothing: the body re-reads
 * everything it needs on each attempt, so a retry starts from the real current
 * state. Backoff is randomised so contending writers do not line up and
 * collide again in the same order.
 */
async function withRetry(work, attempts = Number(process.env.DB_TX_ATTEMPTS || 8)) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (err) {
      if (attempt >= attempts - 1 || !isLockConflict(err)) throw err;
      // Exponential, capped, and jittered. The cap matters: without it the
      // last attempts would wait longer than the request itself is worth. The
      // jitter matters more — without it, writers that collided once line up
      // and collide again in the same order.
      const backoff = Math.min(40 * 2 ** attempt, 800) * (0.5 + Math.random());
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

function sqliteDriver(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);

  /**
   * Connection settings, in an order that matters.
   *
   * `busy_timeout` MUST be set first. Switching the journal to WAL takes the
   * database's write lock, and with no busy timeout in effect yet that pragma
   * fails instantly with SQLITE_BUSY whenever another process happens to be
   * writing — so opening a connection under load would fail before the
   * connection was ever used. Setting the timeout first makes every later
   * lock-taking statement wait its turn instead.
   *
   * This was found by the inventory race test: at forty concurrent processes,
   * a handful failed inside getDb(), not inside any query.
   */
  db.exec(`PRAGMA busy_timeout = ${Number(process.env.SQLITE_BUSY_TIMEOUT_MS || 15000)}`);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');

  // WAL is a property of the FILE, not of this connection, so a failure to set
  // it would leave every writer serialised behind readers — slow in a way that
  // looks like nothing at all. Check rather than assume.
  const mode = db.prepare('PRAGMA journal_mode').get()?.journal_mode;
  if (String(mode).toLowerCase() !== 'wal') {
    console.warn(
      `[db] journal mode is "${mode}", not WAL. Concurrent readers will block writers. ` +
        'This usually means the database file is on a filesystem that does not support WAL (some network mounts).'
    );
  }

  return {
    dialect: 'sqlite',

    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },

    async get(sql, params = []) {
      return db.prepare(sql).get(...params) ?? null;
    },

    async run(sql, params = []) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes ?? 0) };
    },

    async exec(sql) {
      db.exec(sql);
    },

    /**
     * A transaction. SQLite is synchronous, so the callback runs to completion
     * inside BEGIN/COMMIT with no chance of interleaving. IMMEDIATE takes the
     * write lock up front, which is what makes the inventory decrement safe
     * against two simultaneous order acceptances.
     *
     * A transaction that loses the write lock is RETRIED rather than failed.
     * Under real contention — several admins accepting orders during a drop,
     * or two app instances sharing one database — SQLITE_BUSY is an ordinary
     * event, not a fault, and surfacing it to the admin as "could not update
     * the order" would be both confusing and wrong: nothing was written, so
     * trying again is always safe. This was found by the inventory race test,
     * where twenty concurrent accepts produced a handful of lock errors.
     */
    async transaction(fn) {
      return withRetry(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(this);
          db.exec('COMMIT');
          return result;
        } catch (err) {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* already rolled back */
          }
          throw err;
        }
      });
    },

    /**
     * Close, tolerantly.
     *
     * Closing the last SQLite connection checkpoints the write-ahead log,
     * which needs the write lock — so under concurrency close() itself can
     * fail with "database is locked". That is cleanup, not work: everything
     * committed is already durable in the WAL and the next process to open the
     * file will checkpoint it. Letting this throw once turned a SUCCESSFUL
     * order acceptance into a failed process, which is how it was found.
     */
    async close() {
      try {
        db.close();
      } catch (err) {
        console.warn('[db] close deferred (the write-ahead log is busy):', err.message);
      }
    },
  };
}

/* -------------------------------------------------------- PostgreSQL driver */

/**
 * Production driver. Requires `npm install pg`, which is deliberately NOT a
 * dependency of this project — a local SQLite install must not have to pull a
 * Postgres client it will never use.
 *
 * The only translation needed is placeholder style. Every query in the
 * application already uses `?`, so this rewrite is the entire adapter layer.
 */
async function postgresDriver(connectionString) {
  let pg;
  try {
    pg = await import('pg');
  } catch {
    throw new Error(
      'DATABASE_URL is set but the "pg" package is not installed.\n' +
        'Run:  npm install pg\n' +
        'See server/db/postgres.md for the full runbook.'
    );
  }

  const pool = new pg.default.Pool({
    connectionString,
    // Supabase and most hosted Postgres require TLS.
    ssl: /supabase|amazonaws|render|neon/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
    max: Number(process.env.PG_POOL_MAX || 10),
  });

  /** `?, ?, ?` -> `$1, $2, $3`, leaving quoted literals alone. */
  const toPg = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };

  const wrap = (client) => ({
    dialect: 'postgres',
    async all(sql, params = []) {
      return (await client.query(toPg(sql), params)).rows;
    },
    async get(sql, params = []) {
      return (await client.query(toPg(sql), params)).rows[0] ?? null;
    },
    async run(sql, params = []) {
      const r = await client.query(toPg(sql), params);
      return { changes: r.rowCount ?? 0 };
    },
    async exec(sql) {
      await client.query(sql);
    },
    async transaction(fn) {
      await client.query('BEGIN');
      try {
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    },
  });

  return {
    ...wrap(pool),
    async transaction(fn) {
      // Same retry policy as SQLite: a deadlock or serialisation failure means
      // try again, not tell the admin the order could not be updated.
      return withRetry(async () => {
        const client = await pool.connect();
        try {
          return await wrap(client).transaction(fn);
        } finally {
          client.release();
        }
      });
    },
    async close() {
      await pool.end();
    },
  };
}

/* --------------------------------------------------------------- singleton */

let instance = null;

/**
 * Open (or reuse) the database.
 * DATABASE_URL present -> Postgres. Otherwise SQLite at SQLITE_PATH.
 */
export async function getDb() {
  if (instance) return instance;

  const url = process.env.DATABASE_URL;
  if (url) {
    instance = await postgresDriver(url);
  } else {
    const file = process.env.SQLITE_PATH || join(HERE, '../../data/vestiphobia.db');
    instance = sqliteDriver(file);
  }
  return instance;
}

export async function closeDb() {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

/** The portable DDL, shared by the migrator and the test harness. */
export const schemaSql = () => readFileSync(join(HERE, 'schema.sql'), 'utf8');

/**
 * SQLite has no native boolean. Read one back consistently on both engines,
 * so application code never has to care which it is talking to.
 */
export const bool = (v) => v === 1 || v === true || v === '1' || v === 't';

/** Money is stored in cents. These two functions are the only conversion. */
export const toCents = (amount) => Math.round(Number(amount) * 100);
export const fromCents = (cents) => Number(cents) / 100;

/** JSON columns, defensively parsed — a malformed row must not crash a page. */
export function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value; // Postgres jsonb comes back parsed
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export const toJson = (value) => (value === null || value === undefined ? null : JSON.stringify(value));
