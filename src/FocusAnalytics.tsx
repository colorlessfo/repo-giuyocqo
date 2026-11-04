import { useState } from 'react';
import { Flame, Clock3, CheckCheck, Target, Play, RefreshCw } from 'lucide-react';
import { focusedMs } from '../shared/focus.mjs';
import type { FocusView } from './focusTypes';
import { focusDuration } from './FocusExperience';

export default function FocusAnalytics({
  view,
  onStart,
  onOpen,
  onRetry,
}: {
  view: FocusView;
  onStart: () => void;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const [span, setSpan] = useState(7),
    [selected, setSelected] = useState('');
  const { stats, records, profile } = view.data;
  const days = stats.days.slice(-span),
    total = days.reduce((sum, day) => sum + day.focusedMs, 0),
    max = Math.max(60000, ...days.map((day) => day.focusedMs));
  const rate =
    stats.completedSessions + stats.cancelledSessions
      ? Math.round(
          (stats.completedSessions / (stats.completedSessions + stats.cancelledSessions)) * 100,
        )
      : null;
  const periodMax = Math.max(1, ...stats.periods.map((period) => period.focusedMs));
  const chosen = days.find((day) => day.date === selected);
  return (
    <section className="focus-analytics">
      <div className="page-intro">
        <div>
          <h1>
            专注分析<span className="title-dot">.</span>
          </h1>
        </div>
        <button
          className="button primary"
          disabled={!view.loaded || view.busy || view.pending}
          onClick={profile.active ? onOpen : onStart}
        >
          <Flame size={19} />
          {profile.active ? '回到专注' : '点亮火把'}
        </button>
      </div>
      {view.error && (
        <div className="connection-banner" role="status">
          <span>{view.error}</span>
          <button className="text-button" onClick={onRetry}>
            <RefreshCw size={15} />
            重试
          </button>
        </div>
      )}
      <div className="focus-metrics">
        {[
          {
            label: '今天的专注',
            value: focusDuration(stats.days.at(-1)?.focusedMs || 0),
            hint: profile.active ? '包含本次已专注时间' : '按你当前的本地日期',
            Icon: Flame,
          },
          {
            label: '累计专注',
            value: focusDuration(stats.totalMs),
            hint: '完成与提前结束的实际用时',
            Icon: Clock3,
          },
          {
            label: '完成的专注',
            value: `${stats.completedSessions} 段`,
            hint: '完整走完倒计时的记录',
            Icon: CheckCheck,
          },
          {
            label: '完成比例',
            value: rate === null ? '—' : `${rate}%`,
            hint: rate === null ? '完成第一段专注后显示' : '完成 ÷ 已结束的专注',
            Icon: Target,
          },
        ].map(({ label, value, hint, Icon }) => (
          <article key={label}>
            <Icon size={20} />
            <span>{label}</span>
            <strong>{view.loaded ? value : '读取中…'}</strong>
            <small>{hint}</small>
          </article>
        ))}
      </div>
      <div className="focus-charts">
        <section className="focus-chart-card">
          <div className="focus-chart-heading">
            <div>
              <h2>专注的足迹</h2>
              <p>
                近 {span} 天 · 共 {focusDuration(total)}
              </p>
            </div>
            <div className="focus-chart-range" role="group" aria-label="统计天数">
              {[7, 30].map((value) => (
                <button
                  key={value}
                  aria-pressed={span === value}
                  onClick={() => {
                    setSpan(value);
                    setSelected('');
                  }}
                >
                  {value} 天
                </button>
              ))}
            </div>
          </div>
          <div
            className={`focus-bars ${span === 30 ? 'month' : ''}`}
            role="group"
            aria-label="每日专注时长柱状图"
          >
            {days.map((day, index) => (
              <button
                key={day.date}
                aria-label={`${day.date} 专注${focusDuration(day.focusedMs)}，完成${day.completedSessions}段`}
                aria-pressed={selected === day.date}
                onMouseEnter={() => setSelected(day.date)}
                onFocus={() => setSelected(day.date)}
                onClick={() => setSelected(day.date)}
                className={selected === day.date ? 'selected' : ''}
              >
                <span className="focus-bar-track">
                  <i
                    style={{
                      height: day.focusedMs ? `${Math.max(2, (day.focusedMs / max) * 100)}%` : '0%',
                    }}
                  />
                </span>
                <small>
                  {span === 7 || index % 5 === 0 || index === days.length - 1
                    ? `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8))}`
                    : ''}
                </small>
              </button>
            ))}
          </div>
          <div className="focus-chart-caption" role="status">
            {chosen
              ? `${chosen.date} · ${focusDuration(chosen.focusedMs)} · 完成 ${chosen.completedSessions} 段`
              : total
                ? '点击柱状图查看每天的记录。'
                : '还没有专注记录。点亮火把，让第一束光留下来。'}
          </div>
          <details className="focus-data-details">
            <summary>查看每日数据明细</summary>
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>实际专注</th>
                  <th>完成段数</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{focusDuration(day.focusedMs)}</td>
                    <td>{day.completedSessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
        <section className="focus-chart-card focus-period-card">
          <div className="focus-chart-heading">
            <div>
              <h2>你的专注时段</h2>
              <p>近 31 天 · 按实际时间分配</p>
            </div>
          </div>
          <div className="focus-periods">
            {stats.periods.map((period, index) => (
              <div key={period.label}>
                <span>
                  {period.label}
                  <small>{focusDuration(period.focusedMs)}</small>
                </span>
                <div>
                  <i
                    className={`period-${index}`}
                    style={{ width: `${(period.focusedMs / periodMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="focus-help">
            跨午夜的专注会分到各自日期，暂停时间不计入。统计时区：{view.data.timezone}。
          </p>
        </section>
      </div>
      <section className="focus-chart-card focus-records">
        <div className="focus-chart-heading">
          <div>
            <h2>最近的专注</h2>
            <p>保留每一段实际发生的努力</p>
          </div>
          <span>{records.length ? `最近 ${records.length} 段` : '从第一段开始'}</span>
        </div>
        {!records.length ? (
          <div className="focus-record-empty">
            <Clock3 size={28} />
            <p>这里会记录你的专注内容、时间和完成情况。</p>
            <button
              className="button quiet"
              onClick={onStart}
              disabled={!view.loaded || view.busy || !!profile.active}
            >
              <Play size={16} />
              开始一段专注
            </button>
          </div>
        ) : (
          <ol>
            {records.map((record) => (
              <li key={record.id}>
                <span className={`focus-record-status ${record.status}`}>
                  {record.status === 'completed' ? '已完成' : '提前结束'}
                </span>
                <div>
                  <strong>{record.label}</strong>
                  <small>
                    {new Date(record.startedAt).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · 计划 {record.minutes} 分钟
                  </small>
                </div>
                <b>{focusDuration(focusedMs(record, record.endedAt!))}</b>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
