import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FLAME, drawFlame, flameSeed } from '../shared/flame.mjs';
import { flameSchema, validateSnapshot } from '../shared/validation.mjs';
import { emptyState } from '../src/lib.ts';

function render(config, time = 0, width = 168, height = 196, clip) {
  const pixels = [];
  const context = {
    clearRect() {},
    fillStyle: '',
    fillRect(x, y, w, h) {
      pixels.push({ x, y, w, h, color: this.fillStyle });
    },
  };
  drawFlame(context, width, height, time, config, flameSeed('one-task'), clip);
  return pixels;
}
test('uploaded flame draws changing heat on all four sides, stays inside its time slot, and can paint clipped long segments', () => {
  const first = render(DEFAULT_FLAME);
  assert.deepEqual(render(DEFAULT_FLAME), first);
  assert.notDeepEqual(render(DEFAULT_FLAME, 2), first);
  for (const predicate of [(p) => p.x < 42, (p) => p.x > 126, (p) => p.y < 49, (p) => p.y > 147])
    assert.ok(first.some(predicate), 'Flame must occupy all four perimeter regions');
  const odd = render({ ...DEFAULT_FLAME, pixelSize: 7 }, 1, 173, 119);
  assert.ok(odd.length > 0);
  assert.ok(odd.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.w <= 173 && p.y + p.h <= 119));
  const clipped = render(DEFAULT_FLAME, 0, 168, 1116, { top: 300, bottom: 500 });
  assert.ok(clipped.length > 0);
  assert.ok(clipped.every((p) => p.y >= 296 && p.y <= 504));
  assert.equal(render(DEFAULT_FLAME, 0, 0, 0).length, 0);
});
test('core ratio changes the visible yellow area and invalid settings cannot be stored', () => {
  const yellow = (p) => ['#ffb300', '#ffd000', '#ffe81a', '#fff752'].includes(p.color);
  assert.ok(
    render({ ...DEFAULT_FLAME, coreRatio: 0.65 }).filter(yellow).length >
      render({ ...DEFAULT_FLAME, coreRatio: 0.35 }).filter(yellow).length,
  );
  for (const patch of [
    { speed: 0 },
    { speed: 2 },
    { tongueSize: 0 },
    { coreRatio: 0.9 },
    { pixelSize: 2 },
    { pixelSize: 4.5 },
    { animated: 'false' },
  ])
    assert.equal(flameSchema.safeParse({ ...DEFAULT_FLAME, ...patch }).success, false);
  const old = emptyState();
  delete old.settings[0].flame;
  assert.deepEqual(validateSnapshot(old).settings[0].flame, DEFAULT_FLAME);
});
