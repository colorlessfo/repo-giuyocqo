import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Course, Settings } from './types';
import { Field, Modal } from './ui';
import { uid, weekdayNames } from './lib';
export default function CourseEditor({
  course,
  settings,
  onSave,
  onDelete,
  onClose,
}: {
  course?: Course;
  settings: Settings;
  onSave: (id: string, data: Record<string, unknown>) => void;
  onDelete: (c: Course) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(course?.title || '');
  const [weekday, setWeekday] = useState(course?.weekday || 1);
  const [startTime, setStart] = useState(course?.startTime || '08:00');
  const [endTime, setEnd] = useState(course?.endTime || '09:40');
  const [startWeek, setSW] = useState(course?.startWeek || 1);
  const [endWeek, setEW] = useState(course?.endWeek || settings.semesterWeeks);
  const [parity, setParity] = useState<Course['parity']>(course?.parity || 'all');
  const [location, setLocation] = useState(course?.location || '');
  const [error, setError] = useState('');
  return (
    <Modal
      title={course ? '编辑课程规则' : '添加一门课程'}
      description="这里修改整个重复规则。课程不会进入个人待办，也没有完成状态。"
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (startTime >= endTime || startWeek > endWeek)
              throw new Error('结束时间和结束周次应晚于开始。');
            onSave(course?.id || uid(), {
              title,
              weekday,
              startTime,
              endTime,
              startWeek,
              endWeek,
              parity,
              location,
              exceptions: course?.exceptions || [],
            });
            onClose();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <Field label="课程名称">
          <input
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="星期">
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {weekdayNames.map((day, i) => (
                <option key={day} value={i + 1}>
                  {day}
                </option>
              ))}
            </select>
          </Field>
          <Field label="重复">
            <select value={parity} onChange={(e) => setParity(e.target.value as Course['parity'])}>
              <option value="all">每周</option>
              <option value="odd">单周</option>
              <option value="even">双周</option>
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="上课时间">
            <input
              type="time"
              required
              value={startTime}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="下课时间">
            <input type="time" required value={endTime} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="开始周">
            <input
              required
              type="number"
              min={1}
              max={60}
              value={startWeek}
              onChange={(e) => setSW(Number(e.target.value))}
            />
          </Field>
          <Field label="结束周">
            <input
              required
              type="number"
              min={startWeek}
              max={60}
              value={endWeek}
              onChange={(e) => setEW(Number(e.target.value))}
            />
          </Field>
        </div>
        <Field label="教室（选填）">
          <input value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {course && (
            <button
              type="button"
              className="button quiet danger"
              onClick={() => {
                if (confirm('删除这门课程的整个重复规则？这会移除所有教学周内的该课程。')) {
                  onDelete(course);
                  onClose();
                }
              }}
            >
              <Trash2 size={18} />
              删除整门课程
            </button>
          )}
          <button type="submit" className="button primary">
            保存课程
          </button>
        </div>
      </form>
    </Modal>
  );
}
