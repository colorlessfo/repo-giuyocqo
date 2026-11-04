import * as Dialog from '@radix-ui/react-dialog';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Flame,
  Pause,
  Play,
  Settings2,
  SkipForward,
  Square,
  ChartNoAxesCombined,
  RefreshCw,
  Check,
} from 'lucide-react';
import { Mascot, Modal } from './ui';
import { focusRemaining, focusedMs } from '../shared/focus.mjs';
import type { FocusView } from './focusTypes';
import type { FocusStore } from './focusStore';
import type { Task } from './types';

export interface FocusExperienceHandle {
  launch: () => void;
  configure: () => void;
  open: () => void;
}
export function focusTime(ms: number) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
export function focusDuration(ms: number) {
  if (ms <= 0) return '0 分钟';
  if (ms < 60000) return '不足 1 分钟';
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分钟` : ''}` : `${m} 分钟`;
}
function Cinematic({ done }: { done: () => void }) {
  const [reduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const callback = useRef(done);
  callback.current = done;
  useEffect(() => {
    const timer = setTimeout(() => callback.current(), reduced ? 450 : 3800);
    return () => clearTimeout(timer);
  }, [reduced]);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) done();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="focus-cinematic-overlay" />
        <Dialog.Content
          className={`focus-cinematic ${reduced ? 'reduced' : ''}`}
          aria-describedby="focus-cinematic-description"
        >
          <Dialog.Title className="sr-only">小狐狸点亮专注火把</Dialog.Title>
          <Dialog.Description id="focus-cinematic-description" className="sr-only">
            小狐狸跑入画面，踏出像素尘埃，点亮火把后进入计时器。动画约四秒，可跳过。
          </Dialog.Description>
          <div className="focus-stage-light" aria-hidden="true" />
          <div className="focus-stage-ground" aria-hidden="true" />
          <div className="focus-hero" aria-hidden="true">
            <Mascot size={360} />
          </div>
          <div className="focus-pixel-dust" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} style={{ '--dust': i } as React.CSSProperties} />
            ))}
          </div>
          <p className="focus-cinematic-copy" aria-hidden="true">
            <span>LIGHT YOUR TORCH</span>点亮火把，专注当下
          </p>
          <button className="button focus-skip" onClick={done}>
            <SkipForward size={17} />
            跳过动画
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
const FocusExperience = forwardRef<
  FocusExperienceHandle,
  { store: FocusStore; view: FocusView; ready: boolean; tasks: Task[]; onAnalytics: () => void }
>(function FocusExperience({ store, view, ready, tasks, onAnalytics }, ref) {
  const [setup, setSetup] = useState(false),
    [open, setOpen] = useState(false),
    [intro, setIntro] = useState(false),
    [cancel, setCancel] = useState(false);
  const [minutes, setMinutes] = useState(() => {
    try {
      return localStorage.getItem(`qiyu-focus-minutes:${store.userId}`) || '25';
    } catch {
      return '25';
    }
  });
  const [label, setLabel] = useState(''),
    [lastId, setLastId] = useState('');
  const [, tick] = useState(0);
  const active = view.data.profile.active;
  const now = view.data.serverNow + performance.now() - view.observedAt;
  const remaining = focusRemaining(active, now);
  const blocked = !ready || !view.loaded || view.busy || view.pending;
  const valid = Number.isInteger(Number(minutes)) && Number(minutes) >= 1 && Number(minutes) <= 480;
  useEffect(() => {
    if (active?.status !== 'running') return;
    const timer = setInterval(() => tick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [active?.id, active?.status]);
  useEffect(() => {
    setCancel(false);
  }, [active?.id]);
  useEffect(() => {
    if (active?.status === 'running' && remaining <= 0 && !blocked && !view.error)
      void store.act({ type: 'finish', sessionId: active.id });
  }, [active?.id, remaining, blocked, view.error, store]);
  async function launch(custom = false) {
    if (store.getSnapshot().data.profile.active) {
      setLastId(store.getSnapshot().data.profile.active!.id);
      setOpen(true);
      return;
    }
    if (blocked) return;
    setSetup(false);
    const duration = custom ? Number(minutes) : Number(minutes) || 25;
    const result = await store.act({
      type: 'start',
      minutes: duration,
      label: custom ? label : '',
    });
    if (result?.profile.active) {
      setLastId(result.profile.active.id);
      setIntro(true);
      try {
        localStorage.setItem(`qiyu-focus-minutes:${store.userId}`, String(duration));
      } catch {
        /* Optional choice. */
      }
    } else setOpen(true);
  }
  useImperativeHandle(ref, () => ({
    launch: () => {
      void launch();
    },
    configure: () => setSetup(true),
    open: () => {
      if (active) {
        setLastId(active.id);
        setOpen(true);
      } else setSetup(true);
    },
  }));
  const record = view.data.records.find((r) => r.id === lastId);
  const error = view.error ? (
    <div className="focus-error" role="status">
      <span>{view.error}</span>
      <button className="text-button" onClick={store.retry}>
        <RefreshCw size={15} />
        重试
      </button>
    </div>
  ) : null;
  return (
    <>
      {intro && (
        <Cinematic
          done={() => {
            setIntro(false);
            setOpen(true);
          }}
        />
      )}
      {setup && (
        <Modal
          title="准备一段专注"
          description="选好时长，和小狐狸一起点亮火把。"
          onClose={() => setSetup(false)}
        >
          <form
            className="focus-setup form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) void launch(true);
            }}
          >
            <label className="field">
              <span>专注内容（可选）</span>
              <input
                maxLength={120}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="例如：读完一章书"
                list="focus-task-options"
              />
              <datalist id="focus-task-options">
                {tasks.slice(0, 30).map((t) => (
                  <option key={t.id} value={t.title.slice(0, 120)} />
                ))}
              </datalist>
            </label>
            <div className="focus-presets" role="group" aria-label="专注时长">
              {[15, 25, 45, 60].map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={minutes === String(value)}
                  onClick={() => setMinutes(String(value))}
                >
                  {value} 分钟
                </button>
              ))}
            </div>
            <label className="field">
              <span>自定义分钟</span>
              <input
                type="number"
                min="1"
                max="480"
                step="1"
                required
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </label>
            {error}
            <button className="button primary" disabled={blocked || !valid}>
              <Flame size={18} />
              点亮火把，开始专注
            </button>
            <p className="focus-help">
              暂停不计时，刷新或切换页面后可继续。计时不会自动完成待办；关闭网页后没有系统提醒。
            </p>
          </form>
        </Modal>
      )}
      {open && !intro && (
        <Modal
          title={active ? '专注倒计时' : record ? '专注记录' : '专注进度'}
          description="专注计时器，可暂停、继续、提前结束或收起。"
          onClose={() => setOpen(false)}
          wide
          minimal
        >
          <div className="focus-timer-panel">
            {error}
            {view.pending && (
              <p className="focus-help" role="status">
                操作已保留，正在等待联网确认。
              </p>
            )}
            <div className="focus-timer-emblem">
              <Mascot size={86} />
              <span />
            </div>
            {active ? (
              <>
                {active.label !== '点亮火把，专注当下' && <h3>{active.label}</h3>}
                <div
                  className="focus-big-clock"
                  role="timer"
                  aria-label={`专注剩余 ${focusTime(remaining)}`}
                >
                  {focusTime(remaining)}
                </div>
                <div
                  className="focus-timer-progress"
                  role="progressbar"
                  aria-label="专注进度"
                  aria-valuenow={Math.round((1 - remaining / (active.minutes * 60000)) * 100)}
                >
                  <i
                    style={{
                      width: `${Math.max(0, 100 - (remaining / (active.minutes * 60000)) * 100)}%`,
                    }}
                  />
                </div>
                <div className="focus-timer-actions">
                  <button
                    className="button primary"
                    disabled={blocked || remaining <= 0}
                    onClick={() =>
                      void store.act({
                        type: active.status === 'paused' ? 'resume' : 'pause',
                        sessionId: active.id,
                      })
                    }
                  >
                    {active.status === 'paused' ? <Play size={18} /> : <Pause size={18} />}{' '}
                    {active.status === 'paused' ? '继续专注' : '暂停休息'}
                  </button>
                  <button
                    className="button"
                    disabled={blocked || remaining <= 0}
                    onClick={() => setCancel(true)}
                  >
                    <Square size={15} />
                    提前结束
                  </button>
                  <button className="text-button" onClick={() => setOpen(false)}>
                    收起计时器
                  </button>
                </div>
                {remaining <= 0 && (
                  <p role="status" className="focus-help">
                    正在保存本次专注记录…
                  </p>
                )}
                {cancel && (
                  <div className="focus-cancel" role="group" aria-label="确认提前结束">
                    <p>结束本次专注？已专注的时间会保留在分析中，并标记为提前结束。</p>
                    <button className="button small" onClick={() => setCancel(false)}>
                      继续这次专注
                    </button>
                    <button
                      className="button danger small"
                      disabled={blocked}
                      onClick={() => void store.act({ type: 'cancel', sessionId: active.id })}
                    >
                      确认结束
                    </button>
                  </div>
                )}
              </>
            ) : record ? (
              <div className="focus-finished" role="status">
                <Check size={30} />
                <h3>{record.status === 'completed' ? '完成了一段专注' : '这段专注已保留'}</h3>
                <strong>{focusDuration(focusedMs(record, record.endedAt!))}</strong>
                <p>{record.label}</p>
                <div className="focus-timer-actions">
                  <button
                    className="button primary"
                    onClick={() => {
                      setOpen(false);
                      setSetup(true);
                    }}
                  >
                    再点亮一次火把
                  </button>
                  <button
                    className="button"
                    onClick={() => {
                      setOpen(false);
                      onAnalytics();
                    }}
                  >
                    <ChartNoAxesCombined size={18} />
                    查看专注分析
                  </button>
                </div>
              </div>
            ) : (
              <div className="focus-finished">
                <p className="focus-help">
                  {view.pending ? '正在准备专注…' : '目前没有进行中的专注。'}
                </p>
                <button
                  className="button"
                  disabled={blocked}
                  onClick={() => {
                    setOpen(false);
                    setSetup(true);
                  }}
                >
                  选择专注时长
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
      {(active || view.pending) && !intro && (
        <div className="floating-island focus-island">
          <Mascot size={34} />
          <button
            className="focus-island-open"
            aria-label="打开专注计时器"
            onClick={() => {
              if (active) setLastId(active.id);
              setOpen(true);
            }}
          >
            <span>
              {active ? (active.status === 'paused' ? '专注已暂停' : active.label) : '专注等待同步'}
            </span>
            <b>{focusTime(remaining)}</b>
          </button>
          {active && remaining > 0 && (
            <button
              className="focus-island-pause"
              aria-label={active.status === 'paused' ? '继续专注' : '暂停专注'}
              disabled={blocked}
              onClick={() =>
                void store.act({
                  type: active.status === 'paused' ? 'resume' : 'pause',
                  sessionId: active.id,
                })
              }
            >
              {active.status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
            </button>
          )}
        </div>
      )}
    </>
  );
});
export default FocusExperience;
