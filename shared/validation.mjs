import { z } from 'zod';
const text = (max) => z.string().trim().max(max);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const date = new Date(`${v}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
  }, '日期无效');
export const entityId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const palettes = z.enum(['violet', 'blue', 'peach', 'rose', 'slate']);
export const schemas = {
  tasks: z.object({
    title: text(200).min(1),
    notes: text(10000).default(''),
    dueAt: z.iso.datetime({ offset: true }),
    durationMinutes: z.number().int().min(1).max(525600),
    categoryId: entityId.nullable(),
    mascot: z.enum(['star', 'cloud', 'moon', 'bunny']),
    completed: z.boolean(),
    completedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  }),
  categories: z.object({ name: text(40).min(1), color: palettes }),
  courses: z
    .object({
      title: text(200).min(1),
      weekday: z.number().int().min(1).max(7),
      startTime: clock,
      endTime: clock,
      startWeek: z.number().int().min(1).max(60),
      endWeek: z.number().int().min(1).max(60),
      parity: z.enum(['all', 'odd', 'even']),
      location: text(200).default(''),
      exceptions: z.array(day).max(200).default([]),
    })
    .refine((v) => v.startWeek <= v.endWeek && v.startTime < v.endTime, '课程时间或周次范围无效'),
  settings: z.object({
    semesterStart: day.refine(
      (v) => new Date(`${v}T12:00:00Z`).getUTCDay() === 1,
      '第一周起始日须为周一',
    ),
    semesterWeeks: z.number().int().min(1).max(60),
    periods: z
      .array(
        z
          .object({ label: text(20).min(1), start: clock, end: clock })
          .refine((v) => v.start < v.end),
      )
      .min(1)
      .max(24),
  }),
};
export const changeSchema = z.object({
  collection: z.enum(['tasks', 'categories', 'courses', 'settings']),
  id: entityId,
  expectedVersion: z.number().int().min(0),
  data: z.unknown().nullable(),
});
export function validateSnapshot(input) {
  if (!input || typeof input !== 'object') throw new Error('数据结构不完整。');
  const state = {
    tasks: [],
    categories: [],
    courses: [],
    settings: [],
    revision: Number.isSafeInteger(input.revision) ? input.revision : 0,
    versions: {},
  };
  const seen = new Set();
  for (const collection of ['tasks', 'categories', 'courses', 'settings']) {
    if (!Array.isArray(input[collection]) || input[collection].length > 10000)
      throw new Error('数据结构不完整或超过单项上限。');
    for (const item of input[collection]) {
      const data = schemas[collection].parse(item),
        id = entityId.parse(item.id);
      const key = `${collection}/${id}`;
      if (seen.has(key)) throw new Error('存在重复记录。');
      seen.add(key);
      const version = Number.isSafeInteger(item.version) && item.version >= 0 ? item.version : 0;
      state[collection].push({ ...data, id, version });
      state.versions[key] = version;
    }
  }
  if (state.settings.length !== 1 || state.settings[0].id !== 'main')
    throw new Error('学期设置不完整。');
  if (input.versions && typeof input.versions === 'object')
    for (const [key, version] of Object.entries(input.versions)) {
      if (
        /^(tasks|categories|courses|settings)\/[a-zA-Z0-9_-]{1,100}$/.test(key) &&
        Number.isSafeInteger(version) &&
        version >= 0
      )
        state.versions[key] = version;
    }
  return state;
}
