// Formatting helpers. Pure functions that return plain strings (never markup).

const toDate = value => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// 12 Oct, or 12 Oct 2025 when the date is not in the current year. `year` forces either form.
export function formatDate(value, { year } = {}) {
  const date = toDate(value);
  if (!date) return '';
  const showYear = year ?? date.getFullYear() !== new Date().getFullYear();
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(showYear ? { year: 'numeric' } : {}) });
}

// "just now", "5 min ago", "3 h ago", "2 d ago", then the date. A time in the future reads as "just now".
export function timeAgo(value, now = Date.now()) {
  const date = toDate(value);
  if (!date) return '';
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(date);
}

const currencyFormats = new Map();
function currencyFormat(currency, whole) {
  const key = `${currency}:${whole}`;
  if (!currencyFormats.has(key)) {
    const digits = whole ? 0 : 2;
    currencyFormats.set(key, new Intl.NumberFormat('en-IE', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return currencyFormats.get(key);
}

// money(900) → "€9", money(950) → "€9.50", money(1200, 'USD') → "US$12". Unknown currency codes fall back to euros.
export function money(cents, currency = 'EUR') {
  const amount = Number(cents) / 100;
  if (!Number.isFinite(amount)) return '';
  const whole = Number.isInteger(amount);
  try {
    return currencyFormat(String(currency || 'EUR').toUpperCase(), whole).format(amount);
  } catch {
    return currencyFormat('EUR', whole).format(amount);
  }
}

// plural(1, 'image') → "1 image", plural(3, 'image') → "3 images", plural(2, 'entry', 'entries') → "2 entries".
export function plural(count, one, many = `${one}s`) {
  const n = Number(count) || 0;
  return `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const compactNumber = value => (Number.isFinite(Number(value)) ? compact.format(Number(value)) : '0');

// "Mila Rossi" → "MR", "mila" → "M", "" → "". Counts code points, so a name that starts with an emoji still works.
export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
  return `${first}${last}`.toUpperCase();
}

// 92 → "1:32", 3725 → "1:02:05", unknown or zero → "" (a film whose length is unknown shows no 0:00).
export function duration(seconds) {
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total <= 0) return '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function fileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

// --- Entries ---------------------------------------------------------------

export const kindOf = entry => (entry?.kind === 'image' || entry?.kind === 'video' ? entry.kind : 'text');
export const mediaCount = entry => Math.max(0, Math.trunc(Number(entry?.mediaCount)) || 0);

// The size of an entry in words people use: "3 images", "1:32" (or "Video" when the length is unknown), "5 min read".
export function entrySize(entry, { long = true } = {}) {
  const kind = kindOf(entry);
  if (kind === 'image') return plural(mediaCount(entry), 'image');
  if (kind === 'video') return duration(entry?.duration) || 'Video';
  const minutes = Math.trunc(Number(entry?.minutes));
  return minutes > 0 ? `${minutes} min${long ? ' read' : ''}` : '';
}
