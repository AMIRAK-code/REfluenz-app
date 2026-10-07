// Calendar helpers shared by the conversation and the notification pages. Pure functions over local time.

const toDate = value => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const startOfDay = (value = Date.now()) => {
  const date = new Date(toDate(value) ?? Date.now());
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

// One key per calendar day (local time): two messages with the same key sit under the same day separator.
export function dayKey(value) {
  const date = toDate(value);
  return date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : '';
}

// "09:41", in the reader's own time zone.
export function clock(value) {
  const date = toDate(value);
  return date ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
}

// "Today", "Yesterday", "Monday 5 October", and with the year once it is not this one.
export function dayLabel(value, now = Date.now()) {
  const date = toDate(value);
  if (!date) return '';
  const today = startOfDay(now);
  const day = startOfDay(date);
  if (day === today) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return 'Yesterday';
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

// 'today' | 'week' (the six days before today) | 'earlier'. A time in the future counts as today.
export function bucketOf(value, now = Date.now()) {
  const date = toDate(value);
  if (!date) return 'earlier';
  const today = startOfDay(now);
  if (date.getTime() >= today) return 'today';
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);
  return date.getTime() >= weekStart.getTime() ? 'week' : 'earlier';
}
