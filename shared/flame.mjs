export const DEFAULT_FLAME = Object.freeze({
  speed: 0.52,
  tongueSize: 1.18,
  coreRatio: 0.48,
  pixelSize: 4,
  animated: true,
});

// Ported from the user's code_artifact.html: only the noise, palette and flame
// drawing routines. No example tasks, timetable model, external scripts or fox.
export function hash2D(ix, iy, seed) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 1442695041);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}
export function valueNoise2D(x, y, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    u = smoothstep(x - ix),
    v = smoothstep(y - iy);
  const a = hash2D(ix, iy, seed),
    b = hash2D(ix + 1, iy, seed);
  const c = hash2D(ix, iy + 1, seed),
    d = hash2D(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbmFlameNoise(x, y, seed) {
  const n1 = valueNoise2D(x, y, seed);
  const n2 = valueNoise2D(x * 2.15 + 13.7, y * 2.15 + 7.9, seed + 101);
  return n1 * 0.62 + (1 - Math.abs(n2 * 2 - 1)) * 0.38;
}
export function flameColor(heat, checkerMod) {
  const h = heat + (checkerMod - 0.5) * 0.045;
  if (h < 0.2) return null;
  if (h < 0.27) return '#c83200';
  if (h < 0.35) return '#e04200';
  if (h < 0.44) return '#f25800';
  if (h < 0.53) return '#ff7300';
  if (h < 0.62) return '#ff9200';
  if (h < 0.71) return '#ffb300';
  if (h < 0.8) return '#ffd000';
  if (h < 0.89) return '#ffe81a';
  return '#fff752';
}
export function flameSeed(id) {
  let seed = 17;
  for (const char of id) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) | 0;
  return seed;
}
export function drawFlame(ctx, width, height, timeSec, config, seed, clip = {}) {
  if (width <= 0 || height <= 0) return;
  ctx.clearRect(0, 0, width, height);
  const pSize = config.pixelSize;
  const cols = Math.ceil(width / pSize),
    rows = Math.ceil(height / pSize);
  const firstRow = Math.max(0, Math.floor((clip.top || 0) / pSize) - 1);
  const lastRow = Math.min(rows, Math.ceil((clip.bottom ?? height) / pSize) + 1);
  const t = timeSec * config.speed,
    coreScale = config.coreRatio;
  for (let gx = 0; gx < cols; gx++) {
    const nx = ((gx + 0.5) / cols) * 2 - 1,
      absX = Math.abs(nx);
    for (let gy = firstRow; gy < lastRow; gy++) {
      const ny = ((gy + 0.5) / rows) * 2 - 1,
        absY = Math.abs(ny);
      const edgeDist = Math.max(absX, absY);
      if (edgeDist > 0.985) continue;
      const cornerBlend = Math.hypot(
        Math.max(0, absX - coreScale * 0.68),
        Math.max(0, absY - coreScale * 0.68),
      );
      const rectDist = Math.max(absX, absY) * 0.76 + cornerBlend * 0.42;
      const primaryNoise = fbmFlameNoise(
        gx * 0.23 - Math.sign(nx) * t * 0.65,
        gy * 0.23 + t * 1.35 - Math.sign(ny) * t * 0.45,
        seed,
      );
      const angle = Math.atan2(ny, nx);
      const tongueWave = valueNoise2D(
        Math.cos(angle) * 3.8 + t * 0.4,
        Math.sin(angle) * 3.8 - t * 0.55,
        seed + 55,
      );
      const outerWeight = Math.min(1, Math.pow(Math.max(0, rectDist - 0.15) / 0.75, 0.85));
      const displacement =
        (primaryNoise * 0.65 + tongueWave * 0.55) * 0.46 * config.tongueSize * outerWeight;
      const heat =
        1.05 -
        rectDist / (coreScale + 0.36) +
        displacement -
        Math.max(0, (edgeDist - 0.86) / 0.125) * 0.38;
      const grain = hash2D(gx, gy, seed + Math.floor(t * 2.5));
      if (
        heat < 0.2 &&
        heat > 0.05 &&
        edgeDist < 0.94 &&
        edgeDist > 0.62 &&
        valueNoise2D(gx * 0.55, gy * 0.55 + t * 1.9, seed + 333) > 0.855 &&
        tongueWave > 0.58
      ) {
        ctx.fillStyle = grain > 0.45 ? '#ff6a00' : '#e04200';
      } else {
        const color = flameColor(heat, grain);
        if (!color) continue;
        ctx.fillStyle = color;
      }
      // Canvas clipping and the renderer's margin keep every pixel inside the time slot.
      ctx.fillRect(
        gx * pSize,
        gy * pSize,
        Math.min(pSize, width - gx * pSize),
        Math.min(pSize, height - gy * pSize),
      );
    }
  }
}
