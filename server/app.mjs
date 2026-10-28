import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { schemas, changeSchema } from '../shared/validation.mjs';
import { createDatabase } from './database.mjs';

const scrypt = promisify(scryptCallback);
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const text = (max) => z.string().trim().max(max);
export function defaultSettings() {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  return {
    semesterStart: key,
    semesterWeeks: 20,
    periods: [
      { label: '第1节', start: '08:00', end: '08:45' },
      { label: '第2节', start: '08:55', end: '09:40' },
      { label: '第3节', start: '10:00', end: '10:45' },
      { label: '第4节', start: '10:55', end: '11:40' },
      { label: '第5节', start: '14:00', end: '14:45' },
      { label: '第6节', start: '14:55', end: '15:40' },
      { label: '第7节', start: '16:00', end: '16:45' },
      { label: '第8节', start: '16:55', end: '17:40' },
      { label: '第9节', start: '19:00', end: '19:45' },
      { label: '第10节', start: '19:55', end: '20:40' },
    ],
  };
}

export async function createApp({
  dataDir = process.env.DATA_DIR || './data',
  databaseUrl = process.env.DATABASE_URL,
  databaseSchema = 'qiyu',
  disableRateLimit = false,
} = {}) {
  const db = await createDatabase({ dataDir, databaseUrl, schema: databaseSchema });
  const app = express();
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc:
            process.env.NODE_ENV === 'production'
              ? ["'self'", "'wasm-unsafe-eval'"]
              : ["'self'", "'wasm-unsafe-eval'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          workerSrc: ["'self'", 'blob:'],
          connectSrc:
            process.env.NODE_ENV === 'production' ? ["'self'"] : ["'self'", 'ws:', 'wss:'],
          upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: process.env.NODE_ENV === 'production' ? undefined : false,
    }),
  );
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const expectedOrigin = process.env.PUBLIC_URL
        ? new URL(process.env.PUBLIC_URL).origin
        : `${req.protocol}://${req.get('host')}`;
      if ((origin && origin !== expectedOrigin) || req.get('sec-fetch-site') === 'cross-site')
        return res.status(403).json({ error: '请从奇遇 DDL 网站内操作。' });
      if (!req.is('application/json')) return res.status(415).json({ error: '请求格式无效。' });
    }
    next();
  });
  const limiter = (limit, windowMs) =>
    disableRateLimit
      ? (_req, _res, next) => next()
      : rateLimit({
          windowMs,
          limit,
          standardHeaders: 'draft-8',
          legacyHeaders: false,
          message: { error: '操作太频繁，请稍后再试。' },
        });
  const authLimit = limiter(15, 15 * 60000);
  app.get('/api/health', async (_req, res) => {
    await db.read((c) => c.get('SELECT 1'));
    res.json({ status: 'ok', name: '奇遇 DDL', database: db.kind });
  });
  app.get('/api/capabilities', (_req, res) =>
    res.json({ passwordAuth: true, phoneAuth: false, pushNotifications: false }),
  );
  const publicUser = (row) => ({
    id: row.id,
    account: row.account,
    email: row.account.includes('@') ? row.account : null,
    name: row.name,
  });
  async function newSession(c, res, userId) {
    await c.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    const token = randomBytes(32).toString('base64url');
    await c.run(
      'INSERT INTO sessions VALUES (?,?,?)',
      hashToken(token),
      userId,
      Date.now() + 30 * 86400000,
    );
    res.cookie('qiyu_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
      sameSite: 'lax',
      maxAge: 30 * 86400000,
      path: '/',
    });
  }
  const credentials = z
    .object({
      account: z.string().max(254).optional(),
      email: z.string().max(254).optional(),
      password: z.string().min(10).max(128),
      name: text(40).optional(),
    })
    .transform((v) => ({
      ...v,
      account: (v.account ?? v.email ?? '').trim().normalize('NFKC').toLowerCase(),
    }))
    .refine(
      (v) => /^[\p{L}\p{N}_.-]{3,40}$/u.test(v.account) || z.email().safeParse(v.account).success,
      '账号需为3–40位文字、数字、下划线、点或短横线；原邮箱账号也可继续使用。',
    );

  app.post('/api/auth/register', authLimit, async (req, res, next) => {
    try {
      const input = credentials.parse(req.body),
        salt = randomBytes(16).toString('hex'),
        userId = randomUUID();
      const hash = await scrypt(input.password, salt, 64);
      const user = await db.write(userId, async (c) => {
        await c.run(
          'INSERT INTO users(id,account,name,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)',
          userId,
          input.account,
          input.name || input.account.split('@')[0],
          salt,
          hash.toString('hex'),
          Date.now(),
        );
        await c.run(
          'INSERT INTO entities VALUES (?,?,?,?,?)',
          userId,
          'settings',
          'main',
          JSON.stringify(defaultSettings()),
          1,
        );
        for (const [name, color] of [
          ['学习', 'violet'],
          ['生活', 'peach'],
          ['工作', 'blue'],
        ])
          await c.run(
            'INSERT INTO entities VALUES (?,?,?,?,?)',
            userId,
            'categories',
            randomUUID(),
            JSON.stringify({ name, color }),
            1,
          );
        await newSession(c, res, userId);
        return publicUser(await c.get('SELECT * FROM users WHERE id=?', userId));
      });
      res.status(201).json({ user });
    } catch (err) {
      if (err.code === '23505' || String(err).includes('UNIQUE'))
        return res.status(409).json({ error: '这个账号已经注册，请换一个账号或直接登录。' });
      next(err);
    }
  });
  app.post('/api/auth/login', authLimit, async (req, res, next) => {
    try {
      const input = credentials.parse(req.body);
      const row = await db.read((c) => c.get('SELECT * FROM users WHERE account=?', input.account));
      const hash = await scrypt(input.password, row?.salt || 'missing-account-salt', 64);
      if (!row || !timingSafeEqual(hash, Buffer.from(row.password_hash, 'hex')))
        return res.status(401).json({ error: '账号或密码不正确。' });
      const user = await db.write(row.id, async (c) => {
        const current = await c.get('SELECT * FROM users WHERE id=?', row.id);
        if (current.password_hash !== row.password_hash) return null;
        await newSession(c, res, row.id);
        return publicUser(current);
      });
      if (!user) return res.status(401).json({ error: '密码已发生变化，请重新登录。' });
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });
  async function requireAuth(req, res, next) {
    try {
      const token = req.cookies.qiyu_session;
      const user =
        token &&
        (await db.read((c) =>
          c.get(
            'SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',
            hashToken(token),
            Date.now(),
          ),
        ));
      if (!user)
        return res.status(401).json({ error: '请先登录，未同步的修改会保留在这台设备上。' });
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  }
  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
  app.post('/api/auth/logout', async (req, res) => {
    if (req.cookies.qiyu_session)
      await db.write(null, (c) =>
        c.run('DELETE FROM sessions WHERE token_hash=?', hashToken(req.cookies.qiyu_session)),
      );
    res.clearCookie('qiyu_session', { path: '/' });
    res.json({ ok: true });
  });
  app.post('/api/auth/password', requireAuth, authLimit, async (req, res, next) => {
    try {
      const body = z
        .object({ oldPassword: z.string().max(128), newPassword: z.string().min(10).max(128) })
        .parse(req.body);
      const salt = randomBytes(16).toString('hex'),
        hash = await scrypt(body.newPassword, salt, 64);
      const ok = await db.write(req.user.id, async (c) => {
        const current = await c.get('SELECT * FROM users WHERE id=?', req.user.id);
        const oldHash = await scrypt(body.oldPassword, current.salt, 64);
        if (!timingSafeEqual(oldHash, Buffer.from(current.password_hash, 'hex'))) return false;
        await c.run(
          'UPDATE users SET salt=?,password_hash=? WHERE id=?',
          salt,
          hash.toString('hex'),
          req.user.id,
        );
        await c.run('DELETE FROM sessions WHERE user_id=?', req.user.id);
        await newSession(c, res, req.user.id);
        return true;
      });
      if (!ok) return res.status(403).json({ error: '原密码不正确。' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  async function snapshot(c, userId) {
    const row = await c.get('SELECT revision FROM users WHERE id=?', userId);
    const state = { tasks: [], categories: [], courses: [], settings: [], revision: row.revision };
    const versions = {};
    for (const row of await c.all(
      'SELECT collection,id,data,version FROM entities WHERE user_id=?',
      userId,
    )) {
      versions[`${row.collection}/${row.id}`] = row.version;
      if (row.data !== null)
        state[row.collection].push({ ...JSON.parse(row.data), id: row.id, version: row.version });
    }
    return { ...state, versions };
  }
  app.get('/api/state', requireAuth, async (req, res) =>
    res.json(await db.read((c) => snapshot(c, req.user.id))),
  );
  app.post('/api/changes', requireAuth, limiter(180, 60000), async (req, res, next) => {
    try {
      const body = z
        .object({ mutationId: z.uuid(), changes: z.array(changeSchema).min(1).max(1000) })
        .parse(req.body);
      const seen = new Set();
      for (const change of body.changes) {
        const key = `${change.collection}/${change.id}`;
        if (seen.has(key))
          return res.status(400).json({ error: '同一项不能在一次保存中重复出现。' });
        seen.add(key);
        if (change.collection === 'settings' && (change.id !== 'main' || change.data === null))
          return res.status(400).json({ error: '学期设置不能删除。' });
        if (change.data !== null) change.data = schemas[change.collection].parse(change.data);
      }
      const payloadHash = hashToken(JSON.stringify(body.changes));
      const result = await db.write(req.user.id, async (c) => {
        const replay = await c.get(
          'SELECT payload_hash FROM mutations WHERE user_id=? AND id=?',
          req.user.id,
          body.mutationId,
        );
        if (replay) {
          if (replay.payload_hash !== payloadHash)
            return { status: 409, body: { error: '保存标识已被使用，请重新同步。' } };
          return { status: 200, body: await snapshot(c, req.user.id) };
        }
        const conflicts = [];
        for (const change of body.changes) {
          const old = await c.get(
            'SELECT version FROM entities WHERE user_id=? AND collection=? AND id=?',
            req.user.id,
            change.collection,
            change.id,
          );
          if ((old?.version || 0) !== change.expectedVersion)
            conflicts.push(`${change.collection}/${change.id}`);
        }
        if (conflicts.length)
          return {
            status: 409,
            body: {
              error: '另一台设备修改了相同内容，请选择保留哪个版本。',
              conflicts,
              state: await snapshot(c, req.user.id),
            },
          };
        const upsert =
          'INSERT INTO entities VALUES (?,?,?,?,?) ON CONFLICT(user_id,collection,id) DO UPDATE SET data=excluded.data,version=excluded.version';
        for (const change of body.changes)
          await c.run(
            upsert,
            req.user.id,
            change.collection,
            change.id,
            change.data === null ? null : JSON.stringify(change.data),
            change.expectedVersion + 1,
          );
        const validCategories = new Set(
          (
            await c.all(
              "SELECT id FROM entities WHERE user_id=? AND collection='categories' AND data IS NOT NULL",
              req.user.id,
            )
          ).map((r) => r.id),
        );
        for (const row of await c.all(
          "SELECT id,data,version FROM entities WHERE user_id=? AND collection='tasks' AND data IS NOT NULL",
          req.user.id,
        )) {
          const task = JSON.parse(row.data);
          if (task.categoryId && !validCategories.has(task.categoryId)) {
            task.categoryId = null;
            await c.run(
              upsert,
              req.user.id,
              'tasks',
              row.id,
              JSON.stringify(task),
              row.version + 1,
            );
          }
        }
        await c.run('UPDATE users SET revision=revision+1 WHERE id=?', req.user.id);
        await c.run(
          'INSERT INTO mutations VALUES (?,?,?,?)',
          req.user.id,
          body.mutationId,
          payloadHash,
          Date.now(),
        );
        return { status: 200, body: await snapshot(c, req.user.id) };
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));
  app.use((err, _req, res, _next) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: '请检查输入内容。',
        details: err.issues.map((x) => `${x.path.join('.')}: ${x.message}`).slice(0, 8),
      });
    if (err.type === 'entity.too.large')
      return res.status(413).json({ error: '导入的数据过大，请分批导入。' });
    if (err instanceof SyntaxError) return res.status(400).json({ error: '数据格式不正确。' });
    console.error('Request failed:', err.code || err.name);
    res.status(500).json({ error: '保存暂时失败，修改已保留，请稍后重试。' });
  });
  return { app, db };
}
