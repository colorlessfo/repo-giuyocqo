import { useState } from 'react';
import { Plus, Trash2, Download, Upload, ShieldCheck, CalendarHeart } from 'lucide-react';
import type { Category, Color, Settings, State } from './types';
import { Field, Modal } from './ui';
import { calendarExport, dateKey, download, stripEntity, uid } from './lib';
import type { SyncStore } from './store';
import { validateSnapshot } from '../shared/validation.mjs';
export function CategoryManager({
  state,
  store,
  onClose,
}: {
  state: State;
  store: SyncStore;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<Color>('violet');
  const [editing, setEditing] = useState<Category | null>(null);
  const [error, setError] = useState('');
  function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (!name.trim()) throw new Error('请输入分类名称。');
      if (state.categories.some((c) => c.id !== editing?.id && c.name === name.trim()))
        throw new Error('已经有这个分类了。');
      store.change('categories', editing?.id || uid(), { name: name.trim(), color });
      setName('');
      setEditing(null);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title="分类，按你的方式"
      description="删除分类只会把任务移到“未分类”，不会删除任务。"
      onClose={onClose}
    >
      <div className="category-manager">
        {state.categories.map((category) => (
          <div className="category-manager-row" key={category.id}>
            <i className={`category-dot ${category.color}`} />
            <strong>{category.name}</strong>
            <span className="muted">
              {state.tasks.filter((t) => t.categoryId === category.id).length} 件
            </span>
            <button
              className="text-button"
              onClick={() => {
                setEditing(category);
                setName(category.name);
                setColor(category.color);
              }}
            >
              改名 / 配色
            </button>
            <button
              className="icon-button danger"
              aria-label={`删除分类${category.name}`}
              onClick={() => {
                if (confirm(`删除“${category.name}”分类？任务会保留并移到未分类。`))
                  try {
                    store.change('categories', category.id, null);
                  } catch (e) {
                    setError((e as Error).message);
                  }
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>
      <form onSubmit={save} className="form-stack category-form">
        <h3>{editing ? '修改分类' : '添加新分类'}</h3>
        <Field label="名称">
          <input
            required
            maxLength={40}
            placeholder="例如：毕业设计"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="color-picker">
          {(['violet', 'blue', 'peach', 'rose', 'slate'] as Color[]).map((c, i) => (
            <button
              type="button"
              aria-label={['柔紫', '浅蓝', '杏桃', '玫瑰', '灰蓝'][i]}
              aria-pressed={color === c}
              key={c}
              className={`color-option ${c} ${color === c ? 'selected' : ''}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {editing && (
            <button
              className="button quiet"
              type="button"
              onClick={() => {
                setEditing(null);
                setName('');
              }}
            >
              取消修改
            </button>
          )}
          <button type="submit" className="button primary">
            <Plus size={17} />
            {editing ? '保存分类' : '添加分类'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function SemesterSettings({
  settings,
  onSave,
  onClose,
}: {
  settings: Settings;
  onSave: (settings: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState(settings.semesterStart);
  const [weeks, setWeeks] = useState(settings.semesterWeeks);
  const [periods, setPeriods] = useState(structuredClone(settings.periods));
  const [error, setError] = useState('');
  return (
    <Modal
      title="学期与上课时间"
      description="第一周从你指定的周一开始，连续七天为一周。修改后，已有课程会按新学期重新计算。"
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (new Date(`${start}T12:00:00`).getDay() !== 1)
              throw new Error('请选择第一周的周一，避免周次歧义。');
            if (periods.some((p) => !p.label || p.start >= p.end))
              throw new Error('请检查每一节课的名称与起止时间。');
            onSave({ semesterStart: start, semesterWeeks: weeks, periods });
            onClose();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="第一周的周一">
            <input required type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="教学周总数">
            <input
              required
              type="number"
              min={1}
              max={60}
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
            />
          </Field>
        </div>
        <div>
          <h3>节次与实际时间</h3>
          <p className="muted small-text">
            供图片识别时转换节次使用。已经导入的课程保存实际时间，不会因修改节次表而悄悄改时。
          </p>
        </div>
        <div className="periods-list">
          {periods.map((period, index) => (
            <div className="period-row" key={index}>
              <input
                aria-label={`第${index + 1}节名称`}
                maxLength={20}
                required
                value={period.label}
                onChange={(e) =>
                  setPeriods((rows) =>
                    rows.map((v, i) => (i === index ? { ...v, label: e.target.value } : v)),
                  )
                }
              />
              <input
                aria-label={`第${index + 1}节开始时间`}
                required
                type="time"
                value={period.start}
                onChange={(e) =>
                  setPeriods((rows) =>
                    rows.map((v, i) => (i === index ? { ...v, start: e.target.value } : v)),
                  )
                }
              />
              <span>—</span>
              <input
                aria-label={`第${index + 1}节结束时间`}
                required
                type="time"
                value={period.end}
                onChange={(e) =>
                  setPeriods((rows) =>
                    rows.map((v, i) => (i === index ? { ...v, end: e.target.value } : v)),
                  )
                }
              />
              <button
                className="icon-button danger"
                type="button"
                disabled={periods.length <= 1}
                aria-label={`删除第${index + 1}节`}
                onClick={() => setPeriods((rows) => rows.filter((_, i) => i !== index))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="button quiet"
          disabled={periods.length >= 24}
          onClick={() =>
            setPeriods((rows) => [
              ...rows,
              { label: `第${rows.length + 1}节`, start: '20:00', end: '20:45' },
            ])
          }
        >
          <Plus size={17} />
          增加一节
        </button>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="submit" className="button primary">
            保存学期设置
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function backupExport(state: State) {
  download(
    `奇遇DDL-备份-${dateKey(new Date())}.json`,
    JSON.stringify(
      {
        application: 'qiyu-ddl',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        data: state,
      },
      null,
      2,
    ),
  );
}
export function DataPanel({
  state,
  store,
  onClose,
}: {
  state: State;
  store: SyncStore;
  onClose: () => void;
}) {
  const [parsed, setParsed] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [filename, setFilename] = useState('');
  async function read(file?: File) {
    if (!file) return;
    try {
      if (file.size > 3 * 1024 * 1024) throw new Error('备份文件请小于 3 MB。');
      const value = JSON.parse(await file.text());
      if (value.application !== 'qiyu-ddl' || value.formatVersion !== 1)
        throw new Error(
          '这个文件不是当前版本的奇遇 DDL 备份。旧版数据需要先确认格式，不会冒险覆盖。',
        );
      const data = value.data as State;
      if (
        !data ||
        !['tasks', 'courses', 'categories', 'settings'].every((key) =>
          Array.isArray(data[key as keyof State]),
        )
      )
        throw new Error('备份结构不完整。');
      if (
        data.tasks.length + data.courses.length + data.categories.length + data.settings.length >
        1000
      )
        throw new Error('单次最多恢复 1000 条数据，请分批处理。');
      if (data.settings.length !== 1 || data.settings[0].id !== 'main')
        throw new Error('学期设置不完整。');
      const seen = new Set<string>();
      for (const key of ['tasks', 'courses', 'categories', 'settings'] as const)
        for (const item of data[key]) {
          if (
            !item ||
            typeof item !== 'object' ||
            typeof item.id !== 'string' ||
            !item.id.match(/^[a-zA-Z0-9_-]{1,100}$/)
          )
            throw new Error('备份中存在无效记录。');
          const id = `${key}/${item.id}`;
          if (seen.has(id)) throw new Error('备份中存在重复记录。');
          seen.add(id);
        }
      setParsed(data);
      setFilename(file.name);
      setError('');
    } catch (e) {
      setParsed(null);
      setError((e as Error).message);
    }
  }
  function restore() {
    if (!parsed) return;
    try {
      const validated = validateSnapshot(parsed) as State;
      const changes = [];
      for (const collection of ['categories', 'tasks', 'courses', 'settings'] as const)
        for (const item of validated[collection]) {
          const current = (state[collection] as any[]).find((v) => v.id === item.id);
          if (current && JSON.stringify(stripEntity(current)) === JSON.stringify(stripEntity(item)))
            continue;
          changes.push({ collection, id: item.id, data: stripEntity(item) });
        }
      if (!changes.length) {
        setError('这些内容已经存在，无需重复导入。');
        return;
      }
      store.commit(changes);
      onClose();
    } catch {
      setError('备份中包含无效的字段、时间或周次，尚未导入任何数据。');
    }
  }
  return (
    <Modal
      title="你的安排，由你保管"
      description="导出数据备份，或把安排带进系统日历。备份文件包含个人任务和课程，请妥善保管。"
      onClose={onClose}
    >
      <div className="data-options">
        <button onClick={() => backupExport(state)}>
          <Download size={24} />
          <span>
            <strong>下载完整备份</strong>
            <small>任务、分类、课程、学期与节次设置</small>
          </span>
          <span>JSON</span>
        </button>
        <button
          onClick={() =>
            download(
              `奇遇DDL-${dateKey(new Date())}.ics`,
              calendarExport(state),
              'text/calendar;charset=utf-8',
            )
          }
        >
          <CalendarHeart size={24} />
          <span>
            <strong>导出到系统日历</strong>
            <small>导出未完成任务和有限教学周内的课程</small>
          </span>
          <span>ICS</span>
        </button>
      </div>
      <div className="info-note">
        <ShieldCheck size={21} />
        <p>
          关闭网页后，本版本不会发送系统推送。日历文件包含任务截止前 30
          分钟的提醒设置，是否生效取决于日历应用；导出是快照，不会自动同步后续修改。
        </p>
      </div>
      <hr />
      <h3>
        <Upload size={19} />
        从备份恢复
      </h3>
      <p className="muted small-text">
        只支持本版本备份；原网站的数据不能跨网址直接读取。若你仍能打开旧站，请先从旧站导出并保留文件。
      </p>
      <input
        aria-label="选择备份文件"
        type="file"
        accept="application/json,.json"
        onChange={(e) => void read(e.target.files?.[0])}
      />
      {parsed && (
        <div className="restore-preview">
          <strong>{filename}</strong>
          <p>
            {parsed.tasks.length} 件任务 · {parsed.categories.length} 个分类 ·{' '}
            {parsed.courses.length} 门课程
          </p>
          <p>
            确认后，同 ID 的条目将采用备份内容，其他现有条目保留。重复导入不会新增同 ID
            数据；恢复前建议先下载当前备份。
          </p>
          <button className="button primary" onClick={restore}>
            确认合并恢复
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </Modal>
  );
}
