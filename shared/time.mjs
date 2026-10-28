export const DAY_HEIGHT = 1116;
export const REST_HEIGHT = 72;
export const NORMAL_HOUR_HEIGHT = 58;
export function minuteToY(minute) {
  const bounded = Math.max(0, Math.min(1440, minute));
  return bounded <= 360 ? bounded / 5 : REST_HEIGHT + ((bounded - 360) * NORMAL_HOUR_HEIGHT) / 60;
}
export function yToMinute(y) {
  const bounded = Math.max(0, Math.min(DAY_HEIGHT, y));
  return bounded <= REST_HEIGHT
    ? bounded * 5
    : 360 + ((bounded - REST_HEIGHT) * 60) / NORMAL_HOUR_HEIGHT;
}
export function taskInterval(task) {
  const end = new Date(task.dueAt);
  return { start: new Date(end.getTime() - task.durationMinutes * 60000), end };
}
export function teachingWeek(date, semesterStart) {
  const start = new Date(`${semesterStart}T12:00:00`);
  const target = new Date(date);
  target.setHours(12, 0, 0, 0);
  // Calendar-day arithmetic avoids daylight-saving transitions changing the teaching week.
  const days = Math.round(
    (Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) -
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
      86400000,
  );
  return days < 0 ? 0 : Math.floor(days / 7) + 1;
}
export function courseOccursOn(course, date, settings) {
  const week = teachingWeek(date, settings.semesterStart);
  const weekday = date.getDay() || 7;
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return (
    weekday === course.weekday &&
    week >= course.startWeek &&
    week <= course.endWeek &&
    week <= settings.semesterWeeks &&
    (course.parity === 'all' || (course.parity === 'odd' ? week % 2 === 1 : week % 2 === 0)) &&
    !(course.exceptions || []).includes(dateKey)
  );
}
export function moveDeadline(task, anchorDate, targetDate) {
  return new Date(
    new Date(task.dueAt).getTime() + targetDate.getTime() - anchorDate.getTime(),
  ).toISOString();
}
