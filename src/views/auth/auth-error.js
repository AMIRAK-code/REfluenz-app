// Errors that arrive in the URL of an auth e-mail link (/app.html#error=access_denied&error_code=otp_expired&error_description=...).
// supabase-js leaves them in the address and the router replaces that address with a clean path, so main.js reads them first
// (parseAuthError), keeps them for this tab (stashAuthError) and the sign-in page shows them once (takeAuthError).
// Pure functions: the storage is a parameter, nothing here touches the DOM at import time.

export const AUTH_ERROR_KEY = 'refluenz:auth-error';
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_MESSAGE = 200;

const EXPIRED = 'That email link has expired or has already been used. Request a new one and try again.';
const UNUSABLE = 'That email link could not be used. Request a new one and try again.';
const GENERIC = 'We could not complete that email link. Try again, or request a new one.';

const paramsOf = text => new URLSearchParams(String(text || '').replace(/^[#?]/, ''));
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);

// → {code, message} when the URL carries an auth error, else null. `message` is a sentence for the person, never raw server text
// unless nothing better is known; callers still escape it (html``).
export function parseAuthError(hash = '', search = '') {
  const fromHash = paramsOf(hash);
  const fromQuery = paramsOf(search);
  const pick = key => fromHash.get(key) || fromQuery.get(key) || '';
  const error = clean(pick('error'));
  const code = clean(pick('error_code'));
  const description = clean(pick('error_description'));
  if (!error && !code && !description) return null;
  let message = GENERIC;
  if (code === 'otp_expired' || /expired|already been used|invalid or has expired/i.test(description)) message = EXPIRED;
  else if (error === 'access_denied') message = UNUSABLE;
  else if (description) message = /[.!?]$/.test(description) ? description : `${description}.`;
  return { code: code || error || 'unknown', message };
}

const storageOf = storage => {
  try { return storage ?? globalThis.sessionStorage ?? null; } catch { return null; }
};

export function stashAuthError(authError, { storage, now = Date.now() } = {}) {
  const store = storageOf(storage);
  if (!store || !authError) return false;
  try {
    store.setItem(AUTH_ERROR_KEY, JSON.stringify({ code: String(authError.code || ''), message: clean(authError.message) || GENERIC, at: now }));
    return true;
  } catch {
    return false;
  }
}

// Reads and removes the stashed error. Anything older than ten minutes, or not shaped like what stashAuthError writes, is dropped.
export function takeAuthError({ storage, now = Date.now() } = {}) {
  const store = storageOf(storage);
  if (!store) return null;
  try {
    const text = store.getItem(AUTH_ERROR_KEY);
    if (text === null || text === undefined) return null;
    store.removeItem(AUTH_ERROR_KEY);
    const found = JSON.parse(text);
    if (!found || typeof found.message !== 'string' || !found.message) return null;
    if (!Number.isFinite(found.at) || now - found.at > MAX_AGE_MS || found.at > now + 60_000) return null;
    return { code: typeof found.code === 'string' ? found.code : '', message: clean(found.message) };
  } catch {
    return null;
  }
}
