import { api, ApiError } from './store';
import {
  applyGroveAction,
  newGrove,
  groveActionSchema,
  groveStateSchema,
} from '../shared/grove.mjs';
import type { GroveAction, GroveInput, GroveState, GroveView } from './groveTypes';

export class GroveStore {
  private view: GroveView;
  private listeners = new Set<() => void>();
  private action: GroveAction | null = null;
  private stopped = false;
  private fetching = false;
  private interval?: ReturnType<typeof setInterval>;
  private cacheKey: string;
  constructor(
    readonly userId: string,
    readonly demo: boolean,
  ) {
    this.cacheKey = `qiyu-grove-v1:${userId}`;
    let state = newGrove() as GroveState;
    let loaded = demo;
    let serverNow = Date.now();
    try {
      const cache = JSON.parse(localStorage.getItem(this.cacheKey) || 'null');
      if (cache?.state && Number.isFinite(cache.serverNow) && Number.isFinite(cache.savedAt)) {
        state = groveStateSchema.parse(cache.state) as GroveState;
        this.action =
          !demo && cache.action ? (groveActionSchema.parse(cache.action) as GroveAction) : null;
        serverNow = cache.serverNow + Math.max(0, Date.now() - cache.savedAt);
        loaded = true;
      }
    } catch {
      /* Invalid local data never replaces server data. */
    }
    this.view = {
      state,
      loaded,
      busy: false,
      error: '',
      offline: !navigator.onLine,
      pending: !!this.action,
      serverNow,
      observedAt: performance.now(),
    };
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.view;
  private emit(update: Partial<GroveView> = {}) {
    this.view = { ...this.view, ...update, pending: !!this.action };
    for (const listener of this.listeners) listener();
  }
  private persist() {
    localStorage.setItem(
      this.cacheKey,
      JSON.stringify({
        state: this.view.state,
        action: this.action,
        serverNow: this.view.serverNow + performance.now() - this.view.observedAt,
        savedAt: Date.now(),
      }),
    );
  }
  private receive(result: { state: GroveState; serverNow: number }) {
    this.view = {
      ...this.view,
      state: groveStateSchema.parse(result.state) as GroveState,
      loaded: true,
      serverNow: result.serverNow,
      observedAt: performance.now(),
    };
  }
  start() {
    this.stopped = false;
    if (!this.demo) {
      void this.sync();
      this.interval = setInterval(() => {
        if (!document.hidden) void this.sync();
      }, 6000);
      window.addEventListener('online', this.retry);
      window.addEventListener('focus', this.retry);
      window.addEventListener('offline', this.onOffline);
      document.addEventListener('visibilitychange', this.onVisible);
    }
    return () => {
      this.stopped = true;
      clearInterval(this.interval);
      window.removeEventListener('online', this.retry);
      window.removeEventListener('focus', this.retry);
      window.removeEventListener('offline', this.onOffline);
      document.removeEventListener('visibilitychange', this.onVisible);
    };
  }
  private onOffline = () =>
    this.emit({ offline: true, error: '暂时离线。倒计时继续，联网后可领取或同步进度。' });
  retry = () => {
    void this.sync();
  };
  private onVisible = () => {
    if (!document.hidden) this.retry();
  };
  async act(input: GroveInput) {
    if (!this.view.loaded || this.view.busy || this.action || this.stopped) return;
    const action = {
      ...input,
      expectedVersion: this.view.state.version,
      actionId: crypto.randomUUID(),
    } as GroveAction;
    try {
      if (this.demo) {
        const next = applyGroveAction(this.view.state, action, Date.now()) as GroveState;
        const previous = this.view;
        this.receive({ state: next, serverNow: Date.now() });
        try {
          this.persist();
        } catch {
          this.view = previous;
          throw new Error('本机存储已满，尚未保存。');
        }
        this.emit({ error: '' });
        return;
      }
      this.action = action;
      try {
        this.persist();
      } catch {
        this.action = null;
        throw new Error('本机存储不可用，操作未提交，请先释放空间。');
      }
      await this.sync();
    } catch (error) {
      this.emit({ error: (error as Error).message });
    }
  }
  async sync() {
    if (this.demo || this.stopped || this.fetching) return;
    if (!navigator.onLine) {
      this.onOffline();
      return;
    }
    this.fetching = true;
    const sent = this.action;
    let succeeded = false;
    this.emit({ busy: !!sent });
    try {
      const result = sent ? await api('/api/grove/action', sent) : await api('/api/grove');
      this.receive(result);
      if (sent && this.action?.actionId === sent.actionId) this.action = null;
      this.persist();
      this.emit({ busy: false, offline: false, error: '' });
      succeeded = true;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) {
        if (error.body.state) this.receive(error.body);
        if (sent) this.action = null;
        try {
          this.persist();
        } catch {
          /* Server remains authoritative. */
        }
      }
      this.emit({
        busy: false,
        offline: !navigator.onLine,
        error:
          error instanceof Error ? error.message : '树屋暂时无法同步，操作已保留，联网后重试。',
      });
    } finally {
      this.fetching = false;
      if (succeeded && !sent && this.action && !this.stopped) queueMicrotask(this.retry);
    }
  }
}
