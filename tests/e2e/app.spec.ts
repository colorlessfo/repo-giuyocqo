import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { createDatabase } from '../../server/database.mjs';

const password = 'qiyu-test-password-2026';
function shanghaiDay(offset = 0, clock = '12:00') {
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(`${key}T${clock}:00+08:00`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}
// Each isolated device/test has its own proxied client address. Production limits stay enabled.
const test = base.extend({
  extraHTTPHeaders: async ({}, use) => {
    const hex = randomUUID().replace(/-/g, '');
    await use({
      'X-Forwarded-For': `10.${parseInt(hex.slice(0, 2), 16)}.${parseInt(hex.slice(2, 4), 16)}.${parseInt(hex.slice(4, 6), 16)}`,
    });
  },
});
async function register(context: BrowserContext) {
  const account = `user_${randomUUID().slice(0, 18).replaceAll('-', '_')}`;
  const response = await context.request.post('/api/auth/register', {
    data: { account, password, name: '奇遇同学' },
  });
  expect(response.status()).toBe(201);
  return account;
}
async function state(page: Page) {
  const response = await page.request.get('/api/state');
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function createTask(page: Page, overrides: Record<string, unknown> = {}) {
  const due = shanghaiDay(1);
  const id = randomUUID();
  const data = {
    title: '需要认真完成的报告',
    notes: '有时间，也有余量。',
    dueAt: due.toISOString(),
    durationMinutes: 120,
    categoryId: null,
    mascot: 'cloud',
    completed: false,
    completedAt: null,
    ...overrides,
  };
  const response = await page.request.post('/api/changes', {
    data: {
      mutationId: randomUUID(),
      changes: [{ collection: 'tasks', id, expectedVersion: 0, data }],
    },
  });
  expect(response.status()).toBe(200);
  return { id, ...data };
}
async function waitForSaved(page: Page) {
  await expect(page.locator('.sync-indicator')).toHaveAttribute('class', /saved/, {
    timeout: 15000,
  });
}

async function focusEndsSoon(page: Page) {
  const user = (await (await page.request.get('/api/auth/me')).json()).user;
  const profile = (await (await page.request.get('/api/focus')).json()).profile;
  const ends = Date.now() + 2000;
  Object.assign(profile.active, {
    endsAt: ends,
    runStartedAt: ends - profile.active.minutes * 60000,
    startedAt: ends - profile.active.minutes * 60000,
    segments: [],
  });
  profile.version++;
  const databaseUrl = process.env.QIYU_TEST_DATABASE_URL_FILE
    ? JSON.parse(await readFile(process.env.QIYU_TEST_DATABASE_URL_FILE, 'utf8')).url
    : null;
  const db = await createDatabase({ dataDir: '/tmp/qiyu-ddl-e2e', databaseUrl });
  try {
    await db.write(user.id, (c) =>
      c.run('UPDATE focus_profiles SET data=? WHERE user_id=?', JSON.stringify(profile), user.id),
    );
  } finally {
    await db.close();
  }
}

test('focus fox transition, pause retry, refresh, completion and real charts synchronize privately', async ({
  page,
  context,
  browser,
}, testInfo) => {
  const account = await register(context);
  await page.goto('/');
  await page.getByRole('button', { name: '点亮火把，开始专注', exact: true }).click();
  await expect(page.locator('.focus-cinematic')).toBeVisible();
  await page.waitForTimeout(1700);
  await page.screenshot({ path: testInfo.outputPath('fox-torch-transition.png') });
  await page.getByRole('button', { name: '跳过动画', exact: true }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  const seconds = (clock: string) => {
    const [m, s] = clock.split(':').map(Number);
    return m * 60 + s;
  };
  const firstRemaining = seconds((await page.getByRole('timer').textContent())!);
  await expect
    .poll(async () => seconds((await page.getByRole('timer').textContent())!))
    .toBeLessThan(firstRemaining);
  let dropped = false;
  await page.route('**/api/focus/action', async (route) => {
    if (route.request().postDataJSON().type === 'pause' && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: '暂停休息', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get('/api/focus')).json()).profile.active.status)
    .toBe('paused');
  await page.reload();
  await page.getByRole('button', { name: '打开专注计时器', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续专注', exact: true })).toBeEnabled();
  const clock = await page.getByRole('timer').textContent();
  await page.waitForTimeout(1100);
  expect(await page.getByRole('timer').textContent()).toBe(clock);
  await page.getByRole('button', { name: '继续专注', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停休息', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '收起计时器', exact: true }).click();
  const miniFirst = seconds((await page.locator('.focus-island-open b').textContent())!);
  await expect
    .poll(async () => seconds((await page.locator('.focus-island-open b').textContent())!))
    .toBeLessThan(miniFirst);
  await page.getByRole('button', { name: '打开专注计时器', exact: true }).click();
  const other = await browser.newContext({
    baseURL: 'http://127.0.0.1:3100',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  try {
    await other.request.post('/api/auth/login', { data: { account, password } });
    const remote = await (await other.request.get('/api/focus')).json();
    expect(remote.profile.active.status).toBe('running');
    await focusEndsSoon(page);
    await page.reload();
    await page.getByRole('button', { name: '专注分析', exact: true }).click();
    await expect
      .poll(
        async () => (await (await page.request.get('/api/focus')).json()).stats.completedSessions,
      )
      .toBe(1);
    await expect(page.locator('.focus-metrics')).toContainText('25 分钟');
    await expect(page.locator('.focus-metrics')).toContainText('1 段');
    await expect(page.locator('.focus-records li')).toHaveCount(1);
    await expect(page.locator('.focus-record-status')).toHaveText('已完成');
    const reflected = await (await other.request.get('/api/focus')).json();
    expect(reflected.records).toHaveLength(1);
    expect(reflected.stats.totalMs).toBe(25 * 60000);
    await register(other);
    const privateState = await (await other.request.get('/api/focus')).json();
    expect(privateState.stats.totalMs).toBe(0);
    expect(privateState.records).toHaveLength(0);
  } finally {
    await other.close();
  }
  await page.screenshot({ path: testInfo.outputPath('focus-analysis.png'), fullPage: true });
  await page.getByRole('button', { name: '30 天', exact: true }).click();
  await expect(
    page.getByRole('group', { name: '每日专注时长柱状图' }).getByRole('button'),
  ).toHaveCount(30);
  await page.getByText('查看每日数据明细', { exact: true }).click();
  await expect(page.locator('.focus-data-details table')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('sidebar categories drag with mouse or touch, navigation uses keyboard and orders survive devices', async ({
  page,
  context,
  browser,
}, testInfo) => {
  const account = await register(context);
  await page.goto('/');
  await waitForSaved(page);
  await page.getByRole('button', { name: '编辑分类', exact: true }).click();
  const rows = page.locator('.category-manager .sidebar-sort-row');
  const before = await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-sort-id')),
  );
  const from = await rows.first().locator('.sidebar-sort-handle').boundingBox(),
    to = await rows.last().locator('.sidebar-sort-handle').boundingBox();
  expect(from && to).toBeTruthy();
  if (testInfo.project.name === 'mobile') {
    const cdp = await context.newCDPSession(page);
    const x = from!.x + from!.width / 2,
      y = from!.y + from!.height / 2,
      end = to!.y + to!.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + ((end - y) * i) / 12 }],
      });
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 15 });
    await page.mouse.up();
  }
  const expected = [...before.slice(1), before[0]];
  await expect
    .poll(
      async () =>
        await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-sort-id'))),
    )
    .toEqual(expected);
  await page.getByText('调整冒险地图顺序', { exact: true }).click();
  const nav = page.locator('.sidebar-nav-order');
  await nav.getByRole('button', { name: '拖动专注分析排序', exact: true }).focus();
  await page.keyboard.press('ArrowUp');
  await waitForSaved(page);
  const saved = (await state(page)).settings[0].sidebar;
  expect(saved.navigation).toEqual(['tasks', 'schedule', 'focus', 'notes']);
  expect(saved.categories.filter((id: string) => id !== 'none')).toEqual(expected);
  await page.reload();
  await waitForSaved(page);
  expect(
    await page
      .locator('.main-nav .sidebar-sort-row')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-sort-id'))),
  ).toEqual(saved.navigation);
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  try {
    await other.request.post('/api/auth/login', { data: { account, password } });
    expect((await (await other.request.get('/api/state')).json()).settings[0].sidebar).toEqual(
      saved,
    );
  } finally {
    await other.close();
  }
});

test('white stars visibly twinkle and respect reduced motion', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('qiyu-night-effects', 'on'));
  await page.goto('/');
  const canvas = page.locator('.random-starfield');
  const sample = () =>
    canvas.evaluate((el: HTMLCanvasElement) => {
      const pixels = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
      let hash = 0,
        white = 0,
        colored = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        hash = (Math.imul(hash, 31) + pixels[i + 3]) | 0;
        if (pixels[i + 3] > 40) {
          white++;
          if (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2]) colored++;
        }
      }
      return { hash, white, colored };
    });
  await expect.poll(async () => (await sample()).white).toBeGreaterThan(100);
  const first = await sample();
  await page.waitForTimeout(1100);
  const second = await sample();
  expect(second.hash).not.toBe(first.hash);
  expect(second.colored).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(200);
  const frozen = await sample();
  await page.waitForTimeout(700);
  expect((await sample()).hash).toBe(frozen.hash);
});

test('white random sky has varied brightness, no repeating layout, and remains stable across page navigation', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('qiyu-night-effects', 'off'));
  await page.goto('/');
  const canvas = page.locator('.random-starfield');
  const pixels = () =>
    canvas.evaluate((el: HTMLCanvasElement) => {
      const data = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
      let hash = 0,
        visible = 0,
        colored = 0;
      const levels = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        hash = (Math.imul(hash, 31) + data[i] + 3 * data[i + 3]) | 0;
        if (data[i + 3] > 20) {
          visible++;
          levels.add(data[i + 3]);
          if (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]) colored++;
        }
      }
      return { hash, visible, colored, levels: levels.size };
    });
  await expect.poll(async () => (await pixels()).visible).toBeGreaterThan(100);
  const first = await pixels();
  expect(first.colored).toBe(0);
  expect(first.levels).toBeGreaterThan(20);
  await page.getByRole('button', { name: '记事本', exact: true }).click();
  expect((await pixels()).hash).toBe(first.hash);
  await page.reload();
  await expect.poll(async () => (await pixels()).visible).toBeGreaterThan(100);
  expect((await pixels()).hash).not.toBe(first.hash);
});

test('uploaded flame controls require unlock, persist, and task blocks contain no pets', async ({
  context,
  page,
  browser,
}, testInfo) => {
  const account = await register(context);
  const task = await createTask(page, { title: '火焰联动测试', durationMinutes: 180 });
  await page.goto('/');
  await waitForSaved(page);
  await page.getByRole('button', { name: '七日日程', exact: true }).click();
  await page.getByRole('button', { name: '放大日程表', exact: true }).click();
  const block = page.getByTestId(`block-${task.id}`);
  await block.scrollIntoViewIfNeeded();
  await expect(block.locator('canvas')).toHaveCount(1);
  await expect(page.locator('.schedule-block .mascot')).toHaveCount(0);
  async function pixels() {
    return block.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0,
        painted = 0;
      for (let i = 0; i < data.length; i += 4) {
        hash = (Math.imul(hash, 31) + data[i] + data[i + 1] * 3 + data[i + 3] * 7) | 0;
        if (data[i + 3]) painted++;
      }
      return { hash, painted };
    });
  }
  await expect.poll(async () => (await pixels()).painted).toBeGreaterThan(0);
  await page.getByRole('button', { name: '火焰调节', exact: true }).click();
  for (const name of ['燃烧速度', '火舌幅度', '黄色核心比例', '像素大小', '播放火焰动画'])
    await expect(page.getByLabel(name, { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '恢复默认火焰', exact: true })).toBeDisabled();
  const before = await state(page);
  await page.getByRole('button', { name: '已锁定', exact: true }).click();
  for (const name of ['燃烧速度', '火舌幅度', '黄色核心比例', '像素大小']) {
    const slider = page.getByLabel(name, { exact: true });
    await expect(slider).toBeEnabled();
    await slider.focus();
    await slider.press('End');
    await waitForSaved(page);
    await expect(page.getByRole('button', { name: '已解锁', exact: true })).toBeVisible();
  }
  await page.getByLabel('播放火焰动画', { exact: true }).uncheck();
  await page.getByRole('button', { name: '已解锁', exact: true }).click();
  await waitForSaved(page);
  const saved = await state(page);
  expect(saved.settings[0].flame).toEqual({
    speed: 1.6,
    tongueSize: 1.6,
    coreRatio: 0.65,
    pixelSize: 7,
    animated: false,
  });
  expect(saved.tasks[0].dueAt).toBe(before.tasks[0].dueAt);
  expect(saved.settings[0].semesterStart).toBe(before.settings[0].semesterStart);
  await expect(page.getByLabel('燃烧速度', { exact: true })).toBeDisabled();
  // Scroll/resize can redraw a paused flame, but its phase must stay still.
  await block.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const paused = await pixels();
  await page.waitForTimeout(300);
  expect(await pixels()).toEqual(paused);
  await page.screenshot({ path: testInfo.outputPath('locked-flame-tuner.png') });
  await page.reload();
  await waitForSaved(page);
  await page.getByRole('button', { name: '七日日程', exact: true }).click();
  await page.getByRole('button', { name: '火焰调节', exact: true }).click();
  await expect(page.getByLabel('燃烧速度', { exact: true })).toHaveValue('1.6');
  await expect(page.getByLabel('燃烧速度', { exact: true })).toBeDisabled();
  const device = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  try {
    await device.request.post('/api/auth/login', { data: { account, password } });
    const synchronized = await (await device.request.get('/api/state')).json();
    expect(synchronized.settings[0].flame).toEqual(saved.settings[0].flame);
  } finally {
    await device.close();
  }
  await page.getByRole('button', { name: '课程与学期设置', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '学期与节次设置', exact: true })
    .click();
  await page.getByLabel('教学周总数', { exact: true }).fill('18');
  await page.getByRole('button', { name: '保存学期设置', exact: true }).click();
  await waitForSaved(page);
  expect((await state(page)).settings[0].flame).toEqual(saved.settings[0].flame);
});

test('calendar expands to the viewport, switches days and keeps unlock state through dialogs', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '七日日程', exact: true }).click();
  await page.getByRole('button', { name: '已锁定', exact: true }).click();
  await page.getByRole('button', { name: '放大日程表', exact: true }).click();
  const calendar = page.getByRole('region', { name: '全屏日程表', exact: true });
  const box = (await calendar.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBe(viewport.width);
  expect(box.height).toBe(viewport.height);
  expect(
    await page.locator('.schedule-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBeTruthy();
  await expect(page.getByRole('button', { name: '已解锁', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '单日详情', exact: true }).click();
  await expect(page.locator('.day-column:visible')).toHaveCount(1);
  await page.getByRole('group', { name: '选择查看日期' }).getByRole('button').nth(1).click();
  const task = page.getByTestId('block-demo-design');
  await task.scrollIntoViewIfNeeded();
  await task.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '火把小狐狸', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(calendar).toBeVisible();
  await expect(page.getByRole('button', { name: '已解锁', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '七天总览', exact: true }).click();
  await expect(page.locator('.day-column:visible')).toHaveCount(7);
  await page.screenshot({ path: testInfo.outputPath('fullscreen-calendar.png') });
  await page.getByRole('button', { name: '打开悬浮记事本' }).click();
  await expect(page.getByRole('region', { name: '悬浮记事本', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收起记事本' }).click();
  await page.getByRole('button', { name: '退出全屏日程', exact: true }).click();
  await expect(calendar).toHaveCount(0);
  await expect(page.getByRole('button', { name: '已解锁', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await page.getByRole('button', { name: /^我的待办/ }).click();
  await expect(page.locator('.task-row')).toHaveCount(3);
});

test('floating notes resize, survive immediate reload, archive, restore, export and sync privately', async ({
  context,
  page,
  browser,
}, testInfo) => {
  const account = await register(context);
  await page.goto('/');
  await waitForSaved(page);
  await page.getByRole('button', { name: '打开悬浮记事本' }).click();
  const notebook = page.getByRole('region', { name: '悬浮记事本', exact: true });
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.getByLabel('笔记标题').fill('夜间灵感');
  const text = '保留这段灵感\n\n  还有缩进和换行\n';
  await page.getByLabel('笔记正文').fill(text);
  // Reload before the debounce fires. The per-account draft must recover and sync.
  await page.reload();
  await expect.poll(async () => (await state(page)).notes[0]?.content).toBe(text);
  await page.getByRole('button', { name: '打开悬浮记事本' }).click();
  await page.getByRole('button', { name: /夜间灵感/ }).click();
  await expect(page.getByLabel('笔记正文')).toHaveValue(text);
  await page.getByRole('button', { name: '调整记事本外形' }).click();
  await page.getByRole('button', { name: '方形', exact: true }).click();
  await page
    .getByLabel('记事本宽度', { exact: true })
    .fill(testInfo.project.name === 'mobile' ? '310' : '450');
  await page.getByLabel('记事本高度', { exact: true }).fill('470');
  await page.getByLabel('记事本圆角', { exact: true }).fill('24');
  const before = (await notebook.boundingBox())!;
  const handle = page.getByTestId('notepad-resize');
  const resizeBox = (await handle.boundingBox())!;
  const x = resizeBox.x + resizeBox.width / 2,
    y = resizeBox.y + resizeBox.height / 2;
  if (testInfo.project.name === 'mobile') {
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + 20, y: y + 25 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 20, y + 25, { steps: 6 });
    await page.mouse.up();
  }
  const after = (await notebook.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width);
  expect(after.height).toBeGreaterThan(before.height);
  const viewport = page.viewportSize()!;
  expect(after.x + after.width).toBeLessThanOrEqual(viewport.width);
  expect(after.y + after.height).toBeLessThanOrEqual(viewport.height);
  await page.getByRole('button', { name: '调整记事本外形' }).click();
  await page.getByRole('button', { name: '归档笔记', exact: true }).click();
  await waitForSaved(page);
  expect((await state(page)).notes[0].archived).toBe(true);
  await page.getByRole('group', { name: '笔记范围' }).getByRole('button', { name: /归档/ }).click();
  await page.getByRole('button', { name: /夜间灵感/ }).click();
  await expect(page.getByLabel('笔记正文')).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: '恢复笔记', exact: true }).click();
  await waitForSaved(page);
  expect((await state(page)).notes[0].archived).toBe(false);
  await page
    .getByRole('group', { name: '笔记范围' })
    .getByRole('button', { name: '笔记', exact: true })
    .click();
  await page.getByRole('button', { name: /夜间灵感/ }).click();
  await page.screenshot({ path: testInfo.outputPath('floating-notebook.png') });
  await page.getByRole('button', { name: '收起记事本' }).click();
  const second = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  try {
    expect(
      (await second.request.post('/api/auth/login', { data: { account, password } })).ok(),
    ).toBeTruthy();
    expect((await (await second.request.get('/api/state')).json()).notes[0].content).toBe(text);
    await register(other);
    expect((await (await other.request.get('/api/state')).json()).notes).toEqual([]);
  } finally {
    await second.close();
    await other.close();
  }
  await page.getByRole('button', { name: '备份与日历导出', exact: true }).last().click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /下载完整备份/ }).click();
  const file = await download;
  const filePath = testInfo.outputPath('notebook-backup.json');
  await file.saveAs(filePath);
  const fs = await import('node:fs/promises');
  const backup = JSON.parse(await fs.readFile(filePath, 'utf8'));
  expect(backup.data.notes[0].content).toBe(text);
});

test('notebook offline text retries and a remote edit during autosave raises a conflict', async ({
  context,
  page,
}) => {
  await register(context);
  const id = randomUUID();
  const initial = {
    title: '不会丢失的手记',
    content: '原始内容',
    archived: false,
    updatedAt: new Date().toISOString(),
  };
  await context.request.post('/api/changes', {
    data: {
      mutationId: randomUUID(),
      changes: [{ collection: 'notes', id, expectedVersion: 0, data: initial }],
    },
  });
  await page.goto('/');
  await waitForSaved(page);
  await page.getByRole('button', { name: '打开悬浮记事本' }).click();
  await page.getByRole('button', { name: /不会丢失的手记/ }).click();
  await context.setOffline(true);
  await page.getByLabel('笔记正文').fill('离线写下的文字');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find(
          (k) => k.startsWith('qiyu-ddl-v1:') && !k.endsWith(':demo'),
        );
        return key ? JSON.parse(localStorage.getItem(key)!).queue.length : 0;
      }),
    )
    .toBeGreaterThan(0);
  await context.setOffline(false);
  await waitForSaved(page);
  expect((await state(page)).notes[0].content).toBe('离线写下的文字');
  // Preserve the editor's original version even if a newer snapshot arrives before debounce.
  await page.getByLabel('笔记正文').fill('本机正在输入，还没自动保存');
  const cloud = (await state(page)).notes[0];
  const result = await context.request.post('/api/changes', {
    data: {
      mutationId: randomUUID(),
      changes: [
        {
          collection: 'notes',
          id,
          expectedVersion: cloud.version,
          data: { ...cloud, content: '另一台设备的新文字' },
        },
      ],
    },
  });
  expect(result.status()).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.sync-indicator')).toHaveAttribute('class', /conflict/);
  expect((await state(page)).notes[0].content).toBe('另一台设备的新文字');
  await expect(page.getByLabel('笔记正文')).toHaveValue('本机正在输入，还没自动保存');
  await page.locator('.notepad-status > button').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '保留本机修改', exact: true }).click();
  await waitForSaved(page);
  expect((await state(page)).notes[0].content).toBe('本机正在输入，还没自动保存');
});

test('notebook replaces course navigation and switches to a floating editor without losing text', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '我的课程', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '记事本', exact: true }).click();
  await expect(page.getByRole('region', { name: '记事本工作区', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.getByLabel('笔记标题').fill('完整页面和悬浮窗是同一篇');
  await page.getByLabel('笔记正文').fill('切换时保留正在写的内容。');
  await page.getByRole('button', { name: '切换为悬浮记事本', exact: true }).click();
  await expect(page.getByRole('region', { name: '悬浮记事本', exact: true })).toBeVisible();
  await expect(page.getByLabel('笔记正文')).toHaveValue('切换时保留正在写的内容。');
  await page.getByRole('button', { name: '收起记事本', exact: true }).click();
  await page.getByRole('button', { name: '记事本', exact: true }).click();
  await expect(page.getByLabel('笔记正文')).toHaveValue('切换时保留正在写的内容。');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('home prioritizes tasks, shows readable text, and has no overflow', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '我的待办.' })).toBeVisible();
  await expect(page.locator('.task-row')).toHaveCount(3);
  const taskTop = await page.locator('.task-list').evaluate((el) => el.getBoundingClientRect().top);
  const scheduleTop = await page
    .locator('.schedule-section')
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(taskTop).toBeLessThan(scheduleTop);
  expect(taskTop).toBeLessThan(500);
  expect(
    await page
      .locator('.task-title')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(20);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
});
test('register through the UI, create a long task, edit, complete and reopen it', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click();
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(page.getByLabel('邮箱', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('手机号', { exact: true })).toHaveCount(0);
  await page.getByLabel('账号', { exact: true }).fill(`奇遇_${randomUUID().slice(0, 12)}`);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '注册并开始安排', exact: true }).click();
  await waitForSaved(page);
  await expect(page.locator('.task-row')).toHaveCount(0);
  await page.getByRole('button', { name: '添加待办', exact: true }).click();
  await page.getByLabel('任务名称').fill('跨两天的课程报告');
  await page.getByLabel('截止日期与时间').fill('2026-11-03T01:00');
  await page.getByLabel('计划用时数值').fill('30');
  await page.getByRole('button', { name: '添加待办', exact: true }).last().click();
  await waitForSaved(page);
  const saved = await state(page);
  expect(saved.tasks).toHaveLength(1);
  expect(saved.tasks[0].durationMinutes).toBe(1800);
  await page.getByRole('button', { name: '跨两天的课程报告', exact: true }).click();
  await page.getByLabel('任务名称').fill('已修改的课程报告');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await waitForSaved(page);
  await page.getByRole('button', { name: '完成任务已修改的课程报告', exact: true }).click();
  await waitForSaved(page);
  await expect(page.locator('.task-row')).toHaveCount(0);
  await page.getByRole('tab', { name: '已完成' }).click();
  await expect(page.getByRole('button', { name: '已修改的课程报告', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复任务已修改的课程报告', exact: true }).click();
  await waitForSaved(page);
  expect((await state(page)).tasks[0].completed).toBe(false);
});
test('category edits and deletion retain the task', async ({ context, page }) => {
  await register(context);
  await page.goto('/');
  await waitForSaved(page);
  const initial = await state(page);
  const category = initial.categories[0];
  const task = await createTask(page, { categoryId: category.id });
  await page.reload();
  await waitForSaved(page);
  await page.getByRole('button', { name: '编辑分类', exact: true }).click();
  const row = page.locator('.category-manager-row').filter({ hasText: category.name });
  await row.getByRole('button', { name: '改名 / 配色' }).click();
  await page.getByLabel('名称', { exact: true }).fill('新的分类名字');
  await page.getByRole('button', { name: '保存分类' }).click();
  await expect(
    page.locator('.category-manager-row').filter({ hasText: '新的分类名字' }),
  ).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除分类新的分类名字', exact: true }).click();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await waitForSaved(page);
  const updated = await state(page);
  expect(updated.tasks).toHaveLength(1);
  expect(updated.tasks[0].id).toBe(task.id);
  expect(updated.tasks[0].categoryId).toBeNull();
});
test('two devices synchronize, another account is isolated, offline edits retry', async ({
  browser,
  context,
  page,
}) => {
  const account = await register(context);
  const device2 = await browser.newContext({
    baseURL: 'http://127.0.0.1:3100',
    timezoneId: 'Asia/Shanghai',
  });
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  try {
    const login = await device2.request.post('/api/auth/login', { data: { account, password } });
    expect(login.ok()).toBeTruthy();
    await register(other);
    const second = await device2.newPage();
    await page.goto('/');
    await second.goto('/');
    await waitForSaved(page);
    await waitForSaved(second);
    await page.getByRole('button', { name: '添加待办', exact: true }).click();
    await page.getByLabel('任务名称').fill('两台设备的同一件事');
    await page.getByRole('button', { name: '添加待办', exact: true }).last().click();
    await waitForSaved(page);
    await expect(
      second.getByRole('button', { name: '两台设备的同一件事', exact: true }),
    ).toBeVisible({ timeout: 15000 });
    expect((await (await other.request.get('/api/state')).json()).tasks).toHaveLength(0);
    await context.setOffline(true);
    await page.getByRole('button', { name: '两台设备的同一件事', exact: true }).click();
    await page.getByLabel('任务名称').fill('离线修改也保留');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.locator('.sync-indicator')).toHaveAttribute('class', /offline/);
    await context.setOffline(false);
    await waitForSaved(page);
    await expect(second.getByRole('button', { name: '离线修改也保留', exact: true })).toBeVisible({
      timeout: 15000,
    });
  } finally {
    await device2.close();
    await other.close();
  }
});
test('concurrent changes show a conflict instead of silently overwriting', async ({
  context,
  page,
}) => {
  await register(context);
  const task = await createTask(page);
  await page.goto('/');
  await waitForSaved(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: task.title, exact: true }).click();
  await page.getByLabel('任务名称').fill('本机的修改');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  const response = await context.request.post('/api/changes', {
    data: {
      mutationId: randomUUID(),
      changes: [
        {
          collection: 'tasks',
          id: task.id,
          expectedVersion: 1,
          data: { ...task, title: '另一设备的修改' },
        },
      ],
    },
  });
  expect(response.ok()).toBeTruthy();
  await context.setOffline(false);
  await expect(page.locator('.sync-indicator')).toHaveAttribute('class', /conflict/, {
    timeout: 15000,
  });
  await page.locator('.sync-indicator').click();
  await expect(page.getByRole('button', { name: '采用云端版本' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '采用云端版本' }).click();
  await waitForSaved(page);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(page.getByRole('button', { name: '另一设备的修改', exact: true })).toBeVisible();
});
test('unlock once, move twice across days, undo, and cancel a drag', async ({
  context,
  page,
}, testInfo) => {
  await register(context);
  const due = new Date();
  due.setDate(due.getDate() + 1);
  due.setHours(10, 0, 0, 0);
  const task = await createTask(page, {
    title: '连续移动的待办',
    dueAt: due.toISOString(),
    durationMinutes: 120,
  });
  await page.goto('/');
  await waitForSaved(page);
  await page.getByRole('button', { name: '七日日程', exact: true }).click();
  await page.getByRole('button', { name: '已锁定', exact: true }).click();
  await expect(page.getByRole('button', { name: '已解锁', exact: true })).toBeVisible();
  const grid = page.locator('.schedule-columns');
  const columnWidth = (await grid.boundingBox())!.width / 7;
  const scroller = page.locator('.schedule-scroll');
  async function drag(dx: number, dy: number, touch = false) {
    const block = page.getByTestId(`block-${task.id}`).first();
    await scroller.scrollIntoViewIfNeeded();
    await block.evaluate((el) => {
      const scroll = el.closest('.schedule-scroll')!;
      scroll.scrollTop = Math.max(0, (el as HTMLElement).offsetTop - 110);
    });
    const box = (await block.boundingBox())!;
    const x = box.x + Math.min(35, box.width / 2),
      y = box.y + Math.min(45, box.height / 2);
    if (touch) {
      const session = await context.newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 12; step++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + (dx * step) / 12, y: y + (dy * step) / 12 }],
        });
        await page.waitForTimeout(25);
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 14 });
      await page.mouse.up();
    }
    await waitForSaved(page);
  }
  const original = (await state(page)).tasks[0].dueAt;
  await drag(0, 58, testInfo.project.name === 'mobile');
  const afterOne = (await state(page)).tasks[0].dueAt;
  expect(Date.parse(afterOne) - Date.parse(original)).toBe(3600000);
  await expect(page.getByRole('button', { name: '已解锁', exact: true })).toBeVisible();
  await drag(columnWidth, 0, testInfo.project.name === 'mobile');
  const afterTwo = (await state(page)).tasks[0];
  expect(Date.parse(afterTwo.dueAt) - Date.parse(afterOne)).toBe(86400000);
  expect(afterTwo.durationMinutes).toBe(120);
  await page.getByRole('button', { name: '撤销移动', exact: true }).click();
  await waitForSaved(page);
  expect((await state(page)).tasks[0].dueAt).toBe(afterOne);
  await expect(page.getByRole('button', { name: '已解锁', exact: true })).toBeVisible();
  if (testInfo.project.name === 'desktop') {
    const block = page.getByTestId(`block-${task.id}`).first();
    await block.scrollIntoViewIfNeeded();
    await scroller.evaluate((el) => {
      el.scrollTop = Math.max(0, el.scrollTop - 100);
    });
    await block.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await waitForSaved(page);
    expect((await state(page)).tasks[0].dueAt).toBe(afterOne);
  }
  await page.getByRole('button', { name: '记事本', exact: true }).click();
  await page.getByRole('button', { name: '七日日程', exact: true }).click();
  await expect(page.getByRole('button', { name: '已解锁', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销移动', exact: true }).click();
  await waitForSaved(page);
  expect((await state(page)).tasks[0].dueAt).toBe(original);
});
test('long tasks display every visible day, courses remain separate and can be hidden', async ({
  context,
  page,
}) => {
  await register(context);
  const end = shanghaiDay(2, '10:00');
  const task = await createTask(page, {
    title: '跨三天的任务',
    dueAt: end.toISOString(),
    durationMinutes: 3000,
  });
  const weekday = ((shanghaiDay().getUTCDay() + 6) % 7) + 1;
  const course = {
    title: '单周课程',
    weekday,
    startTime: '08:00',
    endTime: '09:40',
    startWeek: 1,
    endWeek: 3,
    parity: 'odd',
    location: 'A101',
    exceptions: [],
  };
  await context.request.post('/api/changes', {
    data: {
      mutationId: randomUUID(),
      changes: [{ collection: 'courses', id: 'fixture-course', expectedVersion: 0, data: course }],
    },
  });
  await page.goto('/');
  await waitForSaved(page);
  await expect(page.locator('.task-row')).toHaveCount(1);
  await expect(page.getByTestId(`block-${task.id}`)).toHaveCount(3);
  await expect(page.getByTestId('block-fixture-course')).toHaveCount(1);
  await page.getByLabel('课程', { exact: true }).uncheck();
  await expect(page.getByTestId('block-fixture-course')).toHaveCount(0);
  await expect(page.locator('.task-row')).toHaveCount(1);
  await page.getByLabel('待办', { exact: true }).uncheck();
  await expect(page.getByTestId(`block-${task.id}`)).toHaveCount(0);
  await expect(page.locator('.task-row')).toHaveCount(1);
});
test('dragging through the compressed 06:00 boundary updates the real deadline', async ({
  context,
  page,
}, testInfo) => {
  await register(context);
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const dueAt = new Date(`${day}T06:30:00+08:00`).toISOString();
  const task = await createTask(page, { title: '跨过凌晨压缩区', dueAt, durationMinutes: 60 });
  await page.goto('/');
  await waitForSaved(page);
  await page.getByRole('button', { name: '七日日程', exact: true }).click();
  await page.getByRole('button', { name: '已锁定', exact: true }).click();
  const scroller = page.locator('.schedule-scroll');
  await scroller.scrollIntoViewIfNeeded();
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  });
  const block = page.getByTestId(`block-${task.id}`);
  const box = (await block.boundingBox())!;
  const x = box.x + 30,
    y = box.y + Math.min(box.height / 2, 18);
  const dy = 35;
  if (testInfo.project.name === 'mobile') {
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + (dy * i) / 10 }],
      });
      await page.waitForTimeout(25);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy, { steps: 14 });
    await page.mouse.up();
  }
  await waitForSaved(page);
  expect(Date.parse((await state(page)).tasks[0].dueAt) - Date.parse(dueAt)).toBe(3600000);
  await expect(page.getByRole('button', { name: '已解锁', exact: true })).toBeVisible();
});
test('manual course review requires fields and confirmation, imports only finite rules', async ({
  context,
  page,
}) => {
  await register(context);
  await page.goto('/');
  await waitForSaved(page);
  await page.getByRole('button', { name: '图片导入课表', exact: true }).last().click();
  await page.getByRole('button', { name: '手动填写课表' }).click();
  await expect(page.getByRole('button', { name: '确认导入 1 门课程' })).toBeDisabled();
  await page.getByLabel('课程1名称').fill('大学英语');
  await page.getByLabel('课程1星期').selectOption('2');
  await page.getByLabel('课程1上课').fill('08:00');
  await page.getByLabel('课程1下课').fill('09:40');
  await page.getByLabel('课程1开始周').fill('1');
  await page.getByLabel('课程1结束周').fill('16');
  await page.getByLabel('已校对', { exact: true }).check();
  await page.getByRole('button', { name: '确认导入 1 门课程' }).click();
  await waitForSaved(page);
  const saved = await state(page);
  expect(saved.courses).toHaveLength(1);
  expect(saved.courses[0].endWeek).toBe(16);
  expect(saved.tasks).toHaveLength(0);
  await page.getByRole('button', { name: '七日日程', exact: true }).click();
  await page.getByRole('button', { name: '课程与学期设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '大学英语', exact: true })).toBeVisible();
});
test('a screenshot is actually recognized and imported through the correction screen', async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await register(context);
  await page.goto('/');
  await waitForSaved(page);
  await mkdir(testInfo.outputDir, { recursive: true });
  const imagePath = path.join(testInfo.outputDir, 'timetable.png');
  const fixture = await context.browser()!.newPage({ viewport: { width: 1540, height: 620 } });
  await fixture.setContent(
    `<html lang="zh-CN"><body style="margin:0;background:white;font-family:'Noto Sans CJK SC',sans-serif"><div style="font-size:32px;padding:25px;text-align:center">本学期课程表</div><table style="border-collapse:collapse;width:1540px;table-layout:fixed;text-align:center;font-size:24px" border="1"><thead><tr style="height:70px">${['节次', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'].map((d) => `<th>${d}</th>`).join('')}</tr></thead><tbody><tr style="height:220px"><td>第1-2节</td><td><div>高等数学</div><div style="margin-top:10px">08:00-09:40</div><div style="margin-top:10px">1-16周 单周</div><div style="margin-top:10px">教室:A101</div></td><td><div>大学英语</div><div style="margin-top:10px">08:00-09:40</div><div style="margin-top:10px">1-16周</div><div style="margin-top:10px">教室:B202</div></td>${'<td></td>'.repeat(5)}</tr></tbody></table></body></html>`,
  );
  await fixture.screenshot({ path: imagePath });
  await fixture.close();
  await page.getByRole('button', { name: '图片导入课表', exact: true }).last().click();
  await page.locator('input[type=file]').setInputFiles(imagePath);
  await page.getByRole('button', { name: '识别这张课表' }).click();
  await expect(page.getByRole('heading', { name: '每一门，确认一下' })).toBeVisible({
    timeout: 90000,
  });
  await expect(page.locator('.course-draft')).toHaveCount(2);
  await expect(page.getByLabel('课程1名称')).toHaveValue(/高等数学/);
  await expect(page.getByLabel('课程1星期')).toHaveValue('1');
  await expect(page.getByLabel('课程1上课')).toHaveValue('08:00');
  await expect(page.getByLabel('课程1结束周')).toHaveValue('16');
  await expect(page.getByRole('button', { name: '确认导入 2 门课程' })).toBeDisabled();
  for (const checkbox of await page.getByLabel('已校对', { exact: true }).all())
    await checkbox.check();
  await page.getByRole('button', { name: '确认导入 2 门课程' }).click();
  await waitForSaved(page);
  expect((await state(page)).courses).toHaveLength(2);
});
test('backup reimport is idempotent and exported calendar includes real task times', async ({
  context,
  page,
}) => {
  await register(context);
  await createTask(page);
  await page.goto('/');
  await waitForSaved(page);
  await page.getByRole('button', { name: '备份与日历导出', exact: true }).last().click();
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载完整备份' }).click();
  const file = await jsonDownload;
  expect(file.suggestedFilename()).toContain('奇遇DDL');
  const backupPath = await file.path();
  await page.getByLabel('选择备份文件').setInputFiles(backupPath!);
  await page.getByRole('button', { name: '确认合并恢复' }).click();
  await expect(page.getByRole('alert')).toContainText('无需重复导入');
  expect((await state(page)).tasks).toHaveLength(1);
  const icsEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出到系统日历' }).click();
  const ics = await icsEvent;
  expect(ics.suggestedFilename()).toMatch(/\.ics$/);
});
