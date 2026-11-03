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
async function setup(t, disableRateLimit = true, extra = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'qiyu-api-'));
  const databaseUrl = process.env.QIYU_TEST_DATABASE_URL_FILE
    ? JSON.parse(await readFile(process.env.QIYU_TEST_DATABASE_URL_FILE, 'utf8')).url
    : null;
  const databaseSchema = `qiyu_test_${randomUUID().replaceAll('-', '')}`;
  const { app, db } = await createApp({
    dataDir,
    databaseUrl,
    databaseSchema,
    disableRateLimit,
    ...extra,
  });
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

test('notebook content, archives, conflicts and tombstones are private and durable', async (t) => {
  const { register, request, mutate, dataDir, databaseUrl, databaseSchema } = await setup(t);
  const alice = await register('notes-alice@example.com');
  const bob = await register('notes-bob@example.com');
  const note = {
    title: '冒险手记',
    content: '第一行\n\n  保留缩进和换行\n',
    archived: false,
    updatedAt: new Date().toISOString(),
  };
  const change = (expectedVersion, data) => ({
    collection: 'notes',
    id: 'my-note',
    expectedVersion,
    data,
  });
  const first = await mutate(alice.cookie, [change(0, note)]);
  assert.equal(first.status, 200);
  assert.equal(first.body.notes[0].content, note.content);
  assert.deepEqual((await request('/api/state', undefined, bob.cookie)).body.notes, []);
  assert.equal(
    (await mutate(bob.cookie, [change(1, { ...note, content: 'other account' })])).status,
    409,
  );
  const archived = await mutate(alice.cookie, [change(1, { ...note, archived: true })]);
  assert.equal(archived.body.notes[0].archived, true);
  const conflict = await mutate(alice.cookie, [change(1, { ...note, content: 'stale edit' })]);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.state.notes[0].archived, true);
  assert.equal(conflict.body.state.notes[0].content, note.content);
  const second = await createApp({ dataDir, databaseUrl, databaseSchema, disableRateLimit: true });
  try {
    const retained = await second.db.read((c) =>
      c.get(
        "SELECT data FROM entities WHERE user_id=? AND collection='notes' AND id='my-note'",
        alice.body.user.id,
      ),
    );
    assert.equal(JSON.parse(retained.data).archived, true);
  } finally {
    await second.db.close();
  }
  assert.equal(
    (await mutate(alice.cookie, [change(2, { ...note, content: 'x'.repeat(20001) })])).status,
    400,
  );
  await mutate(alice.cookie, [change(2, note)]);
  const removed = await mutate(alice.cookie, [change(3, null)]);
  assert.equal(removed.body.notes.length, 0);
  assert.equal(removed.body.versions['notes/my-note'], 4);
  assert.equal((await mutate(alice.cookie, [change(3, note)])).status, 409);
});

test('flame preferences persist per account, reject invalid values and survive legacy semester writes', async (t) => {
  const { register, request, mutate } = await setup(t);
  const alice = await register('flame-alice@example.com');
  const bob = await register('flame-bob@example.com');
  const initial = (await request('/api/state', undefined, alice.cookie)).body.settings[0];
  const { id, version, flame, ...semester } = initial;
  const custom = { ...flame, speed: 1.1, coreRatio: 0.6, animated: false };
  const change = (v, data) => ({ collection: 'settings', id: 'main', expectedVersion: v, data });
  const saved = await mutate(alice.cookie, [change(1, { ...semester, flame: custom })]);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.settings[0].flame, custom);
  assert.deepEqual(
    (await request('/api/state', undefined, bob.cookie)).body.settings[0].flame,
    flame,
  );
  const mutationId = randomUUID();
  const legacy = [change(2, { ...semester, semesterWeeks: 18 })];
  const modified = await mutate(alice.cookie, legacy, mutationId);
  assert.equal(modified.status, 200);
  assert.equal(modified.body.settings[0].semesterWeeks, 18);
  assert.deepEqual(modified.body.settings[0].flame, custom);
  const replay = await mutate(alice.cookie, legacy, mutationId);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.revision, modified.body.revision);
  assert.equal(
    (await mutate(alice.cookie, [change(3, { ...semester, flame: { ...custom, pixelSize: 100 } })]))
      .status,
    400,
  );
  assert.equal((await mutate(alice.cookie, [change(2, { ...semester, flame })])).status, 409);
  const after = (await request('/api/state', undefined, alice.cookie)).body.settings[0];
  assert.deepEqual(after.flame, custom);
  assert.equal(after.semesterWeeks, 18);
});

test('grove timers use server time, pause honestly, synchronize and grant a reward exactly once', async (t) => {
  let clock = 1800000000000;
  const { register, request } = await setup(t, true, { groveNow: () => clock });
  assert.equal((await request('/api/grove')).status, 401);
  const alice = await register('grove-alice');
  const bob = await register('grove-bob');
  const action = (body, cookie = alice.cookie) => request('/api/grove/action', body, cookie);
  const start = {
    type: 'start',
    minutes: 25,
    label: '读一章书',
    expectedVersion: 0,
    actionId: randomUUID(),
  };
  const begun = await action(start);
  assert.equal(begun.status, 200);
  const sessionId = begun.body.state.session.id;
  assert.equal(begun.body.state.session.endsAt, clock + 25 * 60000);
  clock += 10_000;
  assert.equal((await action(start)).body.state.version, 1);
  assert.equal((await action({ ...start, minutes: 60 })).status, 409);
  assert.equal(
    (
      await action({
        type: 'claim',
        sessionId,
        expectedVersion: 1,
        actionId: randomUUID(),
        serverNow: clock + 99999999,
      })
    ).status,
    409,
  );
  assert.equal((await request('/api/grove', undefined, bob.cookie)).body.state.session, null);
  const login = await request('/api/auth/login', {
    account: 'grove-alice',
    password: 'test-password-123',
  });
  assert.equal(
    (await request('/api/grove', undefined, login.cookie)).body.state.session.id,
    sessionId,
  );
  clock += 590_000;
  const pause = await action({
    type: 'pause',
    sessionId,
    expectedVersion: 1,
    actionId: randomUUID(),
  });
  assert.equal(pause.body.state.session.remainingMs, 15 * 60000);
  clock += 3_600_000;
  assert.equal(
    (await action({ type: 'claim', sessionId, expectedVersion: 2, actionId: randomUUID() })).status,
    409,
  );
  const resumed = await action(
    { type: 'resume', sessionId, expectedVersion: 2, actionId: randomUUID() },
    login.cookie,
  );
  assert.equal(resumed.body.state.session.endsAt, clock + 15 * 60000);
  clock += 15 * 60000 - 1;
  const claim = { type: 'claim', sessionId, expectedVersion: 3, actionId: randomUUID() };
  assert.equal((await action(claim)).status, 409);
  clock++;
  const contenders = [claim, { ...claim, actionId: randomUUID() }];
  const results = await Promise.all(contenders.map((input) => action(input)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const winner = contenders[results.findIndex((r) => r.status === 200)];
  const replay = await action(winner);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.state.acorns, 50);
  assert.equal(replay.body.state.completedSessions, 1);
  assert.equal(replay.body.state.totalMinutes, 25);
  assert.equal(replay.body.state.materials.seed, 1);
  assert.equal(replay.body.state.history.length, 1);
  assert.equal(replay.body.state.session, null);
  assert.equal((await request('/api/grove', undefined, bob.cookie)).body.state.acorns, 0);
});

test('grove shop exchanges earned rewards atomically, owns items privately and preserves task data', async (t) => {
  let clock = 1800000000000;
  const { register, request, dataDir, databaseUrl, databaseSchema } = await setup(t, true, {
    groveNow: () => clock,
  });
  const user = await register('grove-shop');
  let state = (await request('/api/grove', undefined, user.cookie)).body.state;
  const action = async (body) => {
    const result = await request(
      '/api/grove/action',
      { actionId: randomUUID(), expectedVersion: state.version, ...body },
      user.cookie,
    );
    if (result.body.state) state = result.body.state;
    return result;
  };
  const original = (await request('/api/state', undefined, user.cookie)).body;
  assert.equal((await action({ type: 'buy', itemId: 'snow' })).status, 409);
  for (const minutes of [0, 181, 1.5])
    assert.equal((await action({ type: 'start', minutes, label: '' })).status, 400);
  for (let i = 0; i < 3; i++) {
    assert.equal((await action({ type: 'start', minutes: 25, label: '专注工作' })).status, 200);
    const sessionId = state.session.id;
    clock += 25 * 60000;
    assert.equal((await action({ type: 'claim', sessionId })).status, 200);
  }
  assert.equal(state.acorns, 150);
  assert.deepEqual(state.materials, { seed: 1, amber: 1, moonstone: 1 });
  const requests = ['treehouse', 'dusk'].map((itemId) => ({
    type: 'buy',
    itemId,
    expectedVersion: state.version,
    actionId: randomUUID(),
  }));
  const race = await Promise.all(
    requests.map((body) => request('/api/grove/action', body, user.cookie)),
  );
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  state = (await request('/api/grove', undefined, user.cookie)).body.state;
  const second = requests[race.findIndex((r) => r.status === 409)].itemId;
  assert.equal((await action({ type: 'buy', itemId: second })).status, 200);
  assert.equal(state.acorns, 20);
  assert.equal(state.materials.amber, 0);
  assert.equal(state.materials.moonstone, 0);
  assert.equal((await action({ type: 'buy', itemId: 'treehouse' })).status, 409);
  assert.equal((await action({ type: 'equip', itemId: 'sun', enabled: true })).status, 409);
  assert.equal((await action({ type: 'buy', itemId: 'fake', acorns: -10000 })).status, 400);
  assert.equal((await action({ type: 'equip', itemId: 'ember', enabled: true })).status, 200);
  assert.equal(state.skin, 'ember');
  assert.equal((await action({ type: 'buy', itemId: 'lanterns' })).status, 200);
  assert.equal(state.acorns, 0);
  assert.deepEqual(state.decorations, ['lanterns']);
  assert.equal((await action({ type: 'equip', itemId: 'lanterns', enabled: false })).status, 200);
  assert.deepEqual(state.decorations, []);
  const cancelled = await action({ type: 'start', minutes: 1, label: '这次先休息' });
  assert.equal(cancelled.status, 200);
  assert.equal((await action({ type: 'cancel', sessionId: state.session.id })).status, 200);
  assert.equal(state.completedSessions, 3);
  assert.deepEqual((await request('/api/state', undefined, user.cookie)).body, original);
  const restarted = await createApp({
    dataDir,
    databaseUrl,
    databaseSchema,
    disableRateLimit: true,
  });
  t.after(() => restarted.db.close());
  const restored = await restarted.db.read((c) =>
    c.get('SELECT data FROM groves WHERE user_id=?', user.body.user.id),
  );
  assert.deepEqual(JSON.parse(restored.data), state);
});
