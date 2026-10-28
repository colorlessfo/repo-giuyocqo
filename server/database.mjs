import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const tables = (schema = '') => `
  CREATE TABLE IF NOT EXISTS ${schema}users (id TEXT PRIMARY KEY, account TEXT NOT NULL UNIQUE, name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL);
  CREATE TABLE IF NOT EXISTS ${schema}sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES ${schema}users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL);
  CREATE TABLE IF NOT EXISTS ${schema}entities (user_id TEXT NOT NULL REFERENCES ${schema}users(id) ON DELETE CASCADE, collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT, version INTEGER NOT NULL, PRIMARY KEY(user_id, collection, id));
  CREATE TABLE IF NOT EXISTS ${schema}mutations (user_id TEXT NOT NULL REFERENCES ${schema}users(id) ON DELETE CASCADE, id TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY(user_id,id));
  CREATE INDEX IF NOT EXISTS session_expiry ON ${schema}sessions(expires_at);
`;

export function postgresOptions(databaseUrl, ca = process.env.DATABASE_SSL_CA) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const mode = url.searchParams.get('sslmode');
  if (!local && mode === 'disable') throw new Error('Remote databases require verified TLS.');
  // pg connection-string options can override the explicit SSL object. Remove those options
  // and enforce certificate verification ourselves, including when a provider suggests "require".
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl:
      local && mode === 'disable'
        ? false
        : { rejectUnauthorized: true, ...(ca ? { ca: ca.replace(/\\n/g, '\n') } : {}) },
    max: 3,
    connectionTimeoutMillis: 12000,
    idleTimeoutMillis: 30000,
    application_name: 'qiyu-ddl',
  };
}

export async function createDatabase({ dataDir = './data', databaseUrl, schema = 'qiyu' } = {}) {
  if (!databaseUrl) {
    if (
      process.env.REQUIRE_DATABASE_URL === 'true' ||
      (process.env.RENDER === 'true' && process.env.ALLOW_PERSISTENT_SQLITE !== 'true')
    ) {
      throw new Error(
        'Set DATABASE_URL before deploying on Render. Temporary local storage must not hold accounts or tasks.',
      );
    }
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const raw = new DatabaseSync(path.join(dataDir, 'qiyu.sqlite'));
    raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const columns = raw.prepare('PRAGMA table_info(users)').all();
    if (columns.some((c) => c.name === 'email') && !columns.some((c) => c.name === 'account')) {
      raw.exec('ALTER TABLE users RENAME COLUMN email TO account');
    }
    raw.exec(tables());
    const connection = {
      async get(sql, ...params) {
        return raw.prepare(sql).get(...params);
      },
      async all(sql, ...params) {
        return raw.prepare(sql).all(...params);
      },
      async run(sql, ...params) {
        return raw.prepare(sql).run(...params);
      },
    };
    let tail = Promise.resolve();
    // All operations, including snapshots, use the same gate. No request sees an
    // intermediate SQLite transaction while another async request is yielding.
    const exclusive = (fn) => {
      const result = tail.then(fn);
      tail = result.catch(() => {});
      return result;
    };
    const transaction = (mode, fn) =>
      exclusive(async () => {
        raw.exec(mode);
        try {
          const value = await fn(connection);
          raw.exec('COMMIT');
          return value;
        } catch (err) {
          if (raw.isTransaction) raw.exec('ROLLBACK');
          throw err;
        }
      });
    return {
      kind: 'sqlite',
      read: (fn) => transaction('BEGIN', fn),
      write: (_userId, fn) => transaction('BEGIN IMMEDIATE', fn),
      close: () => exclusive(() => raw.close()),
    };
  }

  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid private database schema.');
  const pool = new pg.Pool(postgresOptions(databaseUrl));
  pool.on('error', (err) =>
    console.error('Database connection interrupted:', err.code || err.name),
  );
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    await pool.end();
    throw err;
  }
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(612740918)');
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(tables(`"${schema}".`));
    await client.query(
      `REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC; REVOKE ALL ON ALL TABLES IN SCHEMA "${schema}" FROM PUBLIC;`,
    );
    // Supabase's anonymous/authenticated Data API roles must not read application tables.
    for (const role of ['anon', 'authenticated']) {
      const found = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
      if (found.rows.length)
        await client.query(
          `REVOKE ALL ON SCHEMA "${schema}" FROM "${role}"; REVOKE ALL ON ALL TABLES IN SCHEMA "${schema}" FROM "${role}";`,
        );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
    throw err;
  }
  client.release();
  const transaction = async (userId, write, fn) => {
    const connection = await pool.connect();
    const query = (sql, params) => {
      let count = 0;
      return connection.query(
        sql.replace(/\?/g, () => `$${++count}`),
        params,
      );
    };
    try {
      await connection.query(write ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await connection.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
      if (write && userId)
        await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [userId]);
      const value = await fn({
        async get(sql, ...params) {
          return (await query(sql, params)).rows[0];
        },
        async all(sql, ...params) {
          return (await query(sql, params)).rows;
        },
        async run(sql, ...params) {
          return query(sql, params);
        },
      });
      await connection.query('COMMIT');
      return value;
    } catch (err) {
      await connection.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      connection.release();
    }
  };
  return {
    kind: 'postgresql',
    read: (fn) => transaction(null, false, fn),
    write: (userId, fn) => transaction(userId, true, fn),
    close: () => pool.end(),
  };
}
