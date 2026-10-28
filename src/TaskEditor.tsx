import { useState } from 'react';
import { Trash2, Check } from 'lucide-react';
import { addHours } from 'date-fns';
import { Field, Mascot, Modal } from './ui';
import type { Category, MascotKind, Task } from './types';
import { localInput, stripEntity, uid } from './lib';

export default function TaskEditor({
  task,
  categories,
  onSave,
  onDelete,
  onClose,
}: {
  task?: Task;
  categories: Category[];
  onSave: (id: string, data: Record<string, unknown>) => void;
  onDelete: (task: Task) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task?.title || '');
  const [due, setDue] = useState(localInput(task?.dueAt || addHours(new Date(), 3)));
  const [duration, setDuration] = useState(String((task?.durationMinutes || 90) / 60));
  const [unit, setUnit] = useState(60);
  const [category, setCategory] = useState(task?.categoryId || '');
  const [mascot, setMascot] = useState<MascotKind>(task?.mascot || 'star');
  const [notes, setNotes] = useState(task?.notes || '');
  const [error, setError] = useState('');
  function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const durationMinutes = Math.round(Number(duration) * unit);
      if (!title.trim()) throw new Error('给这件事起一个名字吧。');
      if (!due || Number.isNaN(new Date(due).getTime()))
        throw new Error('请选择完整的截止日期和时间。');
      if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 525600)
        throw new Error('计划用时可设置为 1 分钟至 365 天。');
      onSave(task?.id || uid(), {
        ...(task ? stripEntity(task) : { completed: false, completedAt: null }),
        title: title.trim(),
        dueAt: new Date(due).toISOString(),
        durationMinutes,
        categoryId: category || null,
        mascot,
        notes,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title={task ? '编辑这件事' : '留给一件重要的事'}
      description="结束时间就是 DDL；日程会根据计划用时，向前安排时间。"
      onClose={onClose}
    >
      <form onSubmit={submit} className="form-stack">
        <Field label="任务名称">
          <input
            autoFocus
            required
            maxLength={200}
            placeholder="你想完成什么？"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="截止日期与时间">
          <input
            aria-label="截止日期与时间"
            required
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="计划用时" hint="支持长任务与跨天安排">
            <div className="input-pair">
              <input
                aria-label="计划用时数值"
                type="number"
                min="0.001"
                step="any"
                required
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
              <select
                aria-label="时长单位"
                value={unit}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setDuration(String(Number(((Number(duration) * unit) / next).toFixed(6))));
                  setUnit(next);
                }}
              >
                <option value={60}>小时</option>
                <option value={1}>分钟</option>
                <option value={1440}>天</option>
              </select>
            </div>
          </Field>
          <Field label="分类">
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">未分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="field">
          <span>选一位小伙伴</span>
          <div className="mascot-picker">
            {(['star', 'cloud', 'moon', 'bunny'] as MascotKind[]).map((kind, i) => (
              <button
                type="button"
                key={kind}
                aria-label={['星星', '云朵', '月亮', '兔子'][i]}
                aria-pressed={mascot === kind}
                className={mascot === kind ? 'selected' : ''}
                onClick={() => setMascot(kind)}
              >
                <Mascot kind={kind} size={58} />
                {mascot === kind && <Check className="mascot-check" size={14} />}
              </button>
            ))}
          </div>
        </div>
        <Field label="备注（选填）">
          <textarea
            rows={3}
            maxLength={10000}
            placeholder="写下第一步，或者一个小提醒。"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {task && (
            <button
              type="button"
              className="button danger quiet"
              onClick={() => {
                if (confirm('删除这件待办？此操作不会影响其他任务。')) {
                  onDelete(task);
                  onClose();
                }
              }}
            >
              <Trash2 size={18} />
              删除
            </button>
          )}
          <button type="button" className="button quiet" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit">
            {task ? '保存修改' : '添加待办'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
