import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { addDays, format, startOfDay } from 'date-fns';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  UnlockKeyhole,
  Undo2,
  ImagePlus,
  Plus,
  GripVertical,
  Moon,
  Maximize2,
  Minimize2,
  LocateFixed,
  Flame,
  Settings2,
} from 'lucide-react';
import {
  DAY_HEIGHT,
  minuteToY,
  yToMinute,
  taskInterval,
  courseOccursOn,
  moveDeadline,
} from '../shared/time.mjs';
import type { Course, Settings, Task, FlameConfig } from './types';
import { dateKey, weekdayNames } from './lib';
import FlameCanvas from './FlameCanvas';
import FlameTuner from './FlameTuner';
import { DEFAULT_FLAME } from '../shared/flame.mjs';

type Segment = {
  key: string;
  type: 'task' | 'course';
  task?: Task;
  course?: Course;
  start: Date;
  end: Date;
  startMinute: number;
  endMinute: number;
  day: number;
  lane?: number;
  lanes?: number;
};
function Blocks({
  segment,
  locked,
  onClick,
  flame,
}: {
  segment: Segment;
  locked: boolean;
  onClick: () => void;
  flame: FlameConfig;
}) {
  const draggable = useDraggable({
    id: segment.key,
    disabled: locked || segment.type === 'course',
    data: segment,
  });
  const top = minuteToY(segment.startMinute),
    height = Math.max(28, minuteToY(segment.endMinute) - top - 3);
  const transform = draggable.transform;
  const item = segment.task || segment.course!;
  return (
    <button
      ref={draggable.setNodeRef}
      {...draggable.listeners}
      {...draggable.attributes}
      aria-disabled={false}
      type="button"
      aria-label={`${segment.type === 'task' ? '待办' : '课程'} ${item.title} ${format(segment.start, 'HH:mm')}至${format(segment.end, 'HH:mm')}${segment.type === 'task' ? (locked ? '，日程已锁定' : '，可拖动') : '，编辑整个课程规则'}`}
      data-testid={`block-${segment.task?.id || segment.course?.id}`}
      className={`schedule-block ${segment.type} ${segment.task ? 'procedural-fire' : ''} ${draggable.isDragging ? 'dragging' : ''} ${height < 110 ? 'short' : ''} ${height < 55 ? 'compact' : ''}`}
      style={
        {
          top,
          height,
          '--core-inset-y': `${Math.max(15, Math.round((1 - flame.coreRatio) * 44))}%`,
          '--core-inset-x': `${Math.max(16, Math.round((1 - flame.coreRatio) * 44) - 2)}%`,
          left: `calc(${((segment.lane || 0) / (segment.lanes || 1)) * 100}% + var(--block-inset, 4px))`,
          width: `calc(${100 / (segment.lanes || 1)}% - var(--block-gap, 8px))`,
          transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
          touchAction: !locked && segment.type === 'task' ? 'none' : 'pan-x pan-y',
        } as CSSProperties
      }
      onClick={onClick}
      title={`${item.title}\n${format(segment.start, 'MM月dd日 HH:mm')} – ${format(segment.end, 'MM月dd日 HH:mm')}${segment.task ? `\nDDL：${format(new Date(segment.task.dueAt), 'MM月dd日 HH:mm')}` : ''}`}
    >
      {segment.task && <FlameCanvas config={flame} taskId={segment.task.id} />}
      <div className="block-content">
        <div className="block-label">
          <span>{segment.type === 'task' ? '待办' : '课程'}</span>
          {segment.type === 'task' && !locked && <GripVertical size={14} />}
        </div>
        <strong>{item.title}</strong>
        {height >= 85 && (
          <small>
            {format(segment.start, 'HH:mm')}–
            {segment.endMinute === 1440 ? '24:00' : format(segment.end, 'HH:mm')}
            {segment.course?.location && ` · ${segment.course.location}`}
          </small>
        )}
        {segment.task && height >= 100 && (
          <div className="block-progress">
            <i
              style={{
                width: `${Math.max(0, Math.min(100, ((Date.now() - taskInterval(segment.task).start.getTime()) / (segment.task.durationMinutes * 60000)) * 100))}%`,
              }}
            />
          </div>
        )}
      </div>
    </button>
  );
}
function arrange(segments: Segment[]): Segment[] {
  const sorted = segments.sort(
    (a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute,
  );
  const group: Segment[] = [];
  let end = -1;
  function finish() {
    if (!group.length) return;
    const lanes: number[] = [];
    for (const segment of group) {
      let lane = lanes.findIndex((v) => v <= segment.startMinute);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = segment.endMinute;
      segment.lane = lane;
    }
    for (const segment of group) segment.lanes = lanes.length;
    group.length = 0;
  }
  for (const segment of sorted) {
    if (segment.startMinute >= end) {
      finish();
      end = -1;
    }
    group.push(segment);
    end = Math.max(end, segment.endMinute);
  }
  finish();
  return sorted;
}
export default function Schedule({
  tasks,
  courses,
  settings,
  onEditTask,
  onEditCourse,
  onMove,
  onImport,
  onNewCourse,
  onNewTask,
  onCourseSettings,
  onFlameChange,
  ready,
  compact = false,
}: {
  tasks: Task[];
  courses: Course[];
  settings: Settings;
  onEditTask: (t: Task) => void;
  onEditCourse: (c: Course) => void;
  onMove: (t: Task, dueAt: string) => void;
  onImport: () => void;
  onNewCourse: () => void;
  onNewTask: () => void;
  onCourseSettings: () => void;
  onFlameChange: (config: FlameConfig, expectedVersion: number) => void;
  ready: boolean;
  compact?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [layout, setLayout] = useState<'week' | 'day'>('week');
  const [selectedDay, setSelectedDay] = useState(0);
  const [locked, setLocked] = useState(true);
  const [tunerOpen, setTunerOpen] = useState(false);
  const [flameDraft, setFlameDraft] = useState<FlameConfig | null>(null);
  const pendingFlame = useRef<{
    value: FlameConfig;
    version: number;
    save: typeof onFlameChange;
  } | null>(null);
  const flame = flameDraft || settings.flame || DEFAULT_FLAME;
  function changeFlame(value: FlameConfig) {
    if (locked || !ready) return;
    const pending = pendingFlame.current;
    pendingFlame.current = {
      value,
      version: pending?.version ?? settings.version,
      save: pending?.save ?? onFlameChange,
    };
    setFlameDraft(value);
  }
  function flushFlame() {
    const pending = pendingFlame.current;
    if (!pending) return true;
    try {
      pending.save(pending.value, pending.version);
      pendingFlame.current = null;
      setFlameDraft(null);
      return true;
    } catch (error) {
      setNotice((error as Error).message);
      return false;
    }
  }
  useEffect(() => {
    if (!flameDraft) return;
    const timer = setTimeout(flushFlame, 650);
    return () => clearTimeout(timer);
  }, [flameDraft]);
  useEffect(
    () => () => {
      const pending = pendingFlame.current;
      if (pending) {
        try {
          pending.save(pending.value, pending.version);
        } catch {
          console.warn('Flame preference save unavailable');
        }
      }
    },
    [],
  );
  const [showTasks, setShowTasks] = useState(true);
  const [showCourses, setShowCourses] = useState(true);
  const [now, setNow] = useState(new Date());
  const [undo, setUndo] = useState<
    { id: string; before: string; after: string; duration: number }[]
  >([]);
  const [notice, setNotice] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const columns = useRef<HTMLDivElement>(null);
  const justDragged = useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = minuteToY(420);
  }, []);
  useEffect(() => {
    if (!expanded || !section.current) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Keep the same calendar mounted: lock, undo, scroll and edits survive expansion.
    // Remove the covered page from keyboard navigation; the floating notebook stays usable.
    const covered: { element: HTMLElement; inert: boolean }[] = [];
    let child: HTMLElement = section.current;
    while (child.parentElement) {
      for (const sibling of child.parentElement.children) {
        if (
          sibling !== child &&
          sibling instanceof HTMLElement &&
          !sibling.hasAttribute('data-floating-tools') &&
          !sibling.hasAttribute('data-radix-portal')
        ) {
          covered.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      child = child.parentElement;
      if (child === document.body) break;
    }
    expandButton.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        section.current?.contains(event.target as Node) &&
        !document.querySelector('.modal-content')
      )
        setExpanded(false);
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      for (const { element, inert } of covered) element.inert = inert;
      document.removeEventListener('keydown', escape);
      expandButton.current?.focus({ preventScroll: true });
    };
  }, [expanded]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfDay(now), offset + i));
  const segments = days.map((day, dayIndex) => {
    const next = addDays(day, 1);
    const list: Segment[] = [];
    if (showTasks)
      for (const task of tasks.filter((t) => !t.completed)) {
        const interval = taskInterval(task);
        if (interval.end <= day || interval.start >= next) continue;
        const start = new Date(Math.max(interval.start.getTime(), day.getTime())),
          end = new Date(Math.min(interval.end.getTime(), next.getTime()));
        list.push({
          key: `${task.id}:${dateKey(day)}`,
          type: 'task',
          task,
          start,
          end,
          startMinute: start.getHours() * 60 + start.getMinutes(),
          endMinute:
            end.getTime() === next.getTime() ? 1440 : end.getHours() * 60 + end.getMinutes(),
          day: dayIndex,
        });
      }
    if (showCourses)
      for (const course of courses)
        if (courseOccursOn(course, day, settings)) {
          const start = new Date(`${dateKey(day)}T${course.startTime}:00`),
            end = new Date(`${dateKey(day)}T${course.endTime}:00`);
          list.push({
            key: `${course.id}:${dateKey(day)}`,
            type: 'course',
            course,
            start,
            end,
            startMinute: start.getHours() * 60 + start.getMinutes(),
            endMinute: end.getHours() * 60 + end.getMinutes(),
            day: dayIndex,
          });
        }
    return arrange(list);
  });
  function dragStart(_event: DragStartEvent) {
    setNotice('');
  }
  function dragEnd(event: DragEndEvent) {
    justDragged.current = Date.now();
    const segment = event.active.data.current as Segment;
    if (locked || !segment?.task || !columns.current || (!event.delta.x && !event.delta.y)) return;
    const width = columns.current.clientWidth / (layout === 'day' ? 1 : 7);
    const horizontalDays = Math.round(event.delta.x / width);
    const rawY = minuteToY(segment.startMinute) + event.delta.y;
    const extraDays = Math.floor(rawY / DAY_HEIGHT);
    const y = rawY - extraDays * DAY_HEIGHT;
    const minute = Math.round(yToMinute(y) / 15) * 15;
    const target = addDays(days[segment.day], horizontalDays + extraDays);
    target.setMinutes(minute, 0, 0);
    const dueAt = moveDeadline(segment.task, segment.start, target);
    if (dueAt === segment.task.dueAt) return;
    try {
      onMove(segment.task, dueAt);
      setUndo((items) =>
        [
          ...items,
          {
            id: segment.task!.id,
            before: segment.task!.dueAt,
            after: dueAt,
            duration: segment.task!.durationMinutes,
          },
        ].slice(-30),
      );
      setNotice('已调整 DDL，可继续拖动或撤销。');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function undoMove() {
    const last = undo.at(-1);
    if (!last) return;
    const task = tasks.find((t) => t.id === last.id);
    if (!task || task.dueAt !== last.after || task.durationMinutes !== last.duration) {
      setNotice('任务在移动后又被修改，请在编辑中确认时间；未覆盖后续修改。');
      setUndo((items) => items.slice(0, -1));
      return;
    }
    try {
      onMove(task, last.before);
      setUndo((items) => items.slice(0, -1));
      setNotice('已撤销上次移动，仍可继续调整。');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  const hours = [0, 6, ...Array.from({ length: 17 }, (_, i) => i + 7)];
  return (
    <section
      ref={section}
      role="region"
      aria-label={expanded ? '全屏日程表' : '七日日程表'}
      className={`schedule-section ${compact ? 'schedule-preview' : 'schedule-page'} ${expanded ? 'schedule-expanded' : ''} schedule-${layout}`}
      style={{ '--visible-days': layout === 'day' ? 1 : 7 } as CSSProperties}
      id="schedule"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR SEVEN-DAY ADVENTURE</span>
          <h2>
            <CalendarDays size={25} />
            未来七天
          </h2>
        </div>
        <div className="schedule-actions">
          <button
            ref={expandButton}
            className="button small expand-schedule"
            aria-pressed={expanded}
            aria-label={expanded ? '退出全屏日程' : '放大日程表'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            <span>{expanded ? '退出全屏' : '全屏日程'}</span>
          </button>
          <button
            className="button small schedule-new-task"
            onClick={onNewTask}
            aria-label="添加待办"
          >
            <Plus size={18} />
            <span>添加待办</span>
          </button>
          <button className="button small" onClick={onImport} aria-label="图片导入课表">
            <ImagePlus size={18} />
            <span>图片导入课表</span>
          </button>
          <button className="icon-button" onClick={onNewCourse} aria-label="添加课程">
            <Plus size={20} />
          </button>
        </div>
      </div>
      <div className="schedule-viewbar">
        <div className="schedule-view-switch" role="group" aria-label="日程视图">
          <button aria-pressed={layout === 'week'} onClick={() => setLayout('week')}>
            七天总览
          </button>
          <button aria-pressed={layout === 'day'} onClick={() => setLayout('day')}>
            单日详情
          </button>
        </div>
        <div className="schedule-viewbar-actions">
          <button
            className="icon-button"
            aria-label="课程与学期设置"
            title="管理课程、周次与节次"
            onClick={onCourseSettings}
          >
            <Settings2 size={18} />
          </button>
          <button
            className="text-button now-button"
            onClick={() => {
              setOffset(0);
              setSelectedDay(0);
              if (scroll.current) {
                scroll.current.scrollTop = Math.max(
                  0,
                  minuteToY(now.getHours() * 60 + now.getMinutes()) - 120,
                );
                scroll.current.scrollLeft = 0;
              }
            }}
          >
            <LocateFixed size={16} />
            回到此刻
          </button>
        </div>
      </div>
      <div className="schedule-toolbar">
        <div className="date-navigation">
          <button
            className="icon-button"
            aria-label="前七天"
            onClick={() => setOffset((v) => v - 7)}
          >
            <ChevronLeft size={20} />
          </button>
          <strong>
            {format(days[0], 'M月d日')} — {format(days[6], 'M月d日')}
          </strong>
          <button
            className="icon-button"
            aria-label="后七天"
            onClick={() => setOffset((v) => v + 7)}
          >
            <ChevronRight size={20} />
          </button>
          <button className="text-button" onClick={() => setOffset(0)}>
            今天
          </button>
        </div>
        <div className="schedule-controls">
          <label className="legend task">
            <input
              type="checkbox"
              checked={showTasks}
              onChange={(e) => setShowTasks(e.target.checked)}
            />
            待办
          </label>
          <label className="legend course">
            <input
              type="checkbox"
              checked={showCourses}
              onChange={(e) => setShowCourses(e.target.checked)}
            />
            课程
          </label>
          <button
            className="icon-button"
            aria-label="撤销移动"
            title="撤销上次移动"
            disabled={!undo.length}
            onClick={undoMove}
          >
            <Undo2 size={19} />
          </button>
          <button
            className="icon-button calendar-effects"
            aria-label="火焰调节"
            title="展开或收起火焰参数"
            aria-expanded={tunerOpen}
            aria-controls="flame-tuner"
            onClick={() => setTunerOpen((value) => !value)}
          >
            <Flame size={18} />
          </button>
          <button
            aria-pressed={!locked}
            className={`button small lock-button ${locked ? '' : 'unlocked'}`}
            onClick={() => {
              if (!locked && !flushFlame()) return;
              setLocked((v) => !v);
              setNotice('');
            }}
          >
            {locked ? <LockKeyhole size={16} /> : <UnlockKeyhole size={16} />}
            <span>{locked ? '已锁定' : '已解锁'}</span>
          </button>
        </div>
      </div>
      <div id="flame-tuner" hidden={!tunerOpen}>
        <FlameTuner
          value={flame}
          locked={locked || !ready}
          onChange={changeFlame}
          onCommit={flushFlame}
        />
      </div>
      {layout === 'day' && (
        <div className="day-selector" role="group" aria-label="选择查看日期">
          {days.map((day, index) => (
            <button
              key={dateKey(day)}
              aria-pressed={selectedDay === index}
              onClick={() => setSelectedDay(index)}
            >
              <span>{weekdayNames[(day.getDay() + 6) % 7]}</span>
              <strong>{format(day, 'dd')}</strong>
            </button>
          ))}
        </div>
      )}
      <p className="schedule-hint" aria-live="polite">
        {notice ||
          (locked
            ? '解锁后可连续拖动 · 课程点击编辑 · 全屏查看更清楚'
            : '可连续上下调整时间、左右跨天移动。DDL 随之更新，用时保持不变。')}
      </p>
      <DndContext
        sensors={sensors}
        autoScroll={false}
        onDragStart={dragStart}
        onDragEnd={dragEnd}
        accessibility={{
          screenReaderInstructions: {
            draggable: '按空格开始移动，方向键调整，空格确认，Escape取消。',
          },
        }}
      >
        <div
          className="schedule-scroll"
          ref={scroll}
          tabIndex={0}
          aria-label="七日日程，可横向及纵向滚动"
        >
          <div className="schedule-inner">
            <div className="schedule-days">
              <div className="timezone-label">
                本地
                <br />
                时间
              </div>
              {days
                .filter((_, index) => layout === 'week' || index === selectedDay)
                .map((day) => (
                  <div key={dateKey(day)} className={dateKey(day) === dateKey(now) ? 'today' : ''}>
                    <span>{weekdayNames[(day.getDay() + 6) % 7]}</span>
                    <strong>{format(day, 'dd')}</strong>
                  </div>
                ))}
            </div>
            <div className="schedule-body" style={{ height: DAY_HEIGHT }}>
              <div className="time-gutter">
                {hours.map((hour) => (
                  <span key={hour} style={{ top: minuteToY(hour * 60) }}>
                    {String(hour).padStart(2, '0')}:00
                  </span>
                ))}
                <span style={{ top: DAY_HEIGHT - 18 }}>24:00</span>
              </div>
              <div className="schedule-columns" ref={columns}>
                {days.map((day, index) => (
                  <div
                    className={`day-column ${dateKey(day) === dateKey(now) ? 'today' : ''}`}
                    key={dateKey(day)}
                    hidden={layout === 'day' && index !== selectedDay}
                  >
                    <div className="rest-zone" style={{ height: minuteToY(360) }}>
                      <Moon size={12} />
                      <span>00–06 休息</span>
                    </div>
                    {hours
                      .filter((h) => h >= 6)
                      .map((hour) => (
                        <div
                          className="hour-line"
                          key={hour}
                          style={{ top: minuteToY(hour * 60) }}
                        />
                      ))}
                    {segments[index].map((segment) => (
                      <Blocks
                        key={segment.key}
                        segment={segment}
                        locked={locked}
                        flame={flame}
                        onClick={() => {
                          if (Date.now() - justDragged.current < 250) return;
                          segment.task ? onEditTask(segment.task) : onEditCourse(segment.course!);
                        }}
                      />
                    ))}
                    {dateKey(day) === dateKey(now) && (
                      <div
                        className="now-line"
                        style={{ top: minuteToY(now.getHours() * 60 + now.getMinutes()) }}
                      >
                        <span>{format(now, 'HH:mm')}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </DndContext>
      <div className="schedule-footnote">
        <span>
          <Moon size={13} />
          凌晨六小时保留，缩小显示
        </span>
        <span>结束时间 = DDL · 拖动按 15 分钟对齐</span>
      </div>
    </section>
  );
}
