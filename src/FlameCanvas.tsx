import { useEffect, useRef } from 'react';
import { drawFlame, flameSeed } from '../shared/flame.mjs';
import type { FlameConfig } from './types';

type Surface = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  config: FlameConfig;
  seed: number;
  visible: boolean;
  dirty: boolean;
  elapsed: number;
  previous: number | null;
  painted: number;
};
// Share a single 24fps loop and observers across all visible task segments.
const surfaces = new Map<HTMLCanvasElement, Surface>();
let frame: number | null = null;
let visibility: IntersectionObserver | null = null;
let sizes: ResizeObserver | null = null;
let reduced: MediaQueryList | null = null;
function requestPaint() {
  if (frame === null && !document.hidden && surfaces.size) frame = requestAnimationFrame(paint);
}
function invalidate() {
  for (const surface of surfaces.values()) {
    surface.dirty = true;
    surface.previous = null;
  }
  requestPaint();
}
function onDocumentVisibility() {
  if (document.hidden) {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    for (const s of surfaces.values()) s.previous = null;
  } else invalidate();
}
function paint(timestamp: number) {
  frame = null;
  let animate = false;
  for (const s of surfaces.values()) {
    if (!s.visible) {
      s.previous = null;
      continue;
    }
    const running = s.config.animated && !reduced?.matches;
    if (running) {
      if (s.previous !== null) s.elapsed += Math.min(0.15, (timestamp - s.previous) / 1000);
      s.previous = timestamp;
      animate = true;
    } else s.previous = null;
    if (!s.dirty && (!running || timestamp - s.painted < 1000 / 24)) continue;
    const rect = s.canvas.getBoundingClientRect();
    const scroller = s.canvas.closest('.schedule-scroll')?.getBoundingClientRect();
    const top = Math.max(0, scroller?.top ?? 0);
    const bottom = Math.min(innerHeight, scroller?.bottom ?? innerHeight);
    drawFlame(s.context, s.canvas.width, s.canvas.height, s.elapsed, s.config, s.seed, {
      top: Math.max(0, top - rect.top),
      bottom: Math.min(rect.height, bottom - rect.top),
    });
    s.dirty = false;
    s.painted = timestamp;
  }
  if (animate) requestPaint();
}
function initialize() {
  reduced = matchMedia('(prefers-reduced-motion: reduce)');
  reduced.addEventListener('change', invalidate);
  visibility = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const s = surfaces.get(entry.target as HTMLCanvasElement);
      if (s) {
        s.visible = entry.isIntersecting;
        s.dirty = true;
        s.previous = null;
      }
    }
    requestPaint();
  });
  sizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const s = surfaces.get(entry.target as HTMLCanvasElement);
      if (!s) continue;
      s.canvas.width = Math.max(1, Math.round(entry.contentRect.width));
      s.canvas.height = Math.max(1, Math.round(entry.contentRect.height));
      s.context.imageSmoothingEnabled = false;
      s.dirty = true;
    }
    requestPaint();
  });
  document.addEventListener('scroll', invalidate, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onDocumentVisibility);
}
function register(canvas: HTMLCanvasElement, config: FlameConfig, seed: number) {
  const context = canvas.getContext('2d');
  if (!context) return null;
  if (!surfaces.size) initialize();
  const surface: Surface = {
    canvas,
    context,
    config,
    seed,
    visible: false,
    dirty: true,
    elapsed: 0,
    previous: null,
    painted: 0,
  };
  surfaces.set(canvas, surface);
  visibility!.observe(canvas);
  sizes!.observe(canvas);
  return {
    update(next: FlameConfig) {
      surface.config = next;
      surface.dirty = true;
      requestPaint();
    },
    dispose() {
      surfaces.delete(canvas);
      visibility?.unobserve(canvas);
      sizes?.unobserve(canvas);
      if (!surfaces.size) {
        visibility?.disconnect();
        sizes?.disconnect();
        reduced?.removeEventListener('change', invalidate);
        document.removeEventListener('scroll', invalidate, true);
        document.removeEventListener('visibilitychange', onDocumentVisibility);
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
      }
    },
  };
}
export default function FlameCanvas({ config, taskId }: { config: FlameConfig; taskId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof register>>(null);
  useEffect(() => {
    if (!canvas.current) return;
    renderer.current = register(canvas.current, config, flameSeed(taskId));
    return () => {
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [taskId]);
  useEffect(() => {
    renderer.current?.update(config);
  }, [config]);
  return <canvas ref={canvas} className="flame-canvas" aria-hidden="true" />;
}
