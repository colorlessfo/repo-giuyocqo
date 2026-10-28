import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync, createHash, randomBytes } from 'node:crypto';
import { createApp, defaultSettings } from '../server/app.mjs';
import { createDatabase, postgresOptions } from '../server/database.mjs';

test('PostgreSQL requires verified TLS and cannot be weakened by connection URL options', () => {
  const options = postgresOptions(
    'postgresql://user:placeholder@db.example.com/data?sslmode=require',
  );
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'), false);
  assert.throws(
    () => postgresOptions('postgresql://user:placeholder@db.example.com/data?sslmode=disable'),
    /verified TLS/,
  );
  assert.equal(
    postgresOptions('postgresql://user:placeholder@127.0.0.1:35432/test?sslmode=disable').ssl,
    false,
  );
  assert.equal(
    postgresOptions('postgresql://user:placeholder@localhost/test').ssl.rejectUnauthorized,
    true,
  );
});
test('Render cannot silently fall back to an ephemeral SQLite database', async () => {
  const old = process.env.RENDER,
    allowed = process.env.ALLOW_PERSISTENT_SQLITE;
  process.env.RENDER = 'true';
  delete process.env.ALLOW_PERSISTENT_SQLITE;
  try {
    await assert.rejects(
      createDatabase({ dataDir: '/tmp/qiyu-must-not-create', databaseUrl: null }),
      /Set DATABASE_URL/,
    );
  } finally {
    if (old === undefined) delete process.env.RENDER;
    else process.env.RENDER = old;
    if (allowed === undefined) delete process.env.ALLOW_PERSISTENT_SQLITE;
    else process.env.ALLOW_PERSISTENT_SQLITE = allowed;
  }
});
test('legacy SQLite email accounts migrate without losing their passwords, sessions or tasks', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'qiyu-legacy-'));
  const legacy = new DatabaseSync(path.join(dataDir, 'qiyu.sqlite'));
  const salt = randomBytes(16).toString('hex');
  const password = 'legacy-account-password';
  const session = randomBytes(32).toString('base64url');
  legacy.exec(
    `CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);CREATE TABLE entities(user_id TEXT NOT NULL,collection TEXT NOT NULL,id TEXT NOT NULL,data TEXT,version INTEGER NOT NULL,PRIMARY KEY(user_id,collection,id));`,
  );
  legacy
    .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)')
    .run(
      'old-user',
      'old@example.com',
      '旧账号',
      salt,
      scryptSync(password, salt, 64).toString('hex'),
      1,
      Date.now(),
    );
  legacy
    .prepare('INSERT INTO sessions VALUES(?,?,?)')
    .run(createHash('sha256').update(session).digest('hex'), 'old-user', Date.now() + 86400000);
  legacy
    .prepare('INSERT INTO entities VALUES(?,?,?,?,?)')
    .run('old-user', 'settings', 'main', JSON.stringify(defaultSettings()), 1);
  legacy
    .prepare('INSERT INTO entities VALUES(?,?,?,?,?)')
    .run('old-user', 'tasks', 'old-task', JSON.stringify({ title: '旧任务不会消失' }), 1);
  legacy.close();
  const { app, db } = await createApp({ dataDir, databaseUrl: null, disableRateLimit: true });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await fetch(base + '/api/state', {
      headers: { Cookie: `qiyu_session=${session}` },
    });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).tasks[0].title, '旧任务不会消失');
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'old@example.com', password }),
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.id, 'old-user');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
