import { Pool, types } from 'pg';

/**
 * DATE columns (OID 1082) are returned as the `YYYY-MM-DD` string Postgres
 * sent, not as a JS Date at local midnight. A Date makes every consumer choose
 * between local and UTC accessors, and `toISOString()` on one shifts the day
 * backwards for any server west of Greenwich. A calendar date is a string.
 */
types.setTypeParser(1082, (value: string) => value);

/**
 * How long the database may keep a request waiting, in milliseconds.
 *
 * Every limit here exists because the pool is ten clients shared by the whole
 * site: one query stuck on a lock holds one of them, ten stuck queries hold all
 * of them, and from then on every request — including the middleware's WIP
 * check, so every public page — queues behind a pool that never frees a slot.
 * That is a site-wide outage that looks like a dead server (the browser shows a
 * connection timeout) and only a restart clears. Each limit turns "wait
 * forever" into an error one request can survive.
 *
 * Overridable by environment for a one-off job that legitimately runs longer
 * (0 switches a limit off).
 */
function limit(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const STATEMENT_TIMEOUT_MS = limit('DB_STATEMENT_TIMEOUT_MS', 30_000);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Waiting for a free client, or for a new connection to open. Without it a
    // saturated pool queues callers indefinitely.
    connectionTimeoutMillis: limit('DB_CONNECTION_TIMEOUT_MS', 10_000),
    // Enforced by Postgres: a statement that runs (or waits on a lock) longer
    // than this is cancelled and its connection is usable again.
    statement_timeout: STATEMENT_TIMEOUT_MS,
    // Postgres ends a session that opened a transaction and then went quiet, so
    // a code path that forgets COMMIT/ROLLBACK cannot hold row locks — and a
    // pool slot — until the next restart.
    idle_in_transaction_session_timeout: limit('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 60_000),
    // The client's own backstop, a little behind the server's: statement_timeout
    // cannot fire when the connection itself is dead (network blip, a Postgres
    // that vanished mid-query), and the caller would wait on a socket that never
    // answers.
    query_timeout: STATEMENT_TIMEOUT_MS > 0 ? STATEMENT_TIMEOUT_MS + 5_000 : undefined,
    // Lets the OS notice a connection that died silently while it sat idle.
    keepAlive: true,
});

/*
 * An idle client's connection can fail with nobody holding it — Postgres
 * restarted, the network dropped. pg re-emits that on the pool, and an 'error'
 * event with no listener is thrown by Node as an uncaught exception, which
 * kills the whole server. Logging it is enough: the pool has already discarded
 * the client and opens a fresh one on the next request.
 */
pool.on('error', (error) => {
    console.error('Postgres pool: idle client error', error);
});

export default pool;
