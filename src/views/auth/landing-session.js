// The landing page (index.html) shows "Open the app" instead of "Sign in" / "Join for free" when this browser already holds a
// session token. The landing page never loads supabase-js, so the stored token is only looked at, never used: the app itself
// checks it again. Pure functions, the storage and the document are parameters.

import { SESSION_STORAGE_KEY } from '../../core/constants.js';

export const OPEN_APP = { href: '/app', label: 'Open the app' };

const storageOf = storage => {
  try { return storage ?? globalThis.localStorage ?? null; } catch { return null; }
};

// True when the stored value looks like a supabase-js session: an object with an access or a refresh token.
export function hasSessionToken(storage) {
  const store = storageOf(storage);
  if (!store) return false;
  try {
    const text = store.getItem(SESSION_STORAGE_KEY);
    if (!text) return false;
    const session = JSON.parse(text);
    if (!session || typeof session !== 'object') return false;
    const refresh = typeof session.refresh_token === 'string' && session.refresh_token !== '';
    const access = typeof session.access_token === 'string' && session.access_token !== '';
    const expired = Number.isFinite(session.expires_at) && session.expires_at * 1000 < Date.now();
    return refresh || (access && !expired);
  } catch {
    return false;
  }
}

// Replaces the words of a link and keeps the icon next to them.
function relabel(link, label) {
  const words = [...link.childNodes].find(node => node.nodeType === 3 && node.nodeValue.trim());
  if (words) words.nodeValue = `${label} `;
  else link.insertBefore(link.ownerDocument.createTextNode(`${label} `), link.firstChild);
}

// Every [data-auth-cta] link becomes "Open the app" → /app for a signed-in visitor. Returns how many were changed.
export function applySignedInCtas(root = globalThis.document, storage) {
  if (!root || !hasSessionToken(storage)) return 0;
  let changed = 0;
  for (const link of root.querySelectorAll('[data-auth-cta]')) {
    link.setAttribute('href', OPEN_APP.href);
    relabel(link, OPEN_APP.label);
    changed++;
  }
  return changed;
}
