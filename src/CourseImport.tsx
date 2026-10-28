import { useRef, useState } from 'react';
import { ImagePlus, Plus, Trash2, Check, ScanLine, ArrowRight, AlertCircle } from 'lucide-react';
import type { Worker } from 'tesseract.js';
import { Modal } from './ui';
import type { Course, Settings } from './types';
import { weekdayNames, uid } from './lib';
import { extractTimetable } from '../shared/ocr.mjs';
interface Draft {
  key: string;
  title: string;
  weekday: number | null;
  startTime: string;
  endTime: string;
  startWeek: number | null;
  endWeek: number | null;
  parity: Course['parity'];
  location: string;
  source: string;
  reviewed: boolean;
}
export default function CourseImport({
  settings,
  existing,
  onImport,
  onClose,
  onSettings,
}: {
  settings: Settings;
  existing: Course[];
  onImport: (courses: Record<string, unknown>[]) => void;
  onClose: () => void;
  onSettings: () => void;
}) {
  const [image, setImage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<'upload' | 'review'>('upload');
  const [previewOriginal, setPreviewOriginal] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const canceled = useRef(false);
  async function selectFile(next?: File) {
    if (!next) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(next.type)) {
      setError('请选择 PNG、JPG 或 WebP 格式的课表截图。');
      return;
    }
    if (next.size > 12 * 1024 * 1024) {
      setError('图片请小于 12 MB，可以先裁去无关区域。');
      return;
    }
    setError('');
    setFile(next);
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(next);
  }
  async function recognize() {
    if (!file) return;
    setBusy(true);
    setError('');
    setProgress(0);
    let worker: Worker | undefined;
    try {
      const { createWorker, PSM } = await import('tesseract.js');
      worker = await createWorker(['chi_sim', 'eng'], 1, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/core',
        langPath: '/ocr',
        logger: (message) => {
          if (message.status === 'recognizing text')
            setProgress(Math.round(message.progress * 100));
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
      });
      // Bound memory on mobile; the actual file stays in this browser.
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const result = await worker.recognize(canvas, {}, { text: true, tsv: true });
      if (canceled.current) return;
      setRaw(result.data.text);
      const parsed = extractTimetable(result.data.text, result.data.tsv, settings.periods) as Omit<
        Draft,
        'key' | 'reviewed'
      >[];
      setDrafts(parsed.slice(0, 100).map((row) => ({ ...row, key: uid(), reviewed: false })));
      setStage('review');
      if (!parsed.length)
        setError(
          result.data.text.trim()
            ? '已提取文字，但无法可靠确定课程边界。请对照图片手动补充课程。'
            : '未识别到清晰文字。请使用原始截图，裁去无关区域后重试，或手动补充。',
        );
      else if (result.data.confidence < 55)
        setError('图片识别置信度较低，请逐项对照原图，特别检查时间和教学周。');
    } catch (e) {
      setError('图片识别未完成。请换用清晰截图重试，或直接手动补充；没有任何课程被导入。');
      console.warn('OCR failed:', e instanceof Error ? e.name : 'unknown');
    } finally {
      await worker?.terminate();
      setBusy(false);
    }
  }
  function update(key: string, values: Partial<Draft>) {
    setDrafts((rows) =>
      rows.map((row) =>
        row.key === key
          ? { ...row, ...values, ...('reviewed' in values ? {} : { reviewed: false }) }
          : row,
      ),
    );
  }
  function add() {
    setStage('review');
    setDrafts((rows) => [
      ...rows,
      {
        key: uid(),
        title: '',
        weekday: null,
        startTime: '',
        endTime: '',
        startWeek: null,
        endWeek: null,
        parity: 'all',
        location: '',
        source: '手动补充',
        reviewed: false,
      },
    ]);
  }
  function valid(row: Draft) {
    return (
      row.title.trim() &&
      row.weekday &&
      row.startTime &&
      row.endTime &&
      row.startTime < row.endTime &&
      row.startWeek &&
      row.endWeek &&
      row.startWeek >= 1 &&
      row.endWeek >= row.startWeek &&
      row.endWeek <= settings.semesterWeeks
    );
  }
  function importRows() {
    try {
      if (!drafts.length || drafts.some((row) => !valid(row) || !row.reviewed))
        throw new Error('请补齐必填信息，并逐门勾选“已校对”。周次不能超过当前学期。');
      const courses = drafts.map(({ key: _key, reviewed: _reviewed, source: _source, ...row }) => ({
        ...row,
        title: row.title.trim(),
        exceptions: [],
      }));
      const unique = courses.filter(
        (row) =>
          !existing.some(
            (c) =>
              c.title === row.title &&
              c.weekday === row.weekday &&
              c.startTime === row.startTime &&
              c.endTime === row.endTime &&
              c.startWeek === row.startWeek &&
              c.endWeek === row.endWeek &&
              c.parity === row.parity &&
              c.location === row.location,
          ),
      );
      const keys = new Set<string>();
      const deduped = unique.filter((row) => {
        const key = JSON.stringify(row);
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      });
      if (!deduped.length) throw new Error('这些课程已经存在，没有重复导入。');
      onImport(deduped);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function close() {
    if (busy) return;
    if (drafts.length && !confirm('离开课表校对？尚未确认的课程不会保存。')) return;
    canceled.current = true;
    onClose();
  }
  return (
    <Modal
      wide
      title="把课表带进来"
      description="上传或粘贴截图 → 自动识别 → 逐项校对 → 确认导入。图片仅在本机识别，不会上传。"
      onClose={close}
    >
      <div className="import-steps">
        <span className="active">01 选择图片</span>
        <ArrowRight size={15} />
        <span className={stage === 'review' ? 'active' : ''}>02 人工校对</span>
        <ArrowRight size={15} />
        <span>03 导入课表</span>
      </div>
      <div className="semester-note">
        <div>
          <strong>第一周的周一：{settings.semesterStart}</strong>
          <small>
            共 {settings.semesterWeeks} 周，第一周从此日期起连续 7 天；单／双周按教学周计算。
          </small>
        </div>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (drafts.length && !confirm('当前校对内容尚未导入，先离开去修改学期设置？')) return;
            onSettings();
          }}
        >
          修改学期与节次
        </button>
      </div>
      {stage === 'upload' && (
        <div
          className={`upload-area ${image ? 'has-image' : ''}`}
          tabIndex={0}
          onPaste={(event) => {
            const item = Array.from(event.clipboardData.files).find((f) =>
              f.type.startsWith('image/'),
            );
            if (item) {
              event.preventDefault();
              void selectFile(item);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void selectFile(event.dataTransfer.files[0]);
          }}
        >
          {image ? (
            <img src={image} alt="待识别的课表截图" />
          ) : (
            <>
              <div className="upload-icon">
                <ImagePlus size={30} />
              </div>
              <h3>一张课表，就够了</h3>
              <p>拖入截图，或点击这里后粘贴图片</p>
            </>
          )}
          <input
            type="file"
            ref={fileInput}
            hidden
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => void selectFile(e.target.files?.[0])}
          />
          <button className="button" disabled={busy} onClick={() => fileInput.current?.click()}>
            {image ? '重新选择图片' : '选择课表截图'}
          </button>
          <small>PNG / JPG / WebP · 最大 12 MB</small>
        </div>
      )}
      {busy && (
        <div className="ocr-progress" role="status">
          <ScanLine size={20} />
          <span>{progress ? `正在识别课表 ${progress}%` : '正在准备本机中文识别…'}</span>
          <progress value={progress || undefined} max={100} />
          <small>首次加载需要一点时间，请保持页面打开。</small>
        </div>
      )}
      {stage === 'review' && (
        <>
          <div className="review-heading">
            <div>
              <h3>每一门，确认一下</h3>
              <p className="muted">不确定的信息会留空；修改任何字段后，都需要重新勾选已校对。</p>
            </div>
            {image && (
              <button className="button small" onClick={() => setPreviewOriginal((v) => !v)}>
                {previewOriginal ? '收起原图' : '对照原图'}
              </button>
            )}
          </div>
          {previewOriginal && <img className="review-image" src={image} alt="课表原始截图" />}
          <div className="course-drafts">
            {drafts.map((row, index) => (
              <div className="course-draft" key={row.key}>
                <div className="draft-heading">
                  <strong>课程 {String(index + 1).padStart(2, '0')}</strong>
                  <label className="reviewed-label">
                    <input
                      type="checkbox"
                      checked={row.reviewed}
                      disabled={!valid(row)}
                      onChange={(e) => update(row.key, { reviewed: e.target.checked })}
                    />
                    已校对
                  </label>
                  <button
                    className="icon-button"
                    aria-label={`删除第${index + 1}门候选课程`}
                    onClick={() => setDrafts((rows) => rows.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                <div className="draft-grid">
                  <label className="field">
                    <span>课程名称 *</span>
                    <input
                      aria-label={`课程${index + 1}名称`}
                      value={row.title}
                      maxLength={200}
                      onChange={(e) => update(row.key, { title: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>星期 *</span>
                    <select
                      aria-label={`课程${index + 1}星期`}
                      value={row.weekday || ''}
                      onChange={(e) => update(row.key, { weekday: Number(e.target.value) || null })}
                    >
                      <option value="">待确认</option>
                      {weekdayNames.map((v, i) => (
                        <option key={v} value={i + 1}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>上课 *</span>
                    <input
                      type="time"
                      aria-label={`课程${index + 1}上课`}
                      value={row.startTime}
                      onChange={(e) => update(row.key, { startTime: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>下课 *</span>
                    <input
                      type="time"
                      aria-label={`课程${index + 1}下课`}
                      value={row.endTime}
                      onChange={(e) => update(row.key, { endTime: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>开始周 *</span>
                    <input
                      aria-label={`课程${index + 1}开始周`}
                      type="number"
                      min={1}
                      max={settings.semesterWeeks}
                      value={row.startWeek || ''}
                      onChange={(e) =>
                        update(row.key, { startWeek: Number(e.target.value) || null })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>结束周 *</span>
                    <input
                      aria-label={`课程${index + 1}结束周`}
                      type="number"
                      min={1}
                      max={settings.semesterWeeks}
                      value={row.endWeek || ''}
                      onChange={(e) => update(row.key, { endWeek: Number(e.target.value) || null })}
                    />
                  </label>
                  <label className="field">
                    <span>重复</span>
                    <select
                      value={row.parity}
                      onChange={(e) =>
                        update(row.key, { parity: e.target.value as Draft['parity'] })
                      }
                    >
                      <option value="all">每周</option>
                      <option value="odd">单周</option>
                      <option value="even">双周</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>教室</span>
                    <input
                      value={row.location}
                      maxLength={200}
                      onChange={(e) => update(row.key, { location: e.target.value })}
                    />
                  </label>
                </div>
                {row.source && (
                  <details>
                    <summary>查看识别片段</summary>
                    <pre>{row.source}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
          <button className="button quiet" onClick={add}>
            <Plus size={17} />
            手动补充一门
          </button>
          {raw && (
            <details className="recognized-text">
              <summary>查看／复制识别出的全部文字</summary>
              <textarea readOnly rows={7} value={raw} />
            </details>
          )}
        </>
      )}
      {error && (
        <p className="error-text import-error" role="alert">
          <AlertCircle size={18} />
          {error}
        </p>
      )}
      <div className="modal-actions">
        {stage === 'upload' ? (
          <>
            <button className="button quiet" disabled={busy} onClick={add}>
              手动填写课表
            </button>
            <button
              className="button primary"
              disabled={!file || busy}
              onClick={() => void recognize()}
            >
              <ScanLine size={18} />
              {busy ? '正在识别' : '识别这张课表'}
            </button>
          </>
        ) : (
          <>
            <button
              className="button quiet"
              onClick={() => {
                if (!drafts.length || confirm('重新识别会清空当前校对内容，继续？')) {
                  setStage('upload');
                  setDrafts([]);
                  setError('');
                }
              }}
            >
              重新识别
            </button>
            <button
              className="button primary"
              disabled={!drafts.length || drafts.some((row) => !row.reviewed || !valid(row))}
              onClick={importRows}
            >
              <Check size={18} />
              确认导入 {drafts.length} 门课程
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
