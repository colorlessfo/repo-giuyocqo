import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCenter,
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { useState, type ReactNode } from 'react';
export const NAVIGATION = [
  { id: 'tasks', label: '我的待办' },
  { id: 'schedule', label: '七日日程' },
  { id: 'notes', label: '记事本' },
  { id: 'focus', label: '专注分析' },
];

export function inSavedOrder<T extends { id: string }>(items: T[], order: string[] = []) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return [
    ...order.filter((id) => byId.has(id)).map((id) => byId.get(id)!),
    ...items.filter((item) => !order.includes(item.id)),
  ];
}
function SortRow({
  id,
  label,
  children,
  disabled,
  move,
}: {
  id: string;
  label: string;
  children: ReactNode;
  disabled: boolean;
  move: (id: string, delta: number) => void;
}) {
  const drag = useDraggable({ id, disabled });
  const drop = useDroppable({ id, disabled });
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      className={`sidebar-sort-row ${drag.isDragging ? 'sorting' : ''}`}
      data-sort-id={id}
      style={{
        transform: drag.transform
          ? `translate3d(${drag.transform.x}px,${drag.transform.y}px,0)`
          : undefined,
      }}
    >
      {children}
      <button
        ref={drag.setActivatorNodeRef}
        className="sidebar-sort-handle"
        type="button"
        aria-label={`拖动${label}排序`}
        title="拖动排序，也可用上下方向键调整"
        disabled={disabled}
        {...drag.attributes}
        {...drag.listeners}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            move(id, e.key === 'ArrowUp' ? -1 : 1);
          }
        }}
      >
        <GripVertical size={14} />
      </button>
    </div>
  );
}
export default function SidebarSort({
  items,
  onOrder,
  disabled = false,
  render,
}: {
  items: { id: string; label: string }[];
  onOrder: (ids: string[]) => void;
  disabled?: boolean;
  render: (item: { id: string; label: string }) => ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [notice, setNotice] = useState('');
  function moveTo(id: string, to: number) {
    const from = items.findIndex((item) => item.id === id);
    if (disabled || from < 0 || to < 0 || to >= items.length || from === to) return;
    const next = items.map((item) => item.id);
    next.splice(from, 1);
    next.splice(to, 0, id);
    onOrder(next);
    setNotice(`${items[from].label}已移到第${to + 1}位`);
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (over)
          moveTo(
            String(active.id),
            items.findIndex((item) => item.id === over.id),
          );
      }}
      accessibility={{
        screenReaderInstructions: { draggable: '按住手柄拖动，或使用上下方向键调整顺序。' },
      }}
    >
      {items.map((item) => (
        <SortRow
          key={item.id}
          id={item.id}
          label={item.label}
          disabled={disabled}
          move={(id, delta) => moveTo(id, items.findIndex((item) => item.id === id) + delta)}
        >
          {render(item)}
        </SortRow>
      ))}
      <span className="sr-only" role="status">
        {notice}
      </span>
    </DndContext>
  );
}
