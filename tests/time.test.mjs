import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  minuteToY,
  yToMinute,
  taskInterval,
  moveDeadline,
  teachingWeek,
  courseOccursOn,
  DAY_HEIGHT,
} from '../shared/time.mjs';
import { extractCourseText, extractTimetable } from '../shared/ocr.mjs';
import { calendarExport, emptyState } from '../src/lib.ts';
test('compressed time axis remains invertible at midnight, 06:00, and every minute', () => {
  for (let minute = 0; minute <= 1440; minute++)
    assert.ok(Math.abs(yToMinute(minuteToY(minute)) - minute) < 1e-8);
  assert.equal(minuteToY(360), 72);
  assert.equal(minuteToY(420) - minuteToY(360), 58);
  assert.equal(minuteToY(1440), DAY_HEIGHT);
});
test('long tasks and movements preserve duration over midnight and multiple days', () => {
  const task = { dueAt: '2026-10-30T01:00:00Z', durationMinutes: 1800 };
  const { start, end } = taskInterval(task);
  assert.equal(start.toISOString(), '2026-10-28T19:00:00.000Z');
  assert.equal((end - start) / 60000, 1800);
  const moved = moveDeadline(
    task,
    new Date('2026-10-29T00:00:00Z'),
    new Date('2026-10-31T05:30:00Z'),
  );
  const next = taskInterval({ ...task, dueAt: moved });
  assert.equal(next.end.toISOString(), '2026-11-01T06:30:00.000Z');
  assert.equal((next.end - next.start) / 60000, 1800);
});
test('teaching weeks and odd/even repetition are finite, with exclusions', () => {
  const settings = { semesterStart: '2026-10-26', semesterWeeks: 4 };
  const course = { weekday: 1, startWeek: 1, endWeek: 4, parity: 'odd', exceptions: [] };
  assert.equal(teachingWeek(new Date('2026-10-25T12:00:00'), settings.semesterStart), 0);
  assert.equal(teachingWeek(new Date('2026-11-01T12:00:00'), settings.semesterStart), 1);
  assert.equal(teachingWeek(new Date('2026-11-02T12:00:00'), settings.semesterStart), 2);
  assert.equal(courseOccursOn(course, new Date('2026-10-26T12:00:00'), settings), true);
  assert.equal(courseOccursOn(course, new Date('2026-11-02T12:00:00'), settings), false);
  assert.equal(courseOccursOn(course, new Date('2026-11-09T12:00:00'), settings), true);
  assert.equal(courseOccursOn(course, new Date('2026-11-23T12:00:00'), settings), false);
  assert.equal(
    courseOccursOn(
      { ...course, exceptions: ['2026-11-09'] },
      new Date('2026-11-09T12:00:00'),
      settings,
    ),
    false,
  );
});
test('OCR parsing extracts known data and leaves missing time/week information empty', () => {
  const course = extractCourseText('高等数学\n星期二\n08:00–09:40\n1-16周 单周\n教室：A101', []);
  assert.equal(course.title, '高等数学');
  assert.equal(course.weekday, 2);
  assert.equal(course.startTime, '08:00');
  assert.equal(course.endWeek, 16);
  assert.equal(course.parity, 'odd');
  assert.equal(course.location, 'A101');
  const unknown = extractCourseText('大学英语\n教室：B203', []);
  assert.equal(unknown.weekday, null);
  assert.equal(unknown.startTime, '');
  assert.equal(unknown.startWeek, null);
  const period = extractCourseText('大学英语\n第1-2节\n2-12周 双周', [
    { start: '08:00', end: '08:45' },
    { start: '08:55', end: '09:40' },
  ]);
  assert.equal(period.startTime, '08:00');
  assert.equal(period.endTime, '09:40');
  assert.equal(period.parity, 'even');
  assert.deepEqual(extractTimetable('unreadable text', '', []), []);
});
test('calendar export folds Chinese lines, excludes completed tasks and limits teaching weeks', () => {
  const state = emptyState();
  state.settings[0].semesterStart = '2026-10-26';
  state.settings[0].semesterWeeks = 4;
  const long = '很长的一段课程名称与备注'.repeat(20);
  state.tasks = [
    {
      id: 'pending',
      version: 1,
      title: long,
      notes: long,
      dueAt: '2026-10-30T01:00:00Z',
      durationMinutes: 1800,
      completed: false,
      categoryId: null,
      mascot: 'star',
      completedAt: null,
    },
    {
      id: 'done',
      version: 1,
      title: '已完成',
      notes: '',
      dueAt: '2026-10-30T01:00:00Z',
      durationMinutes: 60,
      completed: true,
      categoryId: null,
      mascot: 'star',
      completedAt: null,
    },
  ];
  state.courses = [
    {
      id: 'math',
      version: 1,
      title: '数学',
      weekday: 1,
      startTime: '08:00',
      endTime: '09:00',
      startWeek: 1,
      endWeek: 4,
      parity: 'odd',
      location: 'A101',
      exceptions: [],
    },
  ];
  const ics = calendarExport(state);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.ok(ics.includes('TRIGGER;RELATED=END:-PT30M'));
  assert.ok(!ics.includes('UID:done@'));
  for (const line of ics.split('\r\n'))
    assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${Buffer.byteLength(line)}`);
});
