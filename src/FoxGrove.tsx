import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  Nut as Acorn,
  ArrowRight,
  Check,
  Download,
  Gift,
  Leaf,
  Pause,
  Play,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  TreePine,
  X,
} from 'lucide-react';
import { GROVE_ITEMS, MATERIALS, focusRemaining } from '../shared/grove.mjs';
import { GroveStore } from './groveStore';
import { Mascot, Modal } from './ui';
import GroveScene, { GroveHouse } from './GroveScene';
import type { FoxSkin, GroveHome, GroveMaterial } from './groveTypes';
import type { Task } from './types';

const petWords = ['蹭蹭你，继续加油！', '尾巴摇起来了。', '我会陪着你的。', '今天也有小小的奇遇。'];
export default function FoxGrove({
  userId,
  demo,
  ready,
  sidebarSlot,
  mobileSlot,
  effects,
  tasks,
}: {
  userId: string;
  demo: boolean;
  ready: boolean;
  sidebarSlot: HTMLElement | null;
  mobileSlot: HTMLElement | null;
  effects: boolean;
  tasks: Task[];
}) {
  const store = useMemo(() => new GroveStore(userId, demo), [userId, demo]);
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => store.start(), [store]);
  const { state } = view;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'focus' | 'shop' | 'collection'>('focus');
  const [minutes, setMinutes] = useState('25');
  const [label, setLabel] = useState('');
  const [, setTick] = useState(0);
  const [message, setMessage] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const petStep = useRef(0);
  useEffect(() => {
    dialog.current?.closest('.modal-content')?.scrollTo({ top: 0, behavior: 'auto' });
  }, [open, tab, state.session?.id]);
  useEffect(() => {
    if (state.session?.status !== 'running') return;
    const interval = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(interval);
  }, [state.session?.id, state.session?.status]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4200);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => setCancelOpen(false), [state.session?.id]);
  const now = view.serverNow + performance.now() - view.observedAt;
  const session = state.session;
  const remaining = focusRemaining(session, now);
  const complete = !!session && session.status === 'running' && remaining === 0;
  const exploring = !!session && !complete;
  const running = exploring && session?.status === 'running';
  const elapsed = session ? Math.max(0, session.minutes * 60 - remaining / 1000) : 0;
  const seconds = Math.ceil(remaining / 1000);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const validMinutes =
    Number(minutes) >= 1 && Number(minutes) <= 180 && Number.isInteger(Number(minutes));
  const blocked = !ready || !view.loaded || view.busy || view.pending;
  const status = complete
    ? '战利品等你领取'
    : session?.status === 'paused'
      ? '枝头休息中'
      : running
        ? '小狐狸正在探索'
        : '留一点专注，养一片森林';
  const activity = [
    '在树根寻找种子',
    '沿藤蔓向上攀爬',
    '收集叶间的微光',
    '坐在枝头看看星星',
    '把发现放进小背包',
    '提着火把慢慢回家',
  ][Math.floor(elapsed / 9) % 6];
  function pet() {
    setMessage(petWords[petStep.current++ % petWords.length]);
  }
  function show(next: typeof tab = 'focus') {
    setTab(next);
    setOpen(true);
  }
  function exportGrove() {
    const href = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { app: '奇遇 DDL 树屋', exportedAt: new Date().toISOString(), state },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const a = document.createElement('a');
    a.href = href;
    a.download = '奇遇DDL-树屋记录.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  const sceneProps = {
    state,
    elapsed,
    exploring,
    running: running && effects,
    onPet: pet,
    message,
  };
  return (
    <>
      <div className="grove-trail" aria-label="小狐狸的藤蔓树屋场景">
        <GroveScene {...sceneProps} />
      </div>
      {sidebarSlot &&
        createPortal(
          <div className="grove-dock">
            <button
              className={`grove-focus-button ${session ? 'has-session' : ''}`}
              onClick={() => show()}
              aria-label={
                session
                  ? `专注树屋，${complete ? '领取战利品' : `剩余${clock}`}`
                  : '开始专注，打开狐狸树屋'
              }
            >
              {complete ? (
                <Gift size={20} />
              ) : session ? (
                <span className="grove-clock-mini">{clock}</span>
              ) : (
                <TreePine size={20} />
              )}
              <span>
                {complete
                  ? '领取战利品'
                  : session
                    ? session.status === 'paused'
                      ? '继续专注'
                      : '专注进行中'
                    : '开始专注'}
                <small>{session ? '回到狐狸树屋' : '和小狐狸一起出发'}</small>
              </span>
              <ArrowRight size={14} />
            </button>
            <div className="grove-nest">
              <GroveHouse kind={state.home} />
              {!exploring && (
                <button className="grove-nest-fox" onClick={pet} aria-label="抚摸小窝里的狐狸">
                  <Mascot size={65} skin={state.skin} />
                  {message && <span className="grove-speech">{message}</span>}
                </button>
              )}
              <button
                className="grove-house-entry"
                onClick={() => show('shop')}
                aria-label="装扮狐狸的小窝"
              >
                {exploring ? '出门探险了…' : '小狐狸的家'}
                <span>
                  <Acorn size={13} />
                  {state.acorns}
                </span>
              </button>
            </div>
          </div>,
          sidebarSlot,
        )}
      {mobileSlot &&
        createPortal(
          <button
            className="grove-mobile-entry"
            onClick={() => show()}
            aria-label="打开狐狸专注树屋"
          >
            <Mascot size={43} skin={state.skin} />
            <span>
              <strong>
                {session ? (complete ? '领取专注战利品' : `专注 ${clock}`) : '小狐狸的专注树屋'}
              </strong>
              <small>{status}</small>
            </span>
            <span className="grove-mobile-acorns">
              <Acorn size={17} />
              {state.acorns}
            </span>
            <ArrowRight size={18} />
          </button>,
          mobileSlot,
        )}
      {open && (
        <Modal
          title="小狐狸的专注树屋"
          description="你专注当下，它收集微光。把一点点认真，变成一座喜欢的家。"
          onClose={() => setOpen(false)}
          wide
        >
          <div
            ref={dialog}
            className={`grove-dialog ${effects ? '' : 'grove-motion-off'} ${tab === 'focus' && session ? 'grove-focus-active' : ''}`}
          >
            <nav className="grove-tabs" aria-label="树屋功能">
              {(
                [
                  ['focus', '专注探险', TreePine],
                  ['shop', '奇遇商店', ShoppingBag],
                  ['collection', '背包与记录', Gift],
                ] as const
              ).map(([id, title, Icon]) => (
                <button
                  key={id}
                  className={tab === id ? 'active' : ''}
                  aria-pressed={tab === id}
                  onClick={() => setTab(id)}
                >
                  <Icon size={17} />
                  {title}
                </button>
              ))}
            </nav>
            {view.error && (
              <div className="grove-error" role="status">
                <span>{view.error}</span>
                {!demo && (
                  <button className="text-button" onClick={store.retry}>
                    <RefreshCw size={15} />
                    重试
                  </button>
                )}
              </div>
            )}
            {view.pending && (
              <p className="grove-pending" role="status">
                操作已保留，正在等待同步。请勿重复提交。
              </p>
            )}
            <div className="grove-dialog-body">
              <div className="grove-preview">
                <span className="grove-preview-caption">THE LITTLE GROVE</span>
                <GroveScene {...sceneProps} large />
                <div className="grove-activity" aria-live="polite">
                  {complete
                    ? '背包已经装满，回家领取吧。'
                    : session?.status === 'paused'
                      ? '先在枝头歇一会儿，等你回来。'
                      : running
                        ? activity
                        : message || '点点小狐狸，和它打个招呼。'}
                </div>
              </div>
              <div className="grove-content">
                <div className="grove-wallet">
                  <span>
                    <Acorn size={22} />
                    <b>{state.acorns}</b> 橡果
                  </span>
                  <small>累计专注 {state.totalMinutes} 分钟</small>
                </div>
                {tab === 'focus' && (
                  <>
                    {session ? (
                      <section className="grove-timer-section">
                        <span className="grove-kicker">{status}</span>
                        <h3>{session.label}</h3>
                        <div
                          className={`grove-timer ${complete ? 'finished' : ''}`}
                          role="timer"
                          aria-label={`专注剩余 ${clock}`}
                        >
                          {clock}
                        </div>
                        <div
                          className="grove-progress"
                          role="progressbar"
                          aria-label="本次专注进度"
                          aria-valuenow={Math.round(
                            Math.min(100, (elapsed / (session.minutes * 60)) * 100),
                          )}
                        >
                          <i
                            style={{
                              width: `${Math.min(100, (elapsed / (session.minutes * 60)) * 100)}%`,
                            }}
                          />
                        </div>
                        <p className="grove-earned-preview">
                          完成可得 <b>{session.minutes * 2} 橡果</b> 和一份探索材料
                        </p>
                        <div className="grove-timer-actions">
                          {complete ? (
                            <button
                              className="button primary"
                              disabled={blocked}
                              onClick={() =>
                                void store.act({ type: 'claim', sessionId: session.id })
                              }
                            >
                              <Gift size={19} />
                              领取本次战利品
                            </button>
                          ) : (
                            <button
                              className="button primary"
                              disabled={blocked}
                              onClick={() =>
                                void store.act({
                                  type: session.status === 'paused' ? 'resume' : 'pause',
                                  sessionId: session.id,
                                })
                              }
                            >
                              {session.status === 'paused' ? (
                                <Play size={18} />
                              ) : (
                                <Pause size={18} />
                              )}{' '}
                              {session.status === 'paused' ? '继续专注' : '暂停休息'}
                            </button>
                          )}
                          {!complete && (
                            <button
                              className="button"
                              disabled={blocked}
                              onClick={() => setCancelOpen(true)}
                            >
                              <X size={17} />
                              提前结束
                            </button>
                          )}
                        </div>
                        {cancelOpen && (
                          <div className="grove-cancel" role="group" aria-label="确认提前结束">
                            <p>结束本次专注？未完成的探险不会获得奖励，已有物品会保留。</p>
                            <button className="button small" onClick={() => setCancelOpen(false)}>
                              继续这次探险
                            </button>
                            <button
                              className="button danger small"
                              disabled={blocked}
                              onClick={() =>
                                void store.act({ type: 'cancel', sessionId: session.id })
                              }
                            >
                              确认结束
                            </button>
                          </div>
                        )}
                      </section>
                    ) : (
                      <>
                        {state.lastReward && (
                          <div className="grove-reward-card" role="status">
                            <Gift size={27} />
                            <div>
                              <strong>上次探险带回了礼物</strong>
                              <p>
                                +{state.lastReward.acorns} 橡果 ·{' '}
                                {MATERIALS[state.lastReward.material]} ×{state.lastReward.quantity}
                              </p>
                            </div>
                            <button className="text-button" onClick={() => setTab('shop')}>
                              去装扮
                              <ArrowRight size={15} />
                            </button>
                          </div>
                        )}
                        <form
                          className="grove-start-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (validMinutes && !blocked)
                              void store.act({ type: 'start', minutes: Number(minutes), label });
                          }}
                        >
                          <span className="grove-kicker">A LITTLE FOCUS, A LITTLE MAGIC</span>
                          <h3>种下一段专注时光</h3>
                          <label className="field">
                            <span>这次想专注什么？</span>
                            <input
                              value={label}
                              onChange={(e) => setLabel(e.target.value)}
                              maxLength={120}
                              placeholder="例如：读完一章书（可不填）"
                              list="grove-task-suggestions"
                            />
                            <datalist id="grove-task-suggestions">
                              {tasks.slice(0, 30).map((t) => (
                                <option key={t.id} value={t.title} />
                              ))}
                            </datalist>
                          </label>
                          <div
                            className="grove-duration-presets"
                            role="group"
                            aria-label="常用专注时长"
                          >
                            {[15, 25, 45, 60].map((n) => (
                              <button
                                type="button"
                                key={n}
                                className={minutes === String(n) ? 'active' : ''}
                                aria-pressed={minutes === String(n)}
                                onClick={() => setMinutes(String(n))}
                              >
                                {n} 分钟
                              </button>
                            ))}
                          </div>
                          <label className="field grove-duration">
                            <span>自定义时长</span>
                            <span>
                              <input
                                type="number"
                                min="1"
                                max="180"
                                step="1"
                                value={minutes}
                                onChange={(e) => setMinutes(e.target.value)}
                                required
                                aria-label="专注分钟"
                              />{' '}
                              分钟 <small>1–180 分钟</small>
                            </span>
                          </label>
                          <button
                            className="button primary grove-start"
                            type="submit"
                            disabled={blocked || !validMinutes}
                          >
                            <Play size={18} />
                            开始专注探险
                          </button>
                        </form>
                      </>
                    )}
                    <p className="grove-rules">
                      {session
                        ? '完成后领取奖励；暂停不计时，刷新继续。提前结束不扣已有奖励。'
                        : '每专注 1 分钟获得 2 橡果；完整结束后领取材料。暂停不计时，切换页面或刷新后继续。'}
                    </p>
                    <p className="grove-quiet-note">
                      计时不会自动完成待办；关闭网页后没有系统提醒。
                    </p>
                  </>
                )}
                {tab === 'shop' && (
                  <>
                    <p className="grove-shop-intro">
                      专注赚来的橡果，换一份小小的喜欢。兑换后立即穿戴，也可随时换回。
                    </p>
                    <div className="grove-shop">
                      {GROVE_ITEMS.map((item) => {
                        const owned = state.owned.includes(item.id);
                        const equipped =
                          state.skin === item.id ||
                          state.home === item.id ||
                          state.decorations.includes(item.id);
                        const material = item.material as GroveMaterial | undefined;
                        const enough =
                          state.acorns >= item.acorns &&
                          (!material || state.materials[material] >= (item.quantity || 0));
                        return (
                          <article
                            className={`grove-shop-item ${equipped ? 'equipped' : ''}`}
                            key={item.id}
                          >
                            <div className="grove-item-picture">
                              {item.kind === 'skin' ? (
                                <Mascot size={70} skin={item.id as FoxSkin} />
                              ) : item.kind === 'home' ? (
                                <GroveHouse kind={item.id as GroveHome} />
                              ) : item.id === 'lanterns' ? (
                                <span className="grove-decor-preview lantern-preview">▥</span>
                              ) : item.id === 'flowers' ? (
                                <span className="grove-decor-preview flower-preview">✿</span>
                              ) : (
                                <Sparkles className="grove-decor-preview" size={42} />
                              )}
                            </div>
                            <h4>{item.name}</h4>
                            <p>{item.description}</p>
                            <span className="grove-price">
                              <Acorn size={14} />
                              {item.acorns}
                              {material && (
                                <small>
                                  ＋{MATERIALS[material]} ×{item.quantity}
                                </small>
                              )}
                            </span>
                            <button
                              className="button small"
                              disabled={
                                blocked ||
                                (!owned && !enough) ||
                                (equipped && item.kind !== 'decor')
                              }
                              aria-label={`${owned ? (equipped ? (item.kind === 'decor' ? '收起' : '已穿戴') : '使用') : '兑换'}${item.name}`}
                              onClick={() =>
                                void store.act(
                                  owned
                                    ? { type: 'equip', itemId: item.id, enabled: !equipped }
                                    : { type: 'buy', itemId: item.id },
                                )
                              }
                            >
                              {owned ? (
                                equipped ? (
                                  item.kind === 'decor' ? (
                                    '收起装饰'
                                  ) : (
                                    <>
                                      <Check size={14} />
                                      已穿戴
                                    </>
                                  )
                                ) : (
                                  '使用装扮'
                                )
                              ) : enough ? (
                                '兑换并使用'
                              ) : (
                                '材料还不够'
                              )}
                            </button>
                          </article>
                        );
                      })}
                    </div>
                    <div className="grove-defaults">
                      <button
                        className="text-button"
                        disabled={blocked || state.skin === 'ember'}
                        onClick={() =>
                          void store.act({ type: 'equip', itemId: 'ember', enabled: true })
                        }
                      >
                        换回原色小狐
                      </button>
                      <button
                        className="text-button"
                        disabled={blocked || state.home === 'burrow'}
                        onClick={() =>
                          void store.act({ type: 'equip', itemId: 'burrow', enabled: true })
                        }
                      >
                        回到树根小窝
                      </button>
                    </div>
                  </>
                )}
                {tab === 'collection' && (
                  <>
                    <h3 className="grove-collection-title">小狐狸的背包</h3>
                    <div className="grove-materials">
                      {Object.entries(MATERIALS).map(([id, name]) => (
                        <div key={id}>
                          <Leaf size={21} />
                          <span>{name}</span>
                          <b>{state.materials[id as GroveMaterial]}</b>
                        </div>
                      ))}
                    </div>
                    <p className="grove-rules">
                      材料按苔光种子、暖光树脂、月光石依次带回。每次至少 1 份，50 分钟可带回 2
                      份，75 分钟 3 份。已兑换 {state.owned.length - 2} 件装扮。
                    </p>
                    <div className="grove-history-heading">
                      <h4>最近的专注足迹</h4>
                      <button className="text-button" onClick={exportGrove}>
                        <Download size={15} />
                        导出记录
                      </button>
                    </div>
                    {!state.history.length ? (
                      <p className="grove-empty">第一段奇遇，还在等你出发。</p>
                    ) : (
                      <ol className="grove-history">
                        {state.history.map((r) => (
                          <li key={r.sessionId}>
                            <span>
                              <strong>{r.label}</strong>
                              <small>
                                {new Date(r.finishedAt).toLocaleDateString('zh-CN')} · {r.minutes}{' '}
                                分钟
                              </small>
                            </span>
                            <span>
                              +{r.acorns} 橡果
                              <small>
                                {MATERIALS[r.material]} ×{r.quantity}
                              </small>
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </>
                )}
              </div>
            </div>
            <p className="grove-save-status">
              {demo
                ? '体验树屋：进度只保存在这个浏览器，与正式账号分开。'
                : view.busy || view.pending
                  ? '正在保存树屋进度…'
                  : view.offline
                    ? '离线浏览，联网后同步。'
                    : view.loaded
                      ? '树屋、装扮和奖励随账号保存，可跨设备继续。'
                      : '正在读取树屋…'}
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
