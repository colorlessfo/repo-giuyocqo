import { addDays, format, startOfDay, startOfWeek } from 'date-fns';
import type { Course, Entity, Settings, State, Task } from './types';
import { courseOccursOn } from '../shared/time.mjs';

export const uid = () => crypto.randomUUID();
export const dateKey = (date: Date) => format(date, 'yyyy-MM-dd');
export const localInput = (date: Date | string) => format(new Date(date), "yyyy-MM-dd'T'HH:mm");
export const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export function stripEntity<T extends Entity>(item: T): Record<string, unknown> {
  const { id: _id, version: _version, ...data } = item;
  return data;
}
export function durationLabel(minutes: number) {
  const days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60),
    mins = minutes % 60;
  return (
    [days ? `${days}天` : '', hours ? `${hours}小时` : '', mins ? `${mins}分钟` : '']
      .filter(Boolean)
      .join('') || '0分钟'
  );
}
export function countdown(due: string, now: number) {
  const difference = new Date(due).getTime() - now;
  const minutes = Math.ceil(Math.abs(difference) / 60000);
  const label =
    minutes >= 1440
      ? `${Math.floor(minutes / 1440)}天${Math.floor((minutes % 1440) / 60)}小时`
      : minutes >= 60
        ? `${Math.floor(minutes / 60)}小时${minutes % 60}分`
        : `${minutes}分钟`;
  return difference < 0 ? `已逾期 ${label}` : difference < 60000 ? '即将截止' : `还剩 ${label}`;
}
export function makeSettings(): Settings {
  return {
    id: 'main',
    version: 1,
    semesterStart: dateKey(startOfWeek(new Date(), { weekStartsOn: 1 })),
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
export function emptyState(): State {
  return {
    tasks: [],
    categories: [],
    courses: [],
    settings: [makeSettings()],
    revision: 0,
    versions: { 'settings/main': 1 },
  };
}
export function demoState(): State {
  const now = new Date();
  const due = (days: number, hours: number) => {
    const d = addDays(startOfDay(now), days);
    d.setHours(hours, 0, 0, 0);
    return d.toISOString();
  };
  const tasks: Task[] = [
    {
      id: 'demo-design',
      version: 1,
      title: '给好想法，留一个位置',
      notes: '整理这周的灵感，完成一份让自己满意的作品。',
      dueAt: due(1, 18),
      durationMinutes: 180,
      categoryId: 'demo-study',
      mascot: 'star',
      completed: false,
      completedAt: null,
    },
    {
      id: 'demo-reading',
      version: 1,
      title: '读完那本放在床头的书',
      notes: '不用急，一页一页来。',
      dueAt: due(2, 21),
      durationMinutes: 90,
      categoryId: 'demo-life',
      mascot: 'bunny',
      completed: false,
      completedAt: null,
    },
    {
      id: 'demo-report',
      version: 1,
      title: '把课程报告慢慢写好',
      notes: '这是一项超过 4 小时的任务，可以在日程里跨天安排。',
      dueAt: due(3, 10),
      durationMinutes: 600,
      categoryId: 'demo-study',
      mascot: 'cloud',
      completed: false,
      completedAt: null,
    },
  ];
  const state: State = {
    ...emptyState(),
    tasks,
    categories: [
      { id: 'demo-study', version: 1, name: '学习', color: 'violet' },
      { id: 'demo-life', version: 1, name: '生活', color: 'peach' },
      { id: 'demo-work', version: 1, name: '工作', color: 'blue' },
    ],
    courses: [],
  };
  for (const collection of ['tasks', 'categories', 'settings'] as const)
    for (const item of state[collection]) state.versions[`${collection}/${item.id}`] = item.version;
  return state;
}
function escapeICS(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}
function utc(date: Date | string) {
  return new Date(date)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z/, 'Z');
}
export function calendarExport(state: State) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Qiyu DDL//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:奇遇 DDL',
  ];
  const event = (
    id: string,
    title: string,
    start: Date,
    end: Date,
    notes: string,
    location = '',
    reminder = false,
  ) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${id}@qiyu-ddl`,
      `DTSTAMP:${utc(new Date())}`,
      `DTSTART:${utc(start)}`,
      `DTEND:${utc(end)}`,
      `SUMMARY:${escapeICS(title)}`,
      `DESCRIPTION:${escapeICS(notes)}`,
      `LOCATION:${escapeICS(location)}`,
    );
    if (reminder)
      lines.push(
        'BEGIN:VALARM',
        'TRIGGER;RELATED=END:-PT30M',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeICS(title + ' 将在30分钟后截止')}`,
        'END:VALARM',
      );
    lines.push('END:VEVENT');
  };
  state.tasks
    .filter((t) => !t.completed)
    .forEach((t) =>
      event(
        t.id,
        t.title,
        new Date(new Date(t.dueAt).getTime() - t.durationMinutes * 60000),
        new Date(t.dueAt),
        t.notes,
        '',
        true,
      ),
    );
  const settings = state.settings[0];
  for (let offset = 0; offset < settings.semesterWeeks * 7; offset++) {
    const date = addDays(new Date(`${settings.semesterStart}T12:00:00`), offset);
    for (const c of state.courses)
      if (courseOccursOn(c, date, settings))
        event(
          `${c.id}-${dateKey(date)}`,
          `[课程] ${c.title}`,
          new Date(`${dateKey(date)}T${c.startTime}:00`),
          new Date(`${dateKey(date)}T${c.endTime}:00`),
          '课程安排',
          c.location,
        );
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 folds lines at 75 UTF-8 octets, including Chinese text.
  return (
    lines
      .map((line) => {
        let part = '',
          bytes = 0;
        const chunks: string[] = [];
        for (const char of line) {
          const n = new TextEncoder().encode(char).length;
          if (bytes + n > 75) {
            chunks.push(part);
            part = ' ';
            bytes = 1;
          }
          part += char;
          bytes += n;
        }
        chunks.push(part);
        return chunks.join('\r\n');
      })
      .join('\r\n') + '\r\n'
  );
}
export function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function courseSummary(c: Course) {
  return `${weekdayNames[c.weekday - 1]} ${c.startTime}–${c.endTime} · ${c.startWeek}–${c.endWeek}周${c.parity === 'odd' ? '（单周）' : c.parity === 'even' ? '（双周）' : ''}`;
}
