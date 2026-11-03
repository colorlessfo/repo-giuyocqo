import { z } from 'zod';

// All items use earned in-app rewards. There is no payment or random purchase.
export const GROVE_ITEMS = Object.freeze([
  { id: 'snow', kind: 'skin', name: '霜雪小狐', description: '月光落在雪白的尾巴上。', acorns: 30 },
  {
    id: 'dusk',
    kind: 'skin',
    name: '暮紫小狐',
    description: '披着星河颜色的小小探险家。',
    acorns: 60,
    material: 'moonstone',
    quantity: 1,
  },
  {
    id: 'sun',
    kind: 'skin',
    name: '蜜糖小狐',
    description: '一身暖洋洋的蜂蜜金。',
    acorns: 45,
    material: 'amber',
    quantity: 1,
  },
  {
    id: 'treehouse',
    kind: 'home',
    name: '林间树屋',
    description: '有小窗、木梯和暖灯的新家。',
    acorns: 70,
    material: 'amber',
    quantity: 1,
  },
  {
    id: 'observatory',
    kind: 'home',
    name: '观星小屋',
    description: '把整片夜空装进屋顶。',
    acorns: 110,
    material: 'moonstone',
    quantity: 2,
  },
  {
    id: 'lanterns',
    kind: 'decor',
    name: '南瓜暖灯',
    description: '让每一处枝桠都亮起来。',
    acorns: 20,
    material: 'seed',
    quantity: 1,
  },
  {
    id: 'flowers',
    kind: 'decor',
    name: '月白花藤',
    description: '沿着藤蔓悄悄盛开的白花。',
    acorns: 25,
    material: 'seed',
    quantity: 2,
  },
  {
    id: 'stars',
    kind: 'decor',
    name: '星星挂饰',
    description: '收好夜里捡到的小星光。',
    acorns: 35,
    material: 'moonstone',
    quantity: 1,
  },
]);
export const MATERIALS = Object.freeze({
  seed: '苔光种子',
  amber: '暖光树脂',
  moonstone: '月光石',
});
const id = z.string().uuid();
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const rewardSchema = z.object({
  sessionId: id,
  label: z.string().max(120),
  minutes: z.number().int().min(1).max(180),
  acorns: count,
  material: z.enum(['seed', 'amber', 'moonstone']),
  quantity: count,
  finishedAt: count,
});
export const groveStateSchema = z.object({
  version: count,
  acorns: count,
  totalMinutes: count,
  completedSessions: count,
  materials: z.object({ seed: count, amber: count, moonstone: count }),
  owned: z.array(z.enum(['ember', 'burrow', ...GROVE_ITEMS.map((item) => item.id)])).max(10),
  skin: z.enum(['ember', 'snow', 'dusk', 'sun']),
  home: z.enum(['burrow', 'treehouse', 'observatory']),
  decorations: z.array(z.enum(['lanterns', 'flowers', 'stars'])).max(3),
  session: z
    .object({
      id,
      minutes: z.number().int().min(1).max(180),
      label: z.string().max(120),
      startedAt: count,
      endsAt: count.nullable(),
      remainingMs: z
        .number()
        .min(0)
        .max(180 * 60000),
      status: z.enum(['running', 'paused']),
    })
    .nullable(),
  lastReward: rewardSchema.nullable(),
  history: z.array(rewardSchema).max(40),
});
const base = { actionId: id, expectedVersion: z.number().int().min(0) };
export const groveActionSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('start'),
    minutes: z.number().int().min(1).max(180),
    label: z.string().trim().max(120).default(''),
  }),
  ...['pause', 'resume', 'cancel', 'claim'].map((type) =>
    z.object({ ...base, type: z.literal(type), sessionId: id }),
  ),
  z.object({ ...base, type: z.literal('buy'), itemId: z.string().max(30) }),
  z.object({
    ...base,
    type: z.literal('equip'),
    itemId: z.string().max(30),
    enabled: z.boolean().default(true),
  }),
]);
export function newGrove() {
  return {
    version: 0,
    acorns: 0,
    totalMinutes: 0,
    completedSessions: 0,
    materials: { seed: 0, amber: 0, moonstone: 0 },
    owned: ['ember', 'burrow'],
    skin: 'ember',
    home: 'burrow',
    decorations: [],
    session: null,
    lastReward: null,
    history: [],
  };
}
export function focusRemaining(session, now) {
  if (!session) return 0;
  return Math.max(0, session.status === 'paused' ? session.remainingMs : session.endsAt - now);
}
export class GroveError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}
export function applyGroveAction(current, input, now) {
  const state = structuredClone(current);
  const fail = (message) => {
    throw new GroveError(message);
  };
  const session = state.session;
  if (input.type === 'start') {
    if (session) fail('已有一段专注，请先继续、领取或结束它。');
    state.session = {
      id: input.actionId,
      minutes: input.minutes,
      label: input.label || '和小狐狸一起专注',
      startedAt: now,
      endsAt: now + input.minutes * 60000,
      remainingMs: input.minutes * 60000,
      status: 'running',
    };
  } else if (['pause', 'resume', 'cancel', 'claim'].includes(input.type)) {
    if (!session || session.id !== input.sessionId)
      fail('这段专注已在另一处处理，已为你更新进度。');
    const remaining = focusRemaining(session, now);
    if (input.type === 'pause') {
      if (session.status !== 'running' || !remaining) fail('这段专注已经暂停或完成。');
      session.remainingMs = remaining;
      session.endsAt = null;
      session.status = 'paused';
    } else if (input.type === 'resume') {
      if (session.status !== 'paused') fail('这段专注正在进行。');
      session.endsAt = now + session.remainingMs;
      session.status = 'running';
    } else if (input.type === 'cancel') {
      state.session = null;
    } else {
      if (session.status !== 'running' || remaining > 0) fail('倒计时结束后才能领取战利品。');
      const material = ['seed', 'amber', 'moonstone'][state.completedSessions % 3];
      const quantity = Math.max(1, Math.floor(session.minutes / 25));
      const reward = {
        sessionId: session.id,
        label: session.label,
        minutes: session.minutes,
        acorns: session.minutes * 2,
        material,
        quantity,
        finishedAt: now,
      };
      state.acorns += reward.acorns;
      state.materials[material] += quantity;
      state.totalMinutes += session.minutes;
      state.completedSessions++;
      state.lastReward = reward;
      state.history = [reward, ...state.history].slice(0, 40);
      state.session = null;
    }
  } else {
    const item = GROVE_ITEMS.find((item) => item.id === input.itemId);
    const free = ['ember', 'burrow'].includes(input.itemId);
    if (!item && !free) throw new GroveError('找不到这件装扮。', 400);
    if (input.type === 'buy') {
      if (!item || state.owned.includes(item.id)) fail('已经拥有这件装扮了。');
      if (
        state.acorns < item.acorns ||
        (item.material && state.materials[item.material] < item.quantity)
      )
        fail('橡果或材料还不够，再和小狐狸专注一会儿吧。');
      state.acorns -= item.acorns;
      if (item.material) state.materials[item.material] -= item.quantity;
      state.owned.push(item.id);
    } else if (!state.owned.includes(input.itemId)) fail('先兑换这件装扮，再来使用吧。');
    const kind = item?.kind || (input.itemId === 'ember' ? 'skin' : 'home');
    if (kind === 'skin') state.skin = input.itemId;
    if (kind === 'home') state.home = input.itemId;
    if (kind === 'decor') {
      state.decorations = state.decorations.filter((id) => id !== input.itemId);
      if (input.type === 'buy' || input.enabled) state.decorations.push(input.itemId);
    }
  }
  state.version++;
  return state;
}
