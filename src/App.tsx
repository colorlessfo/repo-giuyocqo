import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Cloud,
  CloudOff,
  FolderOpen,
  ImagePlus,
  LayoutList,
  LogIn,
  LogOut,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Download,
  RefreshCw,
  AlertCircle,
  ArrowRight,
  UserRound,
  KeyRound,
  X,
} from 'lucide-react';
import { api, ApiError, SyncStore } from './store';
import type { Category, Course, Task, User } from './types';
import { backupExport, CategoryManager, DataPanel, SemesterSettings } from './SettingsPanel';
import {
  countdown,
  courseSummary,
  dateKey,
  durationLabel,
  makeSettings,
  stripEntity,
  uid,
} from './lib';
import { Mascot, Modal, Field } from './ui';
import TaskEditor from './TaskEditor';
import Schedule from './Schedule';
import CourseImport from './CourseImport';
import CourseEditor from './CourseEditor';
import Auth from './Auth';
import { teachingWeek } from '../shared/time.mjs';

type Panel = 'categories' | 'semester' | 'data' | 'import' | 'account' | 'sync' | 'about' | null;
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let active = true;
    api<{ user: User }>('/api/auth/me')
      .then((result) => {
        if (active) setUser(result.user);
      })
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401))
          console.warn('Account check unavailable');
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const store = useMemo(() => new SyncStore(user?.id || 'demo', !user), [user?.id]);
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => store.start(), [store]);
  const data = view.data,
    settings = data.settings[0] || makeSettings();
  const [page, setPage] = useState<'tasks' | 'schedule' | 'courses'>('tasks');
  const [category, setCategory] = useState('all');
  const [completed, setCompleted] = useState(false);
  const [search, setSearch] = useState('');
  const [taskEditor, setTaskEditor] = useState<Task | 'new' | null>(null);
  const [courseEditor, setCourseEditor] = useState<Course | 'new' | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accountError, setAccountError] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (view.pending) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [view.pending]);
  function run(action: () => void, message?: string) {
    try {
      action();
      if (message) setToast(message);
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  function saveTask(id: string, values: Record<string, unknown>) {
    store.change('tasks', id, values);
  }
  function updateTask(task: Task, values: Partial<Task>) {
    store.change('tasks', task.id, { ...stripEntity(task), ...values });
  }
  function selectPage(next: typeof page) {
    setPage(next);
    setCategory('all');
    setSearch('');
  }
  function filterCategory(next: string) {
    setCategory(next);
    setPage('tasks');
  }
  const activeTasks = data.tasks.filter((t) => !t.completed);
  const selectedTasks = data.tasks
    .filter(
      (t) =>
        t.completed === completed &&
        (category === 'all' || (category === 'none' ? !t.categoryId : t.categoryId === category)) &&
        `${t.title} ${t.notes}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      completed
        ? Date.parse(b.completedAt || b.dueAt) - Date.parse(a.completedAt || a.dueAt)
        : Date.parse(a.dueAt) - Date.parse(b.dueAt),
    );
  const nextTask = [...activeTasks].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];
  const statusLabel =
    view.status === 'demo'
      ? '体验模式'
      : view.status === 'saved'
        ? '已同步'
        : view.status === 'syncing'
          ? '保存中…'
          : view.status === 'offline'
            ? '离线，已留存'
            : view.status === 'conflict'
              ? '需要处理冲突'
              : view.status === 'loading'
                ? '正在同步'
                : '保存待重试';
  const visibleCategory = data.categories.find((c) => c.id === category);
  const currentWeek = teachingWeek(new Date(), settings.semesterStart);
  const schedule = (
    <Schedule
      tasks={data.tasks}
      courses={data.courses}
      settings={settings}
      onEditTask={setTaskEditor}
      onEditCourse={setCourseEditor}
      onMove={(task, dueAt) => updateTask(task, { dueAt })}
      onImport={() => setPanel('import')}
      onNewCourse={() => setCourseEditor('new')}
      compact={page === 'tasks'}
    />
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            selectPage('tasks');
          }}
          aria-label="奇遇 DDL 首页"
        >
          <span className="brand-mark">
            <Sparkles size={23} />
          </span>
          <span>
            奇遇 <b>DDL</b>
            <small>A LITTLE ROOM FOR LIFE</small>
          </span>
        </a>
        <div className="sidebar-caption">你的每一天</div>
        <nav className="main-nav" aria-label="主导航">
          <button className={page === 'tasks' ? 'active' : ''} onClick={() => selectPage('tasks')}>
            <LayoutList size={21} />
            <span>我的待办</span>
            <small>{activeTasks.length}</small>
          </button>
          <button
            className={page === 'schedule' ? 'active' : ''}
            onClick={() => selectPage('schedule')}
          >
            <CalendarDays size={21} />
            <span>七日日程</span>
          </button>
          <button
            className={page === 'courses' ? 'active' : ''}
            onClick={() => selectPage('courses')}
          >
            <BookOpen size={21} />
            <span>我的课程</span>
          </button>
        </nav>
        <div className="sidebar-caption category-caption">
          <span>分类收纳</span>
          <button
            className="icon-button"
            aria-label="管理分类"
            onClick={() => setPanel('categories')}
          >
            <Plus size={17} />
          </button>
        </div>
        <nav className="category-nav" aria-label="任务分类">
          {data.categories.map((c) => (
            <button
              key={c.id}
              className={category === c.id && page === 'tasks' ? 'active' : ''}
              onClick={() => filterCategory(c.id)}
            >
              <i className={`category-dot ${c.color}`} />
              <span>{c.name}</span>
              <small>{activeTasks.filter((t) => t.categoryId === c.id).length}</small>
            </button>
          ))}
          <button
            onClick={() => filterCategory('none')}
            className={category === 'none' ? 'active' : ''}
          >
            <i className="category-dot slate" />
            <span>未分类</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-art">
            <span className="little-spark spark-one">✧</span>
            <Mascot size={88} />
            <span className="little-spark spark-two">✦</span>
            <p>
              事情一件件来，
              <br />
              日子慢慢发光。
            </p>
          </div>
          <button className="sidebar-import" onClick={() => setPanel('import')}>
            <ImagePlus size={19} />
            <span>图片导入课表</span>
            <ArrowUpRight size={16} />
          </button>
          <button className="sidebar-settings" onClick={() => setPanel('data')}>
            <Download size={18} />
            备份与日历导出
          </button>
          <button className="sidebar-settings" onClick={() => setPanel('semester')}>
            <Settings2 size={18} />
            学期与节次设置
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            我的空间 <ChevronRight size={14} />
            <span>
              {page === 'tasks' ? '待办清单' : page === 'schedule' ? '七日日程' : '学期课程'}
            </span>
          </div>
          <div className="topbar-right">
            <span className="today-date">
              <Sun size={17} />
              {format(new Date(), 'M月d日 EEEE', { locale: zhCN })}
            </span>
            <button
              className={`sync-indicator ${view.status}`}
              onClick={() => setPanel('sync')}
              title="查看同步状态"
            >
              {view.status === 'offline' ? (
                <CloudOff size={17} />
              ) : view.status === 'error' || view.status === 'conflict' ? (
                <AlertCircle size={17} />
              ) : (
                <Cloud size={17} />
              )}
              <span>{statusLabel}</span>
            </button>
            <button
              className="account-button"
              onClick={() => (user ? setPanel('account') : setAuthOpen(true))}
            >
              <span className="avatar">
                {user ? user.name.slice(0, 1) : <UserRound size={17} />}
              </span>
              <span>{user ? user.name : '登录 / 注册'}</span>
            </button>
          </div>
        </header>
        <main>
          {!user && (
            <div className="demo-banner">
              <span>
                <i />
                你正在体验示例空间，数据仅保存在这个浏览器。
              </span>
              <button disabled={checking} className="text-button" onClick={() => setAuthOpen(true)}>
                注册后开启同步
                <ArrowRight size={15} />
              </button>
            </div>
          )}
          {user && ['error', 'offline', 'conflict'].includes(view.status) && (
            <div role="status" className="connection-banner">
              <span>
                <AlertCircle size={17} />
                {view.error || '尚未同步的修改保留在本机。'}
              </span>
              <button className="text-button" onClick={() => setPanel('sync')}>
                查看并处理
              </button>
            </div>
          )}
          {page === 'tasks' && (
            <>
              <div className="page-intro">
                <div>
                  <span className="eyebrow">A LITTLE ROOM, A BETTER DAY</span>
                  <h1>
                    {visibleCategory
                      ? visibleCategory.name
                      : category === 'none'
                        ? '未分类'
                        : completed
                          ? '完成的每一步'
                          : '我的待办'}
                    <span className="title-dot">.</span>
                  </h1>
                  <p>
                    {completed ? '那些认真完成的小事，都在这里。' : '把重要的事，安排得从容一点。'}
                  </p>
                </div>
                <button
                  className="button primary add-task"
                  disabled={!view.loaded}
                  onClick={() => setTaskEditor('new')}
                >
                  <Plus size={20} />
                  添加待办
                </button>
              </div>
              <div className="list-toolbar">
                <div className="tabs" role="tablist" aria-label="任务状态">
                  <button
                    role="tab"
                    aria-selected={!completed}
                    className={!completed ? 'active' : ''}
                    onClick={() => setCompleted(false)}
                  >
                    待完成<span>{activeTasks.length}</span>
                  </button>
                  <button
                    role="tab"
                    aria-selected={completed}
                    className={completed ? 'active' : ''}
                    onClick={() => setCompleted(true)}
                  >
                    已完成
                    <CheckCheck size={16} />
                  </button>
                </div>
                <div className="list-tools">
                  <select
                    aria-label="筛选任务分类"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="all">全部分类</option>
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    <option value="none">未分类</option>
                  </select>
                  <button
                    className="icon-button"
                    aria-label="编辑分类"
                    onClick={() => setPanel('categories')}
                  >
                    <FolderOpen size={19} />
                  </button>
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="搜索任务"
                      placeholder="找一件事"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button
                        aria-label="清除搜索"
                        className="icon-button"
                        onClick={() => setSearch('')}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </label>
                </div>
              </div>
              <section className="task-list" aria-label={completed ? '已完成任务' : '待办任务'}>
                {!view.loaded ? (
                  <div className="empty-state">
                    <RefreshCw className="spin" size={26} />
                    <h3>正在取回你的安排…</h3>
                  </div>
                ) : selectedTasks.length ? (
                  selectedTasks.map((task) => {
                    const cat = data.categories.find((c) => c.id === task.categoryId);
                    const overdue = Date.parse(task.dueAt) < now;
                    const soon = Date.parse(task.dueAt) - now < 86400000;
                    return (
                      <article
                        className={`task-row ${task.completed ? 'completed' : ''}`}
                        key={task.id}
                        data-testid={`task-${task.id}`}
                      >
                        <button
                          className={`task-checkbox ${task.completed ? 'checked' : ''}`}
                          aria-label={`${task.completed ? '恢复' : '完成'}任务${task.title}`}
                          aria-pressed={task.completed}
                          onClick={() =>
                            run(
                              () =>
                                updateTask(task, {
                                  completed: !task.completed,
                                  completedAt: task.completed ? null : new Date().toISOString(),
                                }),
                              task.completed ? '已放回待办清单' : '又完成一件，真好。',
                            )
                          }
                        >
                          <Check size={16} />
                        </button>
                        <div className="task-copy">
                          <button className="task-title" onClick={() => setTaskEditor(task)}>
                            {task.title}
                          </button>
                          <div className="task-meta">
                            <span className={`category-tag ${cat?.color || 'slate'}`}>
                              <i />
                              {cat?.name || '未分类'}
                            </span>
                            <span>{format(new Date(task.dueAt), 'M月d日 HH:mm')} 截止</span>
                            <i className="meta-separator" />
                            <span>计划 {durationLabel(task.durationMinutes)}</span>
                          </div>
                          {task.notes && <p className="task-note">{task.notes}</p>}
                        </div>
                        <div className="task-right">
                          <span
                            className={`countdown ${task.completed ? 'done' : overdue ? 'overdue' : soon ? 'soon' : ''}`}
                          >
                            {task.completed ? '已完成' : countdown(task.dueAt, now)}
                          </span>
                          <Mascot kind={task.mascot} size={50} />
                          <button
                            className="icon-button task-edit"
                            aria-label={`编辑任务${task.title}`}
                            onClick={() => setTaskEditor(task)}
                          >
                            <ArrowUpRight size={19} />
                          </button>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="empty-state">
                    <Mascot kind="cloud" size={78} />
                    <h3>
                      {search
                        ? '没有找到这件事'
                        : completed
                          ? '完成的事，会在这里相遇'
                          : '留一点空间，给下一件重要的事'}
                    </h3>
                    <p>
                      {search
                        ? '换个词试试，或看看其他分类。'
                        : completed
                          ? '完成待办后，可以随时回来查看。'
                          : '从一个小小的待办开始吧。'}
                    </p>
                    {!completed && !search && (
                      <button className="button" onClick={() => setTaskEditor('new')}>
                        <Plus size={18} />
                        添加第一件待办
                      </button>
                    )}
                  </div>
                )}
              </section>
              <div className="list-foot">
                <span>
                  <span className="tiny-flower">✧</span>不用填满每一分钟，留白也是计划的一部分。
                </span>
                {category !== 'all' && (
                  <button className="text-button" onClick={() => setCategory('all')}>
                    查看全部待办
                  </button>
                )}
              </div>
            </>
          )}
          {page === 'schedule' && (
            <>
              <div className="page-intro">
                <div>
                  <span className="eyebrow">YOUR TIME, AT YOUR PACE</span>
                  <h1>
                    让时间，有余量<span className="title-dot">.</span>
                  </h1>
                  <p>课程与待办，清清楚楚地放在一起。</p>
                </div>
                <button className="button primary" onClick={() => setTaskEditor('new')}>
                  <Plus size={20} />
                  添加待办
                </button>
              </div>
            </>
          )}
          <div hidden={page === 'courses'}>{schedule}</div>
          {page === 'courses' && (
            <>
              <div className="page-intro">
                <div>
                  <span className="eyebrow">A SEMESTER OF LITTLE DISCOVERIES</span>
                  <h1>
                    我的课程<span className="title-dot">.</span>
                  </h1>
                  <p>
                    {settings.semesterStart} 开始 · 共 {settings.semesterWeeks} 周
                    {currentWeek > 0 && currentWeek <= settings.semesterWeeks
                      ? ` · 当前第 ${currentWeek} 周`
                      : ' · 当前不在本学期内'}
                  </p>
                </div>
                <button className="button primary" onClick={() => setPanel('import')}>
                  <ImagePlus size={19} />
                  图片导入课表
                </button>
              </div>
              <div className="course-toolbar">
                <button className="button" onClick={() => setCourseEditor('new')}>
                  <Plus size={18} />
                  手动添加课程
                </button>
                <button className="button quiet" onClick={() => setPanel('semester')}>
                  <Settings2 size={18} />
                  学期与节次设置
                </button>
              </div>
              <div className="course-list">
                {data.courses.length ? (
                  data.courses.map((course) => (
                    <button
                      className="course-card"
                      key={course.id}
                      onClick={() => setCourseEditor(course)}
                    >
                      <div className="course-icon">
                        <BookOpen size={24} />
                      </div>
                      <div>
                        <span className="category-tag blue">
                          课程 ·{' '}
                          {course.parity === 'all'
                            ? '每周'
                            : course.parity === 'odd'
                              ? '单周'
                              : '双周'}
                        </span>
                        <h3>{course.title}</h3>
                        <p>{courseSummary(course)}</p>
                        {course.location && <small>{course.location}</small>}
                      </div>
                      <ArrowUpRight size={19} />
                    </button>
                  ))
                ) : (
                  <div className="empty-state">
                    <BookOpen size={40} />
                    <h3>把课表带进来</h3>
                    <p>识别截图、校对时间，再按实际教学周安排。</p>
                    <button className="button" onClick={() => setPanel('import')}>
                      <ImagePlus size={18} />
                      导入我的课表
                    </button>
                  </div>
                )}
              </div>
              <div className="info-note">
                <BookOpen size={21} />
                <p>
                  课程按教学周有限重复，不会进入个人待办清单。点击课程编辑整个规则；本版本暂不开放课程拖动，以免无提示改动整学期。
                </p>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              奇遇 DDL <i>·</i> 给生活留一点余量
            </span>
            <div className="footer-actions">
              <button className="text-button" onClick={() => setPanel('data')}>
                备份与日历导出
              </button>
              <button className="text-button" onClick={() => setPanel('about')}>
                关于与提醒说明
                <ArrowUpRight size={13} />
              </button>
            </div>
          </footer>
        </main>
      </div>
      <div className={`floating-island ${view.status === 'conflict' ? 'attention' : ''}`}>
        <Mascot kind={nextTask?.mascot || 'star'} size={34} />
        <span className="island-dot" />
        <span className="island-task">{nextTask ? nextTask.title : '今天，也慢慢来'}</span>
        <span className="island-time">
          {nextTask ? countdown(nextTask.dueAt, now) : '给自己一点余量'}
        </span>
        <button aria-label="查看保存状态" title={statusLabel} onClick={() => setPanel('sync')}>
          {view.status === 'error' || view.status === 'conflict' ? (
            <AlertCircle size={17} />
          ) : view.status === 'offline' ? (
            <CloudOff size={17} />
          ) : (
            <Cloud size={17} />
          )}
        </button>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {taskEditor && (
        <TaskEditor
          task={taskEditor === 'new' ? undefined : taskEditor}
          categories={data.categories}
          onSave={saveTask}
          onDelete={(task) => run(() => store.change('tasks', task.id, null), '待办已删除')}
          onClose={() => setTaskEditor(null)}
        />
      )}
      {courseEditor && (
        <CourseEditor
          course={courseEditor === 'new' ? undefined : courseEditor}
          settings={settings}
          onSave={(id, values) => store.change('courses', id, values)}
          onDelete={(course) =>
            run(() => store.change('courses', course.id, null), '课程规则已删除')
          }
          onClose={() => setCourseEditor(null)}
        />
      )}
      {panel === 'categories' && (
        <CategoryManager state={data} store={store} onClose={() => setPanel(null)} />
      )}
      {panel === 'semester' && (
        <SemesterSettings
          settings={settings}
          onSave={(values) => {
            store.change('settings', 'main', values);
            setToast('学期设置已保存，课程已重新计算。');
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'data' && <DataPanel state={data} store={store} onClose={() => setPanel(null)} />}
      {panel === 'import' && (
        <CourseImport
          settings={settings}
          existing={data.courses}
          onImport={(courses) => {
            store.commit(
              courses.map((course) => ({ collection: 'courses', id: uid(), data: course })),
            );
            setToast(`已导入 ${courses.length} 门课程，按教学周显示。`);
          }}
          onClose={() => setPanel(null)}
          onSettings={() => setPanel('semester')}
        />
      )}
      {authOpen && (
        <Auth
          onClose={() => setAuthOpen(false)}
          onLogin={(next) => {
            setUser(next);
            setAuthOpen(false);
            setPanel(null);
            setCategory('all');
            setToast('已进入你的个人空间。示例数据不会自动混入账号。');
          }}
        />
      )}
      {panel === 'sync' && (
        <Modal
          title={statusLabel}
          description={
            user
              ? '你的修改按账号保存在服务器，并在其他设备打开时自动更新。'
              : '当前是体验模式，数据仅保存在本浏览器，不会跨设备同步。'
          }
          onClose={() => setPanel(null)}
        >
          <div className="sync-details">
            <Cloud size={36} />
            <h3>
              {view.status === 'saved'
                ? '每一件事，都好好保存了'
                : view.status === 'demo'
                  ? '试一试，再开启自己的空间'
                  : '先把你的修改保管好'}
            </h3>
            <p>
              {view.error ||
                `${view.pending} 项本机修改等待同步。账号在线时，每约 6 秒检查其他设备的更新。`}
            </p>
          </div>
          {view.status === 'conflict' ? (
            <>
              <p className="info-note">
                同一项在两台设备上被修改，没有自动覆盖。你可以先下载当前本机备份，再选择采用云端，或用本机未同步的修改覆盖冲突项。
              </p>
              <div className="sync-conflict-actions">
                <button className="button" onClick={() => backupExport(data)}>
                  <Download size={17} />
                  先备份本机
                </button>
                <button
                  className="button"
                  onClick={() => {
                    if (confirm('采用云端版本，并放弃这台设备所有尚未同步的修改？建议先备份。'))
                      run(() => store.resolveConflict(false));
                  }}
                >
                  采用云端版本
                </button>
                <button
                  className="button primary"
                  onClick={() => {
                    if (confirm('用本机待同步的修改覆盖云端冲突项？其他未修改的云端数据会保留。'))
                      run(() => store.resolveConflict(true));
                  }}
                >
                  保留本机修改
                </button>
              </div>
            </>
          ) : (
            <div className="modal-actions">
              {user ? (
                <button className="button primary" onClick={() => void store.sync(true)}>
                  <RefreshCw size={17} />
                  立即同步 / 重试
                </button>
              ) : (
                <button
                  className="button primary"
                  onClick={() => {
                    setPanel(null);
                    setAuthOpen(true);
                  }}
                >
                  登录 / 创建账号
                </button>
              )}
            </div>
          )}
        </Modal>
      )}
      {panel === 'account' && user && (
        <Modal
          title={`你好，${user.name}`}
          description={`${user.email} · 密码已加密保存。当前尚未开通邮箱验证与密码找回。`}
          onClose={() => setPanel(null)}
        >
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setAccountBusy(true);
              setAccountError('');
              try {
                await api('/api/auth/password', { oldPassword, newPassword });
                setOldPassword('');
                setNewPassword('');
                setToast('密码已修改，其他设备需重新登录。');
                setPanel(null);
              } catch (err) {
                setAccountError((err as Error).message);
              } finally {
                setAccountBusy(false);
              }
            }}
          >
            <h3>
              <KeyRound size={18} />
              修改密码
            </h3>
            <Field label="原密码">
              <input
                required
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
              />
            </Field>
            <Field label="新密码">
              <input
                required
                minLength={10}
                maxLength={128}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            {accountError && (
              <p role="alert" className="error-text">
                {accountError}
              </p>
            )}
            <button disabled={accountBusy} className="button" type="submit">
              保存新密码
            </button>
          </form>
          <hr />
          <div className="modal-actions">
            <button className="button quiet" onClick={() => backupExport(data)}>
              <Download size={17} />
              备份我的数据
            </button>
            <button
              className="button danger"
              onClick={async () => {
                if (view.pending) {
                  setToast('还有未同步的修改，请先同步或下载备份，再退出账号。');
                  return;
                }
                try {
                  await api('/api/auth/logout', {});
                  localStorage.removeItem(store.cacheKey);
                  setUser(null);
                  setPanel(null);
                  setCategory('all');
                } catch (err) {
                  setToast((err as Error).message);
                }
              }}
            >
              <LogOut size={17} />
              退出登录
            </button>
          </div>
        </Modal>
      )}
      {panel === 'about' && (
        <Modal
          title="奇遇 DDL"
          description="把重要的事安排好，也给生活留一点余量。"
          onClose={() => setPanel(null)}
        >
          <div className="about-content">
            <Mascot size={90} />
            <p>
              个人待办以 DDL 为结束时间，按计划用时向前安排。课程按学期、教学周和单双周单独计算。
            </p>
            <p>当前支持独立邮箱密码账号及服务器同步；手机号验证码、邮箱验证和找回密码尚未开通。</p>
            <p>
              网页内提供倒计时和逾期提示。关闭网页后不会推送系统通知；可以从“备份与日历导出”下载日历文件，提醒效果由你的日历应用决定。
            </p>
            <p>图片在浏览器中识别，不上传原图。识别结果需要你校对并确认后，才会加入课表。</p>
            <p className="muted">
              时间以设备本地时区显示，保存为统一时间。请将手机和电脑设为一致的日常使用时区。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
