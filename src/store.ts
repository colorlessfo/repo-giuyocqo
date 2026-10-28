import type { Change, Collection, Mutation, State, StoreView } from './types';
import { demoState, emptyState } from './lib';
import { changeSchema, entityId, schemas, validateSnapshot } from '../shared/validation.mjs';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: any,
  ) {
    super(body.error || '网络请求失败');
  }
}
export async function api<T = any>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    method: body !== undefined ? 'POST' : 'GET',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) throw new ApiError(response.status, json);
  return json;
}
function apply(base: State, changes: Change[]): State {
  const state = structuredClone(base);
  for (const change of changes) {
    const list = state[change.collection] as any[];
    const index = list.findIndex((v) => v.id === change.id);
    const version = (state.versions[`${change.collection}/${change.id}`] || 0) + 1;
    if (change.data === null) {
      if (index !== -1) list.splice(index, 1);
    } else {
      const item = { ...change.data, id: change.id, version };
      if (index === -1) list.push(item);
      else list[index] = item;
    }
    state.versions[`${change.collection}/${change.id}`] = version;
    if (change.collection === 'categories' && change.data === null)
      state.tasks = state.tasks.map((t) => {
        if (t.categoryId !== change.id) return t;
        const version = (state.versions[`tasks/${t.id}`] || 0) + 1;
        state.versions[`tasks/${t.id}`] = version;
        return { ...t, categoryId: null, version };
      });
  }
  return state;
}
export class SyncStore {
  private base: State;
  private queue: Mutation[] = [];
  private listeners = new Set<() => void>();
  private view: StoreView;
  private busy = false;
  private stopped = false;
  private interval?: ReturnType<typeof setInterval>;
  private failureCount = 0;
  private retryAfter = 0;
  readonly cacheKey: string;
  constructor(
    readonly userId: string,
    readonly demo = false,
  ) {
    this.cacheKey = `qiyu-ddl-v1:${userId}`;
    this.base = demo ? demoState() : emptyState();
    let loaded = demo;
    try {
      const saved = localStorage.getItem(this.cacheKey);
      if (saved) {
        const value = JSON.parse(saved);
        if (Array.isArray(value.queue)) {
          const base = validateSnapshot(value.base) as State;
          const queue: Mutation[] = value.queue.map((job: Mutation) => {
            entityId.parse(job.mutationId);
            return {
              mutationId: job.mutationId,
              changes: job.changes.map((change) => {
                const checked = changeSchema.parse(change);
                return {
                  ...checked,
                  data:
                    checked.data === null ? null : schemas[checked.collection].parse(checked.data),
                };
              }),
            };
          });
          this.base = base;
          this.queue = queue;
          loaded = true;
        }
      }
    } catch {
      /* An invalid cache is preserved on disk for recovery, never uploaded. */
    }
    this.view = {
      data: this.compute(),
      status: demo ? 'demo' : navigator.onLine ? 'loading' : 'offline',
      error: '',
      pending: this.queue.length,
      loaded,
    };
  }
  private compute() {
    return this.queue.reduce((state, job) => apply(state, job.changes), this.base);
  }
  private emit(status = this.view.status, error = this.view.error) {
    this.view = {
      data: this.compute(),
      status,
      error,
      pending: this.queue.length,
      loaded: this.view.loaded,
    };
    for (const fn of this.listeners) fn();
  }
  private persist() {
    localStorage.setItem(this.cacheKey, JSON.stringify({ base: this.base, queue: this.queue }));
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.view;
  start() {
    this.stopped = false;
    if (!this.demo) {
      void this.sync();
      this.interval = setInterval(() => {
        if (document.visibilityState === 'visible') void this.sync();
      }, 6000);
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
      window.addEventListener('focus', this.onOnline);
    }
    return () => {
      this.stopped = true;
      clearInterval(this.interval);
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
      window.removeEventListener('focus', this.onOnline);
    };
  }
  private onOnline = () => {
    this.retryAfter = 0;
    void this.sync();
  };
  private onOffline = () => this.emit('offline', '离线修改已保留，恢复网络后会继续同步。');
  change(collection: Collection, id: string, data: Record<string, unknown> | null) {
    return this.commit([{ collection, id, data }]);
  }
  commit(input: { collection: Collection; id: string; data: Record<string, unknown> | null }[]) {
    if (!this.view.loaded && !this.demo) throw new Error('请等待首次同步完成后再操作。');
    const data = this.view.data;
    if (!input.length || input.length > 1000) throw new Error('每次保存应包含 1 至 1000 项修改。');
    const seen = new Set<string>();
    const changes = input.map((c) => {
      entityId.parse(c.id);
      const key = `${c.collection}/${c.id}`;
      if (seen.has(key)) throw new Error('同一项不能在一次保存中重复出现。');
      seen.add(key);
      return {
        ...c,
        data: c.data === null ? null : schemas[c.collection].parse(c.data),
        expectedVersion: data.versions[key] || 0,
      };
    });
    const mutation = { mutationId: crypto.randomUUID(), changes };
    const oldBase = this.base;
    if (this.demo) this.base = apply(this.base, changes);
    else this.queue.push(mutation);
    try {
      this.persist();
    } catch {
      this.base = oldBase;
      if (!this.demo) this.queue.pop();
      throw new Error('设备存储空间不足，尚未保存。请先导出备份。');
    }
    this.emit(
      this.demo
        ? 'demo'
        : this.view.status === 'conflict'
          ? 'conflict'
          : navigator.onLine
            ? 'syncing'
            : 'offline',
      '',
    );
    void this.sync();
  }
  async sync(force = false) {
    if (
      this.demo ||
      this.busy ||
      this.stopped ||
      this.view.status === 'conflict' ||
      (!force && Date.now() < this.retryAfter)
    )
      return;
    if (!navigator.onLine) {
      this.onOffline();
      return;
    }
    this.busy = true;
    try {
      if (this.queue.length) this.emit('syncing', '');
      while (this.queue.length && !this.stopped) {
        const job = this.queue[0];
        this.base = await api<State>('/api/changes', job);
        this.queue.shift();
        this.persist();
        this.emit('syncing', '');
      }
      if (!this.stopped) {
        this.base = await api<State>('/api/state');
        this.view.loaded = true;
        this.persist();
        this.emit(this.queue.length ? 'syncing' : 'saved', '');
      }
      this.failureCount = 0;
      this.retryAfter = 0;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body.state) {
        this.base = err.body.state;
        this.persist();
        this.emit('conflict', err.message);
      } else {
        this.failureCount++;
        this.retryAfter = Date.now() + Math.min(60000, 2000 * 2 ** this.failureCount);
        this.emit(
          navigator.onLine ? 'error' : 'offline',
          err instanceof Error ? err.message : '暂时无法同步，本机修改已保留。',
        );
      }
    } finally {
      this.busy = false;
      if (!this.stopped && this.queue.length && this.view.status === 'syncing')
        queueMicrotask(() => void this.sync());
    }
  }
  resolveConflict(keepLocal: boolean) {
    if (keepLocal) {
      const versions = { ...this.base.versions };
      this.queue = this.queue.map((job) => ({
        mutationId: crypto.randomUUID(),
        changes: job.changes.map((change) => {
          const key = `${change.collection}/${change.id}`;
          const expectedVersion = versions[key] || 0;
          versions[key] = expectedVersion + 1;
          return { ...change, expectedVersion };
        }),
      }));
    } else this.queue = [];
    this.persist();
    this.emit('syncing', '');
    void this.sync(true);
  }
}
