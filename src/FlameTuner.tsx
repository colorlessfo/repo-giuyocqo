import { DEFAULT_FLAME } from '../shared/flame.mjs';
import type { FlameConfig } from './types';

export default function FlameTuner({
  value,
  locked,
  onChange,
  onCommit,
}: {
  value: FlameConfig;
  locked: boolean;
  onChange: (value: FlameConfig) => void;
  onCommit: () => void;
}) {
  const sliders = [
    { key: 'speed', label: '燃烧速度', min: 0.2, max: 1.6, step: 0.01 },
    { key: 'tongueSize', label: '火舌幅度', min: 0.6, max: 1.6, step: 0.01 },
    { key: 'coreRatio', label: '黄色核心比例', min: 0.35, max: 0.65, step: 0.01 },
    { key: 'pixelSize', label: '像素大小', min: 3, max: 7, step: 1 },
  ] as const;
  return (
    <div className={`flame-tuner ${locked ? 'is-locked' : ''}`}>
      <p className="flame-lock-hint" role="status">
        {locked ? '火焰参数已锁定 · 点击“已锁定”解锁后调整' : '可连续调整火焰 · 再次锁定后停止修改'}
      </p>
      <fieldset disabled={locked} aria-label="火焰参数">
        {sliders.map(({ key, label, min, max, step }) => (
          <label className="flame-control" key={key}>
            <span>
              {label}
              <output>
                {key === 'coreRatio'
                  ? `${Math.round(value[key] * 100)}%`
                  : key === 'pixelSize'
                    ? `${value[key]} px`
                    : value[key].toFixed(2)}
              </output>
            </span>
            <input
              type="range"
              aria-label={label}
              min={min}
              max={max}
              step={step}
              value={value[key]}
              onChange={(event) => {
                if (!locked) onChange({ ...value, [key]: Number(event.target.value) });
              }}
              onPointerUp={onCommit}
              onKeyUp={onCommit}
              onBlur={onCommit}
            />
          </label>
        ))}
        <label className="flame-play">
          <input
            type="checkbox"
            checked={value.animated}
            aria-label="播放火焰动画"
            onChange={(event) => {
              if (!locked) onChange({ ...value, animated: event.target.checked });
            }}
          />
          <span>火焰动画</span>
        </label>
        <button
          className="button small"
          type="button"
          onClick={() => {
            if (!locked) onChange({ ...DEFAULT_FLAME });
          }}
        >
          恢复默认火焰
        </button>
      </fieldset>
    </div>
  );
}
