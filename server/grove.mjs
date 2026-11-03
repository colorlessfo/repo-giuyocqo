import { createHash } from 'node:crypto';
import { groveActionSchema, newGrove, applyGroveAction, GroveError } from '../shared/grove.mjs';

export function installGrove(app, { db, requireAuth, limiter, now = Date.now }) {
  const load = async (c, userId) => {
    const row = await c.get('SELECT data FROM groves WHERE user_id=?', userId);
    return row ? JSON.parse(row.data) : newGrove();
  };
  app.get('/api/grove', requireAuth, async (req, res, next) => {
    try {
      res.json({ state: await db.read((c) => load(c, req.user.id)), serverNow: now() });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/grove/action', requireAuth, limiter(90, 60000), async (req, res, next) => {
    try {
      const input = groveActionSchema.parse(req.body);
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const key = `grove:${input.actionId}`;
      const result = await db.write(req.user.id, async (c) => {
        const current = await load(c, req.user.id);
        const replay = await c.get(
          'SELECT payload_hash FROM mutations WHERE user_id=? AND id=?',
          req.user.id,
          key,
        );
        if (replay && replay.payload_hash === hash) return { status: 200, state: current };
        if (replay || input.expectedVersion !== current.version)
          return {
            status: 409,
            state: current,
            error: '另一台设备更新了树屋进度，已刷新，请再操作一次。',
          };
        try {
          const state = applyGroveAction(current, input, now());
          await c.run(
            'INSERT INTO groves(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',
            req.user.id,
            JSON.stringify(state),
          );
          await c.run('INSERT INTO mutations VALUES(?,?,?,?)', req.user.id, key, hash, now());
          return { status: 200, state };
        } catch (error) {
          if (error instanceof GroveError)
            return { status: error.status, state: current, error: error.message };
          throw error;
        }
      });
      res
        .status(result.status)
        .json({
          state: result.state,
          serverNow: now(),
          ...(result.error ? { error: result.error } : {}),
        });
    } catch (error) {
      next(error);
    }
  });
}
