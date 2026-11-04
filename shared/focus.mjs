import { z } from 'zod';
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const segmentSchema = z.object({ start: count, end: count }).refine((v) => v.end >= v.start);
export const focusSessionSchema = z.object({
  id: z.uuid(),
  label: z.string().max(120),
  minutes: z.number().int().min(1).max(480),
  status: z.enum(['running', 'paused', 'completed', 'cancelled']),
  startedAt: count,
  endedAt: count.nullable(),
  endsAt: count.nullable(),
  runStartedAt: count.nullable(),
  remainingMs: z
    .number()
    .min(0)
    .max(480 * 60000),
  segments: z.array(segmentSchema).max(5000),
});
export const focusProfileSchema = z.object({
  version: count,
  active: focusSessionSchema.nullable(),
});
export const focusSnapshotSchema = z.object({
  profile: focusProfileSchema,
  records: z.array(focusSessionSchema).max(50),
  serverNow: count,
  timezone: z.string(),
  stats: z.object({
    totalMs: count,
    completedSessions: count,
    cancelledSessions: count,
    completedMs: count,
    days: z
      .array(z.object({ date: z.string(), focusedMs: count, completedSessions: count }))
      .length(31),
    periods: z.array(z.object({ label: z.string(), focusedMs: count })).length(4),
  }),
});
const base = { actionId: z.uuid(), expectedVersion: count };
export const focusActionSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('start'),
    minutes: z.number().int().min(1).max(480),
    label: z.string().trim().max(120).default(''),
  }),
  ...['pause', 'resume', 'cancel', 'finish'].map((type) =>
    z.object({ ...base, type: z.literal(type), sessionId: z.uuid() }),
  ),
]);
export const newFocusProfile = () => ({ version: 0, active: null });
export function focusRemaining(session, now) {
  if (!session || ['completed', 'cancelled'].includes(session.status))
    return session?.remainingMs || 0;
  return Math.max(0, session.status === 'paused' ? session.remainingMs : session.endsAt - now);
}
export function focusSegments(session, now) {
  if (!session) return [];
  const segments = [...session.segments];
  if (session.status === 'running' && session.runStartedAt !== null)
    segments.push({
      start: session.runStartedAt,
      end: Math.max(session.runStartedAt, Math.min(now, session.endsAt)),
    });
  return segments;
}
export function focusedMs(session, now) {
  return focusSegments(session, now).reduce((sum, s) => sum + s.end - s.start, 0);
}
export class FocusError extends Error {
  constructor(message) {
    super(message);
  }
}
export function applyFocusAction(current, input, now) {
  const profile = structuredClone(current),
    session = profile.active;
  let record = null;
  const fail = (message) => {
    throw new FocusError(message);
  };
  if (input.type === 'start') {
    if (session) fail('已有一段专注，请先继续或结束它。');
    profile.active = {
      id: input.actionId,
      label: input.label || '点亮火把，专注当下',
      minutes: input.minutes,
      startedAt: now,
      endedAt: null,
      endsAt: now + input.minutes * 60000,
      remainingMs: input.minutes * 60000,
      runStartedAt: now,
      segments: [],
      status: 'running',
    };
  } else {
    if (!session || input.sessionId !== session.id)
      fail('这段专注已在另一台设备处理，已更新进度。');
    const remaining = focusRemaining(session, now);
    if (input.type === 'resume') {
      if (session.status !== 'paused') fail('这段专注正在进行。');
      session.endsAt = now + session.remainingMs;
      session.runStartedAt = now;
      session.status = 'running';
    } else {
      if (input.type === 'finish' && (session.status !== 'running' || remaining > 0))
        fail('倒计时结束后才会记为完成。');
      if (input.type === 'pause' && (session.status !== 'running' || !remaining))
        fail('这段专注已经暂停或结束，请刷新进度。');
      const endedAt = session.status === 'running' ? Math.min(now, session.endsAt) : now;
      session.segments = focusSegments(session, now);
      session.remainingMs = remaining;
      session.runStartedAt = null;
      session.endsAt = null;
      if (input.type === 'pause') session.status = 'paused';
      else {
        session.status = remaining === 0 ? 'completed' : 'cancelled';
        session.endedAt = endedAt;
        record = session;
        profile.active = null;
      }
    }
  }
  profile.version++;
  return { profile, record };
}
export function safeTimezone(value) {
  const zone = typeof value === 'string' && value.length <= 80 ? value : 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(0);
    return zone;
  } catch {
    return 'UTC';
  }
}
export function focusAnalytics(records, active, now, timezone, lifetime) {
  timezone = safeTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  function local(time) {
    const p = Object.fromEntries(
      formatter.formatToParts(time).map((part) => [part.type, part.value]),
    );
    return {
      date: `${p.year}-${p.month}-${p.day}`,
      hour: Number(p.hour),
      minute: Number(p.minute),
      second: Number(p.second),
    };
  }
  const today = local(now).date;
  const days = Array.from({ length: 31 }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (30 - i));
    return { date: d.toISOString().slice(0, 10), focusedMs: 0, completedSessions: 0 };
  });
  const byDay = new Map(days.map((day) => [day.date, day]));
  const periods = ['凌晨 00–06', '上午 06–12', '下午 12–18', '夜晚 18–24'].map((label) => ({
    label,
    focusedMs: 0,
  }));
  for (const record of [...records, ...(active ? [active] : [])]) {
    if (record.status === 'completed' && record.endedAt !== null) {
      const day = byDay.get(local(record.endedAt).date);
      if (day) day.completedSessions++;
    }
    for (const interval of focusSegments(record, now)) {
      // Hour-sized slices respect local midnight, non-whole-hour time zones and DST.
      let at = Math.max(interval.start, now - 33 * 86400000);
      while (at < interval.end) {
        const p = local(at),
          until = Math.min(
            interval.end,
            at + 3600000 - p.minute * 60000 - p.second * 1000 - (at % 1000),
          );
        const day = byDay.get(p.date);
        if (day) {
          day.focusedMs += until - at;
          periods[Math.floor(p.hour / 6)].focusedMs += until - at;
        }
        at = until;
      }
    }
  }
  const totals =
    lifetime ||
    records.reduce(
      (sum, r) => {
        const ms = focusedMs(r, now);
        sum.totalMs += ms;
        if (r.status === 'completed') {
          sum.completedSessions++;
          sum.completedMs += ms;
        } else if (r.status === 'cancelled') sum.cancelledSessions++;
        return sum;
      },
      { totalMs: 0, completedSessions: 0, cancelledSessions: 0, completedMs: 0 },
    );
  return { ...totals, totalMs: totals.totalMs + focusedMs(active, now), days, periods };
}
