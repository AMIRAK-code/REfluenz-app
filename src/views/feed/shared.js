// Small pieces shared by the home feed, discover and the library (docs/ARCHITECTURE.md section 3).

// The categories a creator can choose; the api validates against the same list.
export { CATEGORIES } from '../../api/util.js';

export const PAGE_SIZE = 12;
export const KIND_LABELS = { text: 'Text', image: 'Images', video: 'Video' };

// A value from the URL, only when it is one of the allowed ones.
export const pick = (value, allowed) => (typeof value === 'string' && allowed.includes(value) ? value : '');

// The creators the viewer follows or belongs to (the feed's "following" scope).
export const circleIds = store => [...new Set([...store.state.following, ...store.state.memberships.keys()])];

export const firstName = name => String(name ?? '').trim().split(/\s+/)[0] || '';

export function clip(text, length) {
  const value = String(text ?? '').trim();
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
}

// Keeps the address in step with what the page shows, without a new history entry and without running the router
// again (a navigation would redraw the page and take the focus away from the field being typed in).
export function replaceUrl(url) {
  try {
    globalThis.history?.replaceState(globalThis.history.state, '', url);
  } catch { /* the address is a convenience: sandboxed frames refuse it */ }
}

// Hands `content` to the browser as a file download.
export function downloadFile(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000).unref?.();
}
