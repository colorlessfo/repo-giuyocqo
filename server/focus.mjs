import { createHash } from 'node:crypto';
import {
  focusActionSchema,
  newFocusProfile,
  applyFocusAction,
  focusedMs,
  focusAnalytics,
  safeTimezone,
  FocusError,
} from '../shared/focus.mjs';

export function installFocus(app, { db, requireAuth, limiter, now = Date.now }) {
  const load = async (c, userId) => {
    const row = await c.get('SELECT data FROM focus_profiles WHERE user_id=?', userId);
    return row ? JSON.parse(row.data) : newFocusProfile();
  };
  async function snapshot(c, userId, zone) {
    const profile = await load(c, userId),
      serverNow = now(),
      timezone = safeTimezone(zone);
    const recent = await c.all(
      'SELECT data FROM focus_history WHERE user_id=? AND ended_at>=? ORDER BY ended_at DESC',
      userId,
      serverNow - 33 * 86400000,
    );
    const records = await c.all(
      'SELECT data FROM focus_history WHERE user_id=? ORDER BY ended_at DESC LIMIT 50',
      userId,
    );
    const row = await c.get(
      "SELECT COALESCE(SUM(focused_ms),0) AS total, COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) AS completed, COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END),0) AS cancelled, COALESCE(SUM(CASE WHEN status='completed' THEN focused_ms ELSE 0 END),0) AS completed_ms FROM focus_history WHERE user_id=?",
      userId,
    );
    const lifetime = {
      totalMs: Number(row.total),
      completedSessions: Number(row.completed),
      cancelledSessions: Number(row.cancelled),
      completedMs: Number(row.completed_ms),
    };
    return {
      profile,
      records: records.map((row) => JSON.parse(row.data)),
      serverNow,
      timezone,
      stats: focusAnalytics(
        recent.map((row) => JSON.parse(row.data)),
        profile.active,
        serverNow,
        timezone,
        lifetime,
      ),
    };
  }
  app.get('/api/focus', requireAuth, async (req, res, next) => {
    try {
      res.json(await db.read((c) => snapshot(c, req.user.id, req.query.timezone)));
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/focus/action', requireAuth, limiter(90, 60000), async (req, res, next) => {
    try {
      const input = focusActionSchema.parse(req.body),
        zone = safeTimezone(req.body.timezone);
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex'),
        key = `focus:${input.actionId}`;
      const result = await db.write(req.user.id, async (c) => {
        const current = await load(c, req.user.id);
        const receipt = await c.get(
          'SELECT payload_hash FROM mutations WHERE user_id=? AND id=?',
          req.user.id,
          key,
        );
        let error = '',
          status = 200;
        if (receipt && receipt.payload_hash !== hash) {
          error = '操作编号已使用，请刷新后再操作。';
          status = 409;
        } else if (!receipt && current.version !== input.expectedVersion) {
          error = '另一台设备更新了专注进度，已为你刷新，请再操作一次。';
          status = 409;
        } else if (!receipt) {
          try {
            const { profile, record } = applyFocusAction(current, input, now());
            await c.run(
              'INSERT INTO focus_profiles VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',
              req.user.id,
              JSON.stringify(profile),
            );
            if (record)
              await c.run(
                'INSERT INTO focus_history VALUES(?,?,?,?,?,?)',
                req.user.id,
                record.id,
                JSON.stringify(record),
                record.endedAt,
                focusedMs(record, now()),
                record.status,
              );
            await c.run('INSERT INTO mutations VALUES(?,?,?,?)', req.user.id, key, hash, now());
          } catch (e) {
            if (e instanceof FocusError) {
              error = e.message;
              status = 409;
            } else throw e;
          }
        }
        return {
          status,
          body: { ...(await snapshot(c, req.user.id, zone)), ...(error ? { error } : {}) },
        };
      });
      res.status(result.status).json(result.body);
    } catch (e) {
      next(e);
    }
  });
}
