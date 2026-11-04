import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusAnalytics } from '../shared/focus.mjs';

function record(start, end, status = 'completed') {
  return {
    id: 'r',
    status,
    endedAt: Date.parse(end),
    segments: [{ start: Date.parse(start), end: Date.parse(end) }],
  };
}
test('focus charts split real elapsed time at local midnight, half-hour zones and daylight-saving changes', () => {
  const china = focusAnalytics(
    [record('2026-11-03T15:55:00Z', '2026-11-03T16:20:00Z')],
    null,
    Date.parse('2026-11-03T17:00:00Z'),
    'Asia/Shanghai',
  );
  assert.equal(china.days.at(-2).focusedMs, 5 * 60000);
  assert.equal(china.days.at(-1).focusedMs, 20 * 60000);
  assert.equal(china.days.at(-1).completedSessions, 1);
  assert.equal(china.totalMs, 25 * 60000);
  const nepal = focusAnalytics(
    [record('2026-11-03T18:05:00Z', '2026-11-03T18:25:00Z')],
    null,
    Date.parse('2026-11-03T19:00:00Z'),
    'Asia/Kathmandu',
  );
  assert.equal(nepal.days.at(-2).focusedMs, 10 * 60000);
  assert.equal(nepal.days.at(-1).focusedMs, 10 * 60000);
  const dst = focusAnalytics(
    [record('2026-11-01T05:30:00Z', '2026-11-01T07:30:00Z')],
    null,
    Date.parse('2026-11-01T09:00:00Z'),
    'America/New_York',
  );
  assert.equal(dst.days.at(-1).focusedMs, 120 * 60000);
  assert.equal(dst.periods[0].focusedMs, 120 * 60000);
});
test('analytics keeps partial efforts, clips a running timer at its deadline and excludes paused gaps', () => {
  const paused = {
    id: 'a',
    status: 'running',
    runStartedAt: Date.parse('2026-11-04T02:00:00Z'),
    endsAt: Date.parse('2026-11-04T02:15:00Z'),
    segments: [
      { start: Date.parse('2026-11-04T00:00:00Z'), end: Date.parse('2026-11-04T00:10:00Z') },
    ],
  };
  const partial = record('2026-11-04T03:00:00Z', '2026-11-04T03:02:00Z', 'cancelled');
  const stats = focusAnalytics([partial], paused, Date.parse('2026-11-04T04:00:00Z'), 'UTC');
  assert.equal(stats.totalMs, 27 * 60000);
  assert.equal(stats.cancelledSessions, 1);
  assert.equal(stats.completedSessions, 0);
  assert.equal(
    stats.periods.reduce((sum, p) => sum + p.focusedMs, 0),
    27 * 60000,
  );
});
