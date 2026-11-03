import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Grip,
  GripHorizontal,
  NotebookPen,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
  Cloud,
  AlertCircle,
  Minimize2,
} from 'lucide-react';
import type { Note, StoreView } from './types';
import type { SyncStore } from './store';
import { stripEntity, uid } from './lib';

type Frame = { x: number; y: number; width: number; height: number; radius: number };
type Draft = { title: string; content: string; baseVersion: number; updatedAt: string };
type Drafts = Record<string, Draft>;
function fit(frame: Frame): Frame {
  const viewport = window.visualViewport;
  const viewportWidth = viewport?.width ?? innerWidth;
  const viewportHeight = viewport?.height ?? innerHeight;
  const left = viewport?.offsetLeft ?? 0,
    top = viewport?.offsetTop ?? 0;
  const width = Math.min(Math.max(280, frame.width), Math.max(120, viewportWidth - 16));
  const height = Math.min(Math.max(300, frame.height), Math.max(180, viewportHeight - 24));
  return {
    ...frame,
    width,
    height,
    radius: Math.max(0, Math.min(40, frame.radius)),
    x: Math.max(left + 8, Math.min(frame.x, left + viewportWidth - width - 8)),
    y: Math.max(top + 8, Math.min(frame.y, top + viewportHeight - height - 8)),
  };
}
function readFrame(key: string): Frame {
  const initial = {
    x: innerWidth - 422,
    y: Math.max(80, innerHeight - 630),
    width: 400,
    height: 520,
    radius: 4,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved && ['x', 'y', 'width', 'height', 'radius'].every((k) => Number.isFinite(saved[k])))
      return fit(saved);
  } catch {
    /* Use a visible default frame. */
  }
  return fit(initial);
}
function readDrafts(key: string): Drafts {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    const drafts: Drafts = {};
    for (const [id, draft] of Object.entries(value)) {
      const d = draft as Draft;
      if (
        /^[a-zA-Z0-9_-]{1,100}$/.test(id) &&
        typeof d.title === 'string' &&
        typeof d.content === 'string' &&
        d.title.length <= 200 &&
        d.content.length <= 20000 &&
        Number.isSafeInteger(d.baseVersion) &&
        d.baseVersion >= 0 &&
        typeof d.updatedAt === 'string' &&
        Number.isFinite(Date.parse(d.updatedAt))
      )
        drafts[id] = d;
    }
    return drafts;
  } catch {
    return {};
  }
}

export default function Notepad({
  store,
  view,
  onSync,
  embedded = false,
  onFloat,
}: {
  store: SyncStore;
  view: StoreView;
  onSync: () => void;
  embedded?: boolean;
  onFloat: () => void;
}) {
  const frameKey = `qiyu-notepad-frame:${store.userId}`;
  const draftKey = `qiyu-notepad-drafts:${store.userId}`;
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState(() => readFrame(frameKey));
  const [drafts, setDrafts] = useState<Drafts>(() => readDrafts(draftKey));
  const draftRef = useRef(drafts);
  const [selected, setSelected] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [sizing, setSizing] = useState(false);
  const [error, setError] = useState('');
  const launcher = useRef<HTMLButtonElement>(null);
  const windowRef = useRef<HTMLElement>(null);
  const interaction = useRef<{
    type: 'move' | 'resize';
    x: number;
    y: number;
    frame: Frame;
  } | null>(null);
  const allNotes = view.data.notes || [];
  const note = allNotes.find((n) => n.id === selected);
  const draft = selected ? drafts[selected] : undefined;
  const visible = allNotes
    .filter(
      (n) =>
        n.archived === archived &&
        `${drafts[n.id]?.title ?? n.title} ${drafts[n.id]?.content ?? n.content}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Date.parse(drafts[b.id]?.updatedAt || b.updatedAt) -
        Date.parse(drafts[a.id]?.updatedAt || a.updatedAt),
    );

  function keepDrafts(next: Drafts) {
    // Save text on every input, before the network debounce. A reload or close can recover it.
    localStorage.setItem(draftKey, JSON.stringify(next));
    draftRef.current = next;
    setDrafts(next);
  }
  function flush() {
    const pending = draftRef.current;
    if (!Object.keys(pending).length) return true;
    try {
      store.commit(
        Object.entries(pending).map(([id, d]) => {
          const current = store.getSnapshot().data.notes.find((n) => n.id === id);
          return {
            collection: 'notes' as const,
            id,
            expectedVersion: d.baseVersion,
            data: {
              title: d.title,
              content: d.content,
              archived: current?.archived || false,
              updatedAt: d.updatedAt,
            },
          };
        }),
      );
      // The store now owns a durable, retryable queue with the original expected version.
      keepDrafts({});
      setError('');
      return true;
    } catch {
      setError('暂时无法保存，请保留窗口并复制文字备份后重试。');
      return false;
    }
  }
  useEffect(() => {
    if (!Object.keys(drafts).length || !view.loaded) return;
    const timer = setTimeout(flush, 900);
    return () => clearTimeout(timer);
  }, [drafts, view.loaded, store]);
  useEffect(() => {
    try {
      localStorage.setItem(frameKey, JSON.stringify(frame));
    } catch {
      /* Geometry is optional. */
    }
  }, [frame, frameKey]);
  useEffect(() => {
    const resize = () => setFrame((v) => fit(v));
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);
  useEffect(() => {
    if (open || embedded) windowRef.current?.focus({ preventScroll: true });
  }, [open, embedded]);
  useEffect(() => {
    if (embedded) setOpen(false);
  }, [embedded]);
  function edit(values: Partial<Pick<Note, 'title' | 'content'>>) {
    if (!note || note.archived) return;
    const previous = draftRef.current[note.id];
    const next = {
      title: previous?.title ?? note.title,
      content: previous?.content ?? note.content,
      baseVersion: previous?.baseVersion ?? note.version,
      updatedAt: new Date().toISOString(),
      ...values,
    };
    try {
      keepDrafts({ ...draftRef.current, [note.id]: next });
      setError('');
    } catch {
      setError('设备存储空间不足，请先复制文字备份。');
      // Retain the current keystroke in memory even if device storage is full.
      draftRef.current = { ...draftRef.current, [note.id]: next };
      setDrafts(draftRef.current);
    }
  }
  function close() {
    if (!flush()) return;
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus({ preventScroll: true }));
  }
  function create() {
    if (!flush()) return;
    try {
      const id = uid();
      store.change('notes', id, {
        title: '',
        content: '',
        archived: false,
        updatedAt: new Date().toISOString(),
      });
      setSelected(id);
      setArchived(false);
      setSearch('');
      setSizing(false);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function archiveNote() {
    if (!note || !flush()) return;
    try {
      const current = store.getSnapshot().data.notes.find((n) => n.id === note.id)!;
      store.change('notes', note.id, {
        ...stripEntity(current),
        archived: !current.archived,
        updatedAt: new Date().toISOString(),
      });
      setSelected(null);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function remove() {
    if (!note || !confirm('永久删除这篇笔记？归档可以保留内容，删除后无法撤销。')) return;
    try {
      store.change('notes', note.id, null);
      const next = { ...draftRef.current };
      delete next[note.id];
      keepDrafts(next);
      setSelected(null);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function pointerDown(event: ReactPointerEvent<HTMLElement>, type: 'move' | 'resize') {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    interaction.current = { type, x: event.clientX, y: event.clientY, frame };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: ReactPointerEvent<HTMLElement>) {
    const start = interaction.current;
    if (!start) return;
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    setFrame(
      fit(
        start.type === 'move'
          ? { ...start.frame, x: start.frame.x + dx, y: start.frame.y + dy }
          : { ...start.frame, width: start.frame.width + dx, height: start.frame.height + dy },
      ),
    );
  }
  const pointerEvents = {
    onPointerMove: pointerMove,
    onPointerUp: () => {
      interaction.current = null;
    },
    onPointerCancel: () => {
      interaction.current = null;
    },
    onLostPointerCapture: () => {
      interaction.current = null;
    },
  };
  const localDraft = Object.keys(drafts).length > 0;
  const status = error
    ? '保存遇到问题'
    : localDraft
      ? '正在记录…'
      : view.status === 'demo'
        ? '已保存在本机 · 体验模式'
        : view.status === 'saved'
          ? '已同步到账号'
          : view.status === 'offline'
            ? '离线 · 已留存本机'
            : view.status === 'conflict'
              ? '内容有冲突 · 点击处理'
              : view.status === 'error'
                ? '保存待重试'
                : '正在同步…';

  return (
    <div className="notepad-root" data-floating-tools>
      {!open && !embedded && (
        <button
          ref={launcher}
          className="notepad-launcher"
          onClick={() => setOpen(true)}
          aria-label="打开悬浮记事本"
          title="打开悬浮记事本"
          aria-expanded={false}
        >
          <NotebookPen size={22} />
          <span>随手记</span>
          <i />
        </button>
      )}
      {(open || embedded) && (
        <section
          ref={windowRef}
          tabIndex={-1}
          className={embedded ? 'notepad-page' : 'notepad-window'}
          role="region"
          aria-label={embedded ? '记事本工作区' : '悬浮记事本'}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) flush();
          }}
          style={
            embedded
              ? undefined
              : {
                  left: frame.x,
                  top: frame.y,
                  width: frame.width,
                  height: frame.height,
                  borderRadius: frame.radius,
                }
          }
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !embedded) {
              e.stopPropagation();
              close();
            }
          }}
        >
          <header
            className="notepad-titlebar"
            data-testid="notepad-move"
            onPointerDown={(e) => {
              if (!embedded) pointerDown(e, 'move');
            }}
            {...pointerEvents}
          >
            <NotebookPen size={18} />
            {embedded ? (
              <div className="notepad-page-title">
                <span className="eyebrow">YOUR FIELD NOTES</span>
                <h1>记事本</h1>
              </div>
            ) : (
              <strong>冒险手记</strong>
            )}
            <GripHorizontal size={18} className="notepad-grip" />
            <button
              className={`icon-button ${embedded ? 'notepad-hidden' : ''}`}
              aria-label="调整记事本外形"
              aria-pressed={sizing}
              onClick={() => setSizing((v) => !v)}
            >
              <SlidersHorizontal size={18} />
            </button>
            <button
              className="icon-button notepad-close"
              aria-label={embedded ? '切换为悬浮记事本' : '收起记事本'}
              onClick={() => {
                if (embedded) {
                  setOpen(true);
                  onFloat();
                } else close();
              }}
            >
              {embedded ? (
                <>
                  <Minimize2 size={18} />
                  <span>悬浮记事</span>
                </>
              ) : (
                <X size={20} />
              )}
            </button>
          </header>
          {sizing && !embedded && (
            <div className="notepad-sizing">
              <div className="notepad-presets">
                <button
                  onClick={() => setFrame((v) => fit({ ...v, width: 400, height: 400, radius: 0 }))}
                >
                  方形
                </button>
                <button
                  onClick={() =>
                    setFrame((v) => fit({ ...v, width: 400, height: 520, radius: 24 }))
                  }
                >
                  圆角
                </button>
                <button
                  onClick={() => setFrame((v) => fit({ ...v, width: 600, height: 320, radius: 4 }))}
                >
                  长条
                </button>
                <button
                  onClick={() =>
                    setFrame(fit({ x: 16, y: 80, width: 400, height: 520, radius: 4 }))
                  }
                >
                  复位
                </button>
              </div>
              <div className="notepad-dimensions">
                <label>
                  宽
                  <input
                    aria-label="记事本宽度"
                    type="number"
                    min="280"
                    max={innerWidth - 16}
                    value={Math.round(frame.width)}
                    onChange={(e) => setFrame((v) => fit({ ...v, width: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  高
                  <input
                    aria-label="记事本高度"
                    type="number"
                    min="300"
                    max={innerHeight - 24}
                    value={Math.round(frame.height)}
                    onChange={(e) => setFrame((v) => fit({ ...v, height: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  圆角
                  <input
                    aria-label="记事本圆角"
                    type="range"
                    min="0"
                    max="40"
                    value={frame.radius}
                    onChange={(e) => setFrame((v) => ({ ...v, radius: Number(e.target.value) }))}
                  />
                </label>
              </div>
            </div>
          )}
          <div className="notepad-toolbar">
            {selected && (
              <button
                className="icon-button notepad-back"
                aria-label="返回笔记列表"
                onClick={() => {
                  if (flush()) setSelected(null);
                }}
              >
                <ArrowLeft size={19} />
              </button>
            )}
            {(!selected || embedded) && (
              <div className="notepad-tabs" role="group" aria-label="笔记范围">
                <button
                  aria-pressed={!archived}
                  onClick={() => {
                    if (flush()) {
                      setArchived(false);
                      setSelected(null);
                    }
                  }}
                >
                  笔记
                </button>
                <button
                  aria-pressed={archived}
                  onClick={() => {
                    if (flush()) {
                      setArchived(true);
                      setSelected(null);
                    }
                  }}
                >
                  归档 <span>{allNotes.filter((n) => n.archived).length}</span>
                </button>
              </div>
            )}
            <button className="text-button" disabled={!view.loaded} onClick={create}>
              <Plus size={17} />
              新建笔记
            </button>
          </div>
          <div className={`notepad-body ${selected ? 'has-selection' : ''}`}>
            {(embedded || !selected || (!note && !draft)) && (
              <div className="notepad-library">
                <label className="note-search">
                  <Search size={16} />
                  <input
                    aria-label="搜索笔记"
                    placeholder="搜索手记"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="note-list">
                  {visible.map((n) => (
                    <button
                      className="note-card"
                      aria-pressed={selected === n.id}
                      key={n.id}
                      onClick={() => setSelected(n.id)}
                    >
                      <strong>{drafts[n.id]?.title || n.title || '未命名笔记'}</strong>
                      <p>{(drafts[n.id]?.content ?? n.content) || '还没有写下内容'}</p>
                      <small>
                        {new Date(n.updatedAt).toLocaleDateString('zh-CN')} ·{' '}
                        {n.archived ? '已归档' : '手记'}
                      </small>
                    </button>
                  ))}
                  {!visible.length && (
                    <div className="note-empty">
                      <NotebookPen size={32} />
                      <strong>
                        {search
                          ? '没有找到这篇手记'
                          : archived
                            ? '归档的手记会在这里'
                            : '捡起一个小小的灵感'}
                      </strong>
                      <p>{archived ? '恢复后可以继续编辑。' : '点“新建笔记”，随时记下。'}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            {selected && (note || draft) ? (
              <div className="notepad-editor">
                <input
                  className="note-title"
                  autoFocus
                  aria-label="笔记标题"
                  placeholder="给灵感起个名字"
                  maxLength={200}
                  readOnly={note?.archived}
                  value={draft?.title ?? note?.title ?? ''}
                  onChange={(e) => edit({ title: e.target.value })}
                />
                <textarea
                  aria-label="笔记正文"
                  placeholder={'此刻想到的，先写在这里。\n收起窗口也会保留。'}
                  maxLength={20000}
                  readOnly={note?.archived}
                  value={draft?.content ?? note?.content ?? ''}
                  onChange={(e) => edit({ content: e.target.value })}
                />
                <div className="notepad-editor-actions">
                  <button className="text-button" onClick={archiveNote}>
                    {note?.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
                    {note?.archived ? '恢复笔记' : '归档笔记'}
                  </button>
                  <small>{(draft?.content ?? note?.content ?? '').length} / 20000</small>
                  <button className="icon-button danger" aria-label="删除笔记" onClick={remove}>
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            ) : (
              embedded && (
                <div className="notepad-welcome">
                  <NotebookPen size={48} />
                  <h2>把灵感收进手记</h2>
                  <p>
                    选择一篇笔记继续写，或记录新的想法。
                    <br />
                    笔记与归档随账号同步。
                  </p>
                </div>
              )
            )}
          </div>
          <footer className="notepad-status">
            <button onClick={onSync} title="查看保存与同步状态">
              <Cloud size={14} />
              {status}
            </button>
            <span
              className="notepad-resize"
              data-testid="notepad-resize"
              tabIndex={0}
              role="button"
              aria-label="调整记事本大小，方向键微调"
              onPointerDown={(e) => pointerDown(e, 'resize')}
              {...pointerEvents}
              onKeyDown={(e) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
                e.preventDefault();
                const step = e.shiftKey ? 32 : 8;
                setFrame((v) =>
                  fit({
                    ...v,
                    width:
                      v.width + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0),
                    height:
                      v.height + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0),
                  }),
                );
              }}
            >
              <Grip size={22} />
            </span>
          </footer>
          {error && (
            <div className="notepad-error" role="alert">
              <AlertCircle size={15} />
              {error}
              <button className="text-button" onClick={flush}>
                重试
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
