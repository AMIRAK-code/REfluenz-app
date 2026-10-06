// Route paths and URL helpers. Pure functions, shared by the router, the store, the shell and every view.

export const isAppPath = path => path === '/app' || String(path).startsWith('/app/');

// Auth pages: a `next` that points at one of these would bounce a signed-in person around.
export const GUEST_PATHS = ['/app/login', '/app/signup', '/app/forgot'];

const encode = encodeURIComponent;

// withQuery('/app/discover', {q: 'a b', category: ''}) → '/app/discover?q=a+b'. Empty values are left out.
export function withQuery(path, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '' && value !== false) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

export const paths = {
  home: '/app',
  discover: params => withQuery('/app/discover', params),
  creator: (slug, params) => withQuery(`/app/c/${encode(slug)}`, params),
  entry: id => `/app/p/${encode(id)}`,
  library: '/app/library',
  memberships: '/app/memberships',
  messages: (creatorId, memberId) => (creatorId && memberId ? `/app/messages/${encode(creatorId)}/${encode(memberId)}` : '/app/messages'),
  notifications: '/app/notifications',
  studio: params => withQuery('/app/studio', params),
  studioNew: params => withQuery('/app/studio/new', params),
  studioEdit: id => `/app/studio/edit/${encode(id)}`,
  studioSettings: params => withQuery('/app/studio/settings', params),
  settings: params => withQuery('/app/settings', params),
  login: next => withQuery('/app/login', { next }),
  signup: next => withQuery('/app/signup', { next }),
  forgot: '/app/forgot',
  reset: '/app/reset',
  welcome: params => withQuery('/app/welcome', params)
};

// '?a=1&b=2' → {a: '1', b: '2'}. The last value of a repeated key wins. Own data properties only, so `__proto__` is just a key.
export function parseQuery(search) {
  return Object.fromEntries(new URLSearchParams(String(search || '')));
}

// A post-login destination is accepted only when it stays inside the app: `/app` or `/app/...`, no other
// origin, no protocol-relative URL, no backslash tricks, no `..` that climbs out. Returns the clean path or null.
export function safeNext(value) {
  if (typeof value !== 'string' || !value || value.length > 2000) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value) || !value.startsWith('/')) return null;
  const base = 'http://refluenz.invalid';
  let url;
  try { url = new URL(value, base); } catch { return null; }
  if (url.origin !== base || !isAppPath(url.pathname)) return null;
  return url.pathname + url.search + url.hash;
}

const LEGACY_SECTIONS = {
  atelier: '/app', discover: '/app/discover', archive: '/app/library', circle: '/app/messages',
  memberships: '/app/memberships', studio: '/app/studio', settings: '/app/settings'
};

// The first version of the app lived at /app.html with hash routes. Returns the new path, or null when the URL is not legacy.
export function legacyTarget(pathname, hash = '') {
  if (pathname !== '/app.html') return null;
  const [section, id] = String(hash).replace(/^#/, '').split('/');
  if (section === 'entry' && /^[A-Za-z0-9_-]{1,64}$/.test(id || '')) return paths.entry(id);
  return LEGACY_SECTIONS[section] || '/app';
}
