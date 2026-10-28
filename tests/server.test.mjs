import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import pg from 'pg';
import { postgresOptions } from '../server/database.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';

const task = {
  title: '跨天报告',
  notes: '保留这段备注',
  dueAt: '2026-10-30T01:00:00+08:00',
  durationMinutes: 1800,
  categoryId: null,
  mascot: 'star',
  completed: false,
  completedAt: null,
};
async function setup(t, disableRateLimit = true) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'qiyu-api-'));
  const databaseUrl = process.env.QIYU_TEST_DATABASE_URL_FILE
    ? JSON.parse(await readFile(process.env.QIYU_TEST_DATABASE_URL_FILE, 'utf8')).url
    : null;
  const databaseSchema = `qiyu_test_${randomUUID().replaceAll('-', '')}`;
  const { app, db } = await createApp({ dataDir, databaseUrl, databaseSchema, disableRateLimit });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    if (databaseUrl) {
      const admin = new pg.Pool(postgresOptions(databaseUrl));
      await admin.query(`DROP SCHEMA IF EXISTS "${databaseSchema}" CASCADE`);
      await admin.end();
    }
    await rm(dataDir, { recursive: true, force: true });
  });
  const request = async (url, body, cookie = '', headers = {}) => {
    const res = await fetch(base + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return {
      status: res.status,
      body: await res.json(),
      cookie: res.headers.get('set-cookie')?.split(';')[0],
      headers: res.headers,
    };
  };
  const register = async (email) =>
    request('/api/auth/register', { email, password: 'test-password-123', name: '测试同学' });
  const mutate = (cookie, changes, mutationId = randomUUID()) =>
    request('/api/changes', { mutationId, changes }, cookie);
  return { request, register, mutate, db, dataDir, databaseUrl, databaseSchema };
}
test('independent accounts, durable sessions, and no unauthenticated reads', async (t) => {
  const { request, register, mutate } = await setup(t);
  assert.equal((await request('/api/state')).status, 401);
  const alice = await register('alice@example.com'),
    bob = await register('bob@example.com');
  assert.equal(alice.status, 201);
  assert.match(alice.cookie, /qiyu_session=/);
  const saved = await mutate(alice.cookie, [
    { collection: 'tasks', id: 'task-1', expectedVersion: 0, data: task },
  ]);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.tasks[0].durationMinutes, 1800);
  assert.equal((await request('/api/state', undefined, bob.cookie)).body.tasks.length, 0);
  const isolated = await mutate(bob.cookie, [
    {
      collection: 'tasks',
      id: 'task-1',
      expectedVersion: 1,
      data: { ...task, title: 'wrong account' },
    },
  ]);
  assert.equal(isolated.status, 409);
  assert.equal(
    (await request('/api/state', undefined, alice.cookie)).body.tasks[0].title,
    task.title,
  );
  const login = await request('/api/auth/login', {
    email: 'ALICE@example.com',
    password: 'test-password-123',
  });
  assert.equal(login.status, 200);
  assert.equal(
    (await request('/api/state', undefined, login.cookie)).body.tasks[0].title,
    task.title,
  );
  assert.equal(
    (await request('/api/auth/me', undefined, alice.cookie)).body.user.email,
    'alice@example.com',
  );
  assert.equal('password_hash' in alice.body.user, false);
});
test('optimistic concurrency is atomic and retries are idempotent', async (t) => {
  const { register, request, mutate } = await setup(t);
  const { cookie } = await register('concurrent@example.com');
  const mutationId = randomUUID();
  const changes = [{ collection: 'tasks', id: 'one', expectedVersion: 0, data: task }];
  const first = await mutate(cookie, changes, mutationId);
  assert.equal(first.status, 200);
  const replay = await mutate(cookie, changes, mutationId);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.tasks[0].version, 1);
  assert.equal(replay.body.revision, 1);
  const changed = await mutate(cookie, [
    { collection: 'tasks', id: 'one', expectedVersion: 1, data: { ...task, title: 'device 1' } },
  ]);
  assert.equal(changed.status, 200);
  const conflict = await mutate(cookie, [
    { collection: 'tasks', id: 'one', expectedVersion: 1, data: { ...task, title: 'device 2' } },
    { collection: 'tasks', id: 'two', expectedVersion: 0, data: task },
  ]);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.state.tasks.length, 1);
  assert.equal(conflict.body.state.tasks[0].title, 'device 1');
  const wrongReplay = await mutate(
    cookie,
    [{ ...changes[0], data: { ...task, title: 'different' } }],
    mutationId,
  );
  assert.equal(wrongReplay.status, 409);
  assert.equal((await request('/api/state', undefined, cookie)).body.tasks.length, 1);
});
test('deleting a category detaches all tasks and retains their contents', async (t) => {
  const { register, request, mutate } = await setup(t);
  const { cookie } = await register('category@example.com');
  await mutate(cookie, [
    {
      collection: 'categories',
      id: 'cat',
      expectedVersion: 0,
      data: { name: '毕业设计', color: 'violet' },
    },
    { collection: 'tasks', id: 'keep', expectedVersion: 0, data: { ...task, categoryId: 'cat' } },
  ]);
  const after = await mutate(cookie, [
    { collection: 'categories', id: 'cat', expectedVersion: 1, data: null },
  ]);
  assert.equal(after.status, 200);
  assert.equal(after.body.tasks.length, 1);
  assert.equal(after.body.tasks[0].categoryId, null);
  assert.equal(after.body.tasks[0].notes, task.notes);
  assert.equal(after.body.tasks[0].version, 2);
  assert.equal(after.body.versions['categories/cat'], 2);
  assert.equal(
    (await request('/api/state', undefined, cookie)).body.tasks[0].durationMinutes,
    1800,
  );
});
test('validation prevents partial imports, invalid dates, and invalid teaching rules', async (t) => {
  const { register, request, mutate } = await setup(t);
  const { cookie } = await register('validation@example.com');
  const valid = { collection: 'tasks', id: 'valid', expectedVersion: 0, data: task };
  const bad = await mutate(cookie, [
    valid,
    {
      collection: 'tasks',
      id: 'invalid',
      expectedVersion: 0,
      data: { ...task, durationMinutes: 0 },
    },
  ]);
  assert.equal(bad.status, 400);
  assert.equal((await request('/api/state', undefined, cookie)).body.tasks.length, 0);
  assert.equal(
    (await mutate(cookie, [{ ...valid, data: { ...task, durationMinutes: 525600 } }])).status,
    200,
  );
  assert.equal(
    (
      await mutate(cookie, [
        { ...valid, expectedVersion: 1, data: { ...task, durationMinutes: 525601 } },
      ])
    ).status,
    400,
  );
  const state = (await request('/api/state', undefined, cookie)).body;
  assert.equal(
    (
      await mutate(cookie, [
        {
          collection: 'settings',
          id: 'main',
          expectedVersion: 1,
          data: { ...state.settings[0], semesterStart: '2026-02-30' },
        },
      ])
    ).status,
    400,
  );
  assert.equal(
    (
      await mutate(cookie, [
        {
          collection: 'settings',
          id: 'main',
          expectedVersion: 1,
          data: { ...state.settings[0], semesterStart: '2026-10-27' },
        },
      ])
    ).status,
    400,
  );
  assert.equal(
    (
      await mutate(cookie, [
        {
          collection: 'courses',
          id: 'course',
          expectedVersion: 0,
          data: {
            title: '数学',
            weekday: 1,
            startTime: '10:00',
            endTime: '09:00',
            startWeek: 1,
            endWeek: 16,
            parity: 'odd',
            location: '',
            exceptions: [],
          },
        },
      ])
    ).status,
    400,
  );
  assert.equal((await mutate(cookie, [valid, valid])).status, 400);
});
test('CSRF requests are rejected; password changes revoke other device sessions', async (t) => {
  const { register, request } = await setup(t);
  const { cookie } = await register('security@example.com');
  assert.equal(
    (await request('/api/auth/logout', {}, cookie, { Origin: 'https://other.example' })).status,
    403,
  );
  const other = await request('/api/auth/login', {
    email: 'security@example.com',
    password: 'test-password-123',
  });
  const updated = await request(
    '/api/auth/password',
    { oldPassword: 'test-password-123', newPassword: 'new-long-password' },
    cookie,
  );
  assert.equal(updated.status, 200);
  assert.equal((await request('/api/auth/me', undefined, other.cookie)).status, 401);
  assert.equal((await request('/api/auth/me', undefined, updated.cookie)).status, 200);
  assert.equal(
    (
      await request('/api/auth/login', {
        email: 'security@example.com',
        password: 'test-password-123',
      })
    ).status,
    401,
  );
  await request('/api/auth/logout', {}, updated.cookie);
  assert.equal((await request('/api/auth/me', undefined, updated.cookie)).status, 401);
});
test('login endpoint enforces server-side rate limiting', async (t) => {
  const { request } = await setup(t, false);
  for (let i = 0; i < 15; i++)
    assert.equal(
      (
        await request('/api/auth/login', {
          email: 'missing@example.com',
          password: 'test-password-123',
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await request('/api/auth/login', {
        email: 'missing@example.com',
        password: 'test-password-123',
      })
    ).status,
    429,
  );
});
test('accounts need no email or phone and normalized usernames stay unique', async (t) => {
  const { request } = await setup(t);
  const created = await request('/api/auth/register', {
    account: '奇遇_同学001',
    password: 'a-long-account-password',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.account, '奇遇_同学001');
  assert.equal(created.body.user.email, null);
  assert.equal(
    (
      await request('/api/auth/login', {
        account: '奇遇_同学001',
        password: 'a-long-account-password',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request('/api/auth/register', {
        account: '奇遇_同学001',
        password: 'different-password',
      })
    ).status,
    409,
  );
  assert.equal(
    (await request('/api/auth/register', { account: 'x', password: 'different-password' })).status,
    400,
  );
  assert.equal(
    (
      await request('/api/auth/register', {
        account: 'name with spaces',
        password: 'different-password',
      })
    ).status,
    400,
  );
  await request('/api/auth/register', { account: 'ABC_123', password: 'a-long-account-password' });
  assert.equal(
    (await request('/api/auth/register', { account: 'ＡＢＣ_123', password: 'different-password' }))
      .status,
    409,
  );
});
test('simultaneous writes stay atomic and simultaneous retries only apply once', async (t) => {
  const { register, mutate } = await setup(t);
  const { cookie } = await register('races@example.com');
  const changes = [{ collection: 'tasks', id: 'race', expectedVersion: 0, data: task }];
  const mutationId = randomUUID();
  const results = await Promise.all([
    mutate(cookie, changes, mutationId),
    mutate(cookie, changes, mutationId),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  assert.equal(results[1].body.tasks[0].version, 1);
  const edits = await Promise.all(
    ['one', 'two'].map((title) =>
      mutate(cookie, [
        { collection: 'tasks', id: 'race', expectedVersion: 1, data: { ...task, title } },
      ]),
    ),
  );
  assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
});
test('new application instances retain accounts, sessions and task data', async (t) => {
  const { register, mutate, dataDir, databaseUrl, databaseSchema } = await setup(t);
  const account = await register('restart@example.com');
  await mutate(account.cookie, [
    { collection: 'tasks', id: 'keep', expectedVersion: 0, data: task },
  ]);
  const second = await createApp({ dataDir, databaseUrl, databaseSchema, disableRateLimit: true });
  const server = second.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/state`, {
      headers: { Cookie: account.cookie },
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).tasks[0].title, task.title);
    const update = (title) => ({
      collection: 'tasks',
      id: 'keep',
      expectedVersion: 1,
      data: { ...task, title },
    });
    const races = await Promise.all([
      mutate(account.cookie, [update('first app')]),
      fetch(`http://127.0.0.1:${server.address().port}/api/changes`, {
        method: 'POST',
        headers: { Cookie: account.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mutationId: randomUUID(), changes: [update('second app')] }),
      }),
    ]);
    assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await second.db.close();
  }
});
