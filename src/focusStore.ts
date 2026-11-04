import { api, ApiError } from './store';
import {
  newFocusProfile,
  focusAnalytics,
  applyFocusAction,
  focusSessionSchema,
  focusActionSchema,
  focusSnapshotSchema,
} from '../shared/focus.mjs';
import type { FocusAction, FocusInput, FocusSession, FocusSnapshot, FocusView } from './focusTypes';

export class FocusStore {
  private view: FocusView;
  private action: FocusAction | null = null;
  private records: FocusSession[] = [];
  private listeners = new Set<() => void>();
  private stopped = false;
  private interval?: ReturnType<typeof setInterval>;
  readonly cacheKey: string;
  readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  constructor(
    readonly userId: string,
    readonly demo: boolean,
  ) {
    this.cacheKey = `qiyu-focus-v1:${userId}`;
    const now = Date.now();
    let data = {
      profile: newFocusProfile(),
      records: [],
      serverNow: now,
      timezone: this.timezone,
      stats: focusAnalytics([], null, now, this.timezone),
    } as FocusSnapshot;
    let loaded = demo;
    try {
      const cached = JSON.parse(localStorage.getItem(this.cacheKey) || 'null');
      if (cached && Number.isFinite(cached.savedAt)) {
        data = focusSnapshotSchema.parse(cached.data) as FocusSnapshot;
        data.serverNow += Math.max(0, Date.now() - cached.savedAt);
        this.action =
          !demo && cached.action ? (focusActionSchema.parse(cached.action) as FocusAction) : null;
        this.records = demo
          ? (cached.records || []).map((record: unknown) => focusSessionSchema.parse(record))
          : [];
        loaded = true;
      }
    } catch {
      /* Invalid cache does not replace authoritative server data. */
    }
    this.view = {
      data,
      loaded,
      busy: false,
      pending: !!this.action,
      error: '',
      offline: !navigator.onLine,
      observedAt: performance.now(),
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.view;
  private emit(change: Partial<FocusView> = {}) {
    this.view = { ...this.view, ...change, pending: !!this.action };
    for (const listener of this.listeners) listener();
  }
  private accept(data: FocusSnapshot) {
    this.view = {
      ...this.view,
      data: focusSnapshotSchema.parse(data) as FocusSnapshot,
      loaded: true,
      observedAt: performance.now(),
    };
  }
  private persist() {
    const data = {
      ...this.view.data,
      serverNow: Math.round(this.view.data.serverNow + performance.now() - this.view.observedAt),
    };
    localStorage.setItem(
      this.cacheKey,
      JSON.stringify({
        data,
        action: this.action,
        records: this.demo ? this.records : undefined,
        savedAt: Date.now(),
      }),
    );
  }
  start() {
    this.stopped = false;
    void this.sync();
    this.interval = setInterval(() => {
      if (!document.hidden) void this.sync();
    }, 6000);
    window.addEventListener('online', this.retry);
    window.addEventListener('focus', this.retry);
    window.addEventListener('offline', this.offline);
    document.addEventListener('visibilitychange', this.visible);
    return () => {
      this.stopped = true;
      clearInterval(this.interval);
      window.removeEventListener('online', this.retry);
      window.removeEventListener('focus', this.retry);
      window.removeEventListener('offline', this.offline);
      document.removeEventListener('visibilitychange', this.visible);
    };
  }
  retry = () => {
    void this.sync();
  };
  private visible = () => {
    if (!document.hidden) this.retry();
  };
  private offline = () =>
    this.emit({
      offline: true,
      error: this.demo ? '' : '暂时离线。已有倒计时继续，新操作联网后确认。',
    });
  private demoData(profile = this.view.data.profile): FocusSnapshot {
    const now = Date.now();
    return {
      profile,
      records: this.records.slice(0, 50),
      serverNow: now,
      timezone: this.timezone,
      stats: focusAnalytics(this.records, profile.active, now, this.timezone),
    } as FocusSnapshot;
  }
  async act(input: FocusInput): Promise<FocusSnapshot | null> {
    if (this.stopped || !this.view.loaded || this.view.busy || this.action) return null;
    const action = {
      ...input,
      actionId: crypto.randomUUID(),
      expectedVersion: this.view.data.profile.version,
    } as FocusAction;
    try {
      if (this.demo) {
        const old = this.view,
          records = this.records;
        const result = applyFocusAction(this.view.data.profile, action, Date.now());
        if (result.record) this.records = [result.record as FocusSession, ...this.records];
        this.accept(this.demoData(result.profile));
        try {
          this.persist();
        } catch {
          this.view = old;
          this.records = records;
          throw new Error('本机存储不可用，尚未保存。');
        }
        this.emit({ error: '' });
        return this.view.data;
      }
      this.action = action;
      try {
        this.persist();
      } catch {
        this.action = null;
        throw new Error('本机存储不可用，操作未提交。');
      }
      await this.sync();
      return this.action || this.view.error ? null : this.view.data;
    } catch (e) {
      this.emit({ error: (e as Error).message });
      return null;
    }
  }
  async sync() {
    if (this.stopped || this.view.busy) return;
    if (this.demo) {
      this.accept(this.demoData());
      this.emit();
      return;
    }
    if (!navigator.onLine) {
      this.offline();
      return;
    }
    const sent = this.action;
    this.emit({ busy: true });
    try {
      const data = sent
        ? await api('/api/focus/action', { ...sent, timezone: this.timezone })
        : await api(`/api/focus?timezone=${encodeURIComponent(this.timezone)}`);
      this.accept(data);
      if (sent) this.action = null;
      this.persist();
      this.emit({ busy: false, error: '', offline: false });
    } catch (e) {
      if (e instanceof ApiError && e.status < 500 && e.status !== 429) {
        if (e.body.profile) this.accept(e.body);
        if (sent) this.action = null;
        try {
          this.persist();
        } catch {
          /* Server receipt allows safe retry after storage failure. */
        }
      }
      this.emit({
        busy: false,
        offline: !navigator.onLine,
        error: e instanceof Error ? e.message : '专注同步暂时失败，稍后重试。',
      });
    }
  }
}
