import { useEffect, useRef } from 'react';

type Star = {
  x: number;
  y: number;
  radius: number;
  light: number;
  phase: number;
  pace: number;
  twinkle: boolean;
};
type Cloud = {
  x: number;
  y: number;
  radius: number;
  stretch: number;
  rotation: number;
  light: number;
};
type Sky = { stars: Star[]; clouds: Cloud[] };
function createSky(width: number, height: number): Sky {
  // Browser entropy, no tile, repeating positions, grid, fixed seed or star glyphs.
  const pool = new Uint32Array(1024);
  let index = pool.length;
  const random = () => {
    if (index === pool.length) {
      crypto.getRandomValues(pool);
      index = 0;
    }
    return pool[index++] / 4294967296;
  };
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());
  const stars: Star[] = [],
    clouds: Cloud[] = [];
  const density = Math.min(1100, Math.max(260, Math.round((width * height) / 1750)));
  const intercept = 0.77 + random() * 0.16,
    slope = 0.55 + random() * 0.4;
  function star(x: number, y: number, distant = false) {
    stars.push({
      x,
      y,
      radius: distant ? 0.3 + random() ** 2 * 0.7 : 0.45 + random() ** 3 * 1.25,
      light: distant ? 0.13 + random() ** 2 * 0.35 : 0.28 + random() ** 2 * 0.72,
      phase: random() * Math.PI * 2,
      pace: 0.7 + random() * 1.2,
      twinkle: random() > (distant ? 0.84 : 0.32),
    });
  }
  for (let i = 0; i < density; i++) star(random(), random());
  // Independent, irregular samples around a diffuse galactic band.
  for (let i = 0; i < density * 0.85; i++) {
    const x = random(),
      y = intercept - slope * x + gaussian() * (0.035 + random() * 0.065);
    if (y >= 0 && y <= 1) star(x, y, true);
  }
  for (let i = 0; i < 26; i++) {
    const x = random(),
      y = intercept - slope * x + gaussian() * 0.07;
    clouds.push({
      x,
      y,
      radius: 0.07 + random() * 0.13,
      stretch: 0.3 + random() * 0.5,
      rotation: -0.65 + random() * 0.4,
      light: 0.008 + random() * 0.018,
    });
  }
  return { stars, clouds };
}
export default function NightSky({ animate }: { animate: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sky = useRef<Sky | null>(null);
  useEffect(() => {
    const target = canvas.current;
    const ctx = target?.getContext('2d');
    if (!target || !ctx) return;
    sky.current ||= createSky(innerWidth, innerHeight);
    const model = sky.current;
    const background = document.createElement('canvas');
    const base = background.getContext('2d')!;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let width = innerWidth,
      height = innerHeight,
      frame: number | null = null,
      previous = 0;
    let ratio = Math.min(devicePixelRatio || 1, 1.5);
    function drawStar(context: CanvasRenderingContext2D, star: Star, light: number) {
      const x = star.x * width,
        y = star.y * height;
      if (star.radius > 0.95) {
        const glow = context.createRadialGradient(x, y, 0, x, y, star.radius * 4);
        glow.addColorStop(0, `rgba(255,255,255,${light * 0.25})`);
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = glow;
        context.fillRect(
          x - star.radius * 4,
          y - star.radius * 4,
          star.radius * 8,
          star.radius * 8,
        );
      }
      context.fillStyle = `rgba(255,255,255,${light})`;
      context.beginPath();
      context.arc(x, y, star.radius, 0, Math.PI * 2);
      context.fill();
    }
    function paint(time = 0) {
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, target!.width, target!.height);
      ctx!.drawImage(background, 0, 0);
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
      for (const star of model.stars)
        if (star.twinkle) {
          const variation =
            animate && !motion.matches
              ? 0.2 + 0.8 * ((1 + Math.sin(time * star.pace + star.phase)) / 2) ** 1.5
              : 1;
          drawStar(ctx!, star, star.light * variation);
        }
    }
    function tick(time: number) {
      frame = null;
      if (!animate || motion.matches || document.hidden) return;
      if (time - previous >= 1000 / 20) {
        paint(time / 1000);
        previous = time;
      }
      frame = requestAnimationFrame(tick);
    }
    function start() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      paint(performance.now() / 1000);
      if (animate && !motion.matches && !document.hidden) frame = requestAnimationFrame(tick);
    }
    function resize() {
      width = innerWidth;
      height = innerHeight;
      ratio = Math.min(devicePixelRatio || 1, 1.5);
      target!.width = background.width = Math.round(width * ratio);
      target!.height = background.height = Math.round(height * ratio);
      base.setTransform(ratio, 0, 0, ratio, 0, 0);
      for (const cloud of model.clouds) {
        const radius = cloud.radius * Math.hypot(width, height);
        base.save();
        base.translate(cloud.x * width, cloud.y * height);
        base.rotate(cloud.rotation);
        base.scale(1, cloud.stretch);
        const glow = base.createRadialGradient(0, 0, 0, 0, 0, radius);
        glow.addColorStop(0, `rgba(255,255,255,${cloud.light})`);
        glow.addColorStop(0.5, `rgba(255,255,255,${cloud.light * 0.4})`);
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        base.fillStyle = glow;
        base.fillRect(-radius, -radius, radius * 2, radius * 2);
        base.restore();
      }
      for (const star of model.stars) if (!star.twinkle) drawStar(base, star, star.light);
      start();
    }
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', start);
    motion.addEventListener('change', start);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', start);
      motion.removeEventListener('change', start);
    };
  }, [animate]);
  return (
    <div className="night-sky" aria-hidden="true">
      <canvas ref={canvas} className="random-starfield" />
    </div>
  );
}
