const chineseDays = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
export function extractCourseText(text, periods) {
  const normalized = text
    .replace(/[：]/g, ':')
    .replace(/[～—–至]/g, '-')
    .replace(/\s*([:~-])\s*/g, '$1');
  const dayMatch = normalized.match(/(?:星期|周)([一二三四五六日天1-7])/);
  const weekday = dayMatch ? chineseDays[dayMatch[1]] || Number(dayMatch[1]) : null;
  const time = normalized.match(/([0-2]?\d:[0-5]\d)-([0-2]?\d:[0-5]\d)/);
  const period = normalized.match(/(?:第\s*)?(\d{1,2})(?:[-,、](\d{1,2}))?\s*节/);
  const week = normalized.match(/(?:第\s*)?(\d{1,2})(?:-(\d{1,2}))?\s*周/);
  const startPeriod = period ? Number(period[1]) - 1 : -1,
    endPeriod = period ? Number(period[2] || period[1]) - 1 : -1;
  const lines = normalized
    .split(/\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const name =
    lines.find(
      (line) =>
        line.length > 1 &&
        !/(?:\d\s*周|\d\s*节|\d:\d|星期|^周[一二三四五六日天])/.test(line) &&
        !/(?:教室|地点)[:：]/.test(line),
    ) || '';
  const locationMatch = normalized.match(/(?:教室|地点)[:：]?\s*([^\n]+)/);
  return {
    title: name.slice(0, 200),
    weekday,
    startTime: time
      ? time[1].padStart(5, '0')
      : startPeriod >= 0
        ? periods[startPeriod]?.start || ''
        : '',
    endTime: time ? time[2].padStart(5, '0') : endPeriod >= 0 ? periods[endPeriod]?.end || '' : '',
    startWeek: week ? Number(week[1]) : null,
    endWeek: week ? Number(week[2] || week[1]) : null,
    parity: /单周/.test(normalized) ? 'odd' : /双周/.test(normalized) ? 'even' : 'all',
    location: locationMatch?.[1]?.slice(0, 200) || '',
    exceptions: [],
    source: text,
  };
}
export function extractTimetable(text, tsv, periods) {
  const words = (tsv || '')
    .split('\n')
    .slice(1)
    .map((row) => {
      const fields = row.split('\t');
      return {
        level: Number(fields[0]),
        x: Number(fields[6]),
        y: Number(fields[7]),
        width: Number(fields[8]),
        height: Number(fields[9]),
        confidence: Number(fields[10]),
        text: fields.slice(11).join('\t').trim(),
      };
    })
    .filter((w) => w.level === 5 && w.text && w.confidence >= 15);
  const rows = [];
  for (const word of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.find(
      (r) =>
        Math.abs(r.y + r.height / 2 - (word.y + word.height / 2)) < Math.max(8, word.height * 0.65),
    );
    if (!row) {
      row = { y: word.y, height: word.height, words: [] };
      rows.push(row);
    }
    row.words.push(word);
  }
  const headers = [];
  for (const row of rows) {
    const sorted = row.words.sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length; i++) {
      let combined = '';
      for (let j = i; j < Math.min(i + 4, sorted.length); j++) {
        if (j > i && sorted[j].x - (sorted[j - 1].x + sorted[j - 1].width) > sorted[j].height * 2)
          break;
        combined += sorted[j].text;
        const match = combined.replace(/\s/g, '').match(/^(?:周|星期)([一二三四五六日天])$/);
        if (match) {
          headers.push({
            weekday: chineseDays[match[1]],
            x: (sorted[i].x + sorted[j].x + sorted[j].width) / 2,
            y: row.y,
            height: row.height,
          });
          break;
        }
      }
    }
  }
  const unique = [...new Map(headers.map((h) => [h.weekday, h])).values()].sort(
    (a, b) => a.weekday - b.weekday,
  );
  if (unique.length >= 3) {
    const first = unique[0],
      last = unique.at(-1);
    const width = (last.x - first.x) / (last.weekday - first.weekday);
    if (width > 20) {
      const monday = first.x - (first.weekday - 1) * width;
      const headerBottom = Math.max(...unique.map((v) => v.y + v.height));
      const output = [];
      for (let weekday = 1; weekday <= 7; weekday++) {
        const center = monday + (weekday - 1) * width;
        const columnRows = rows
          .filter((r) => r.y > headerBottom)
          .map((r) => ({
            ...r,
            words: r.words.filter(
              (w) =>
                w.x + w.width / 2 > center - width / 2 && w.x + w.width / 2 < center + width / 2,
            ),
          }))
          .filter((r) => r.words.length)
          .sort((a, b) => a.y - b.y);
        let group = [];
        const finish = () => {
          if (!group.length) return;
          const value = group
            .map((r) =>
              r.words
                .sort((a, b) => a.x - b.x)
                .map((w) => w.text)
                .join(''),
            )
            .join('\n');
          const parsed = extractCourseText(value, periods);
          if (parsed.title) {
            parsed.weekday = weekday;
            output.push(parsed);
          }
          group = [];
        };
        for (const row of columnRows) {
          const previous = group.at(-1);
          const rowText = row.words.map((w) => w.text).join('');
          const groupText = group.flatMap((r) => r.words.map((w) => w.text)).join('');
          const nextTitle =
            /[\u4e00-\u9fffA-Za-z]{2}/.test(rowText) &&
            !/(?:\d.*周|\d.*节|\d:\d|教室|地点|单周|双周)/.test(rowText);
          if (
            previous &&
            (row.y - (previous.y + previous.height) > Math.max(24, previous.height * 1.8) ||
              (/\d.*周/.test(groupText) && nextTitle))
          )
            finish();
          group.push(row);
        }
        finish();
      }
      if (output.length) return output;
    }
  }
  // If table layout could not be inferred, retain text for explicit manual correction.
  return text
    .split(/\n\s*\n/)
    .map((block) => extractCourseText(block, periods))
    .filter(
      (c) => c.title && ((c.startTime && c.endTime) || c.startWeek !== null || c.weekday !== null),
    );
}
