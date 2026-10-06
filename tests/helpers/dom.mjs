// Test harness for the application shell and the views: a happy-dom window installed as the globals the app code reads,
// and mountApp(), which boots the real shell, router and store against any api.
//
//   import { mountApp, stubApi } from './helpers/dom.mjs';           (tests/views/*.test.mjs: '../helpers/dom.mjs')
//   const app = await mountApp({ api: createFakeApi(), path: '/app/discover?q=linen' });
//   await app.click('[data-follow]');  app.html('#view');  await app.submit('form', { email: 'a@b.c' });  await app.destroy();
//
// Nothing happens at import time: call installDom() / mountApp() inside the tests (before) and uninstallDom() (after), so
// test files that share one process (--test-isolation=none) cannot disturb each other.

import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createFakeApi } from './fake-api.mjs';

const APP_HTML = new URL('../../app.html', import.meta.url);

const GLOBALS = [
  'window', 'document', 'history', 'location', 'localStorage', 'sessionStorage', 'customElements', 'navigator',
  'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'HTMLDialogElement', 'DocumentFragment',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FormData', 'DOMParser', 'MutationObserver', 'CSS',
  'IntersectionObserver', 'matchMedia'
];

// Counts as visible to the observer only when a test says so: fire(true) / fire(false).
export class IntersectionObserverStub {
  static instances = [];
  constructor(callback) { this.callback = callback; this.targets = new Set(); IntersectionObserverStub.instances.push(this); }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  fire(isIntersecting = true) { this.callback([...this.targets].map(target => ({ target, isIntersecting })), this); }
}

let installed = null;

export function installDom({ url = 'http://localhost/app' } = {}) {
  if (installed) return installed.window;
  const window = new Window({ url, width: 1024, height: 768 });
  const state = { window, saved: new Map(), confirmAnswer: true, confirms: [] };

  window.matchMedia = query => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.IntersectionObserver = IntersectionObserverStub;
  window.scrollTo = () => {};
  window.confirm = message => { state.confirms.push(message); return state.confirmAnswer; };
  IntersectionObserverStub.instances = [];

  const values = { ...Object.fromEntries(GLOBALS.map(name => [name, window[name]])), window, matchMedia: window.matchMedia, IntersectionObserver: IntersectionObserverStub };
  for (const name of GLOBALS) {
    state.saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    if (values[name] === undefined) continue;
    Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true });
  }
  // Node can make blob: URLs only for its own Blobs, and the app only needs a string to put in an <img>.
  state.createObjectURL = URL.createObjectURL;
  state.revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:http://localhost/test';
  URL.revokeObjectURL = () => {};
  installed = state;
  return window;
}

export async function uninstallDom() {
  if (!installed) return;
  const state = installed;
  installed = null;
  for (const [name, descriptor] of state.saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  URL.createObjectURL = state.createObjectURL;
  URL.revokeObjectURL = state.revokeObjectURL;
  await state.window.happyDOM.close();
}

// What window.confirm() answers, and the messages it was asked.
export function confirmWith(answer) {
  installed.confirmAnswer = answer;
  installed.confirms = [];
  return installed.confirms;
}

export const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

// --- Stand-ins for the api -----------------------------------------------------

export const makeSession = (id = 'user-1', email = 'mila@example.test') => ({ access_token: `token-${id}`, user: { id, email } });

export const LADDER = [{ id: 'essential', level: 1, name: 'Essential' }, { id: 'premium', level: 2, name: 'Premium' }, { id: 'signature', level: 3, name: 'Signature' }];

export const makeViewer = (overrides = {}) => ({
  profile: { id: 'user-1', name: 'Mila Rossi', bio: '', website: '', avatarUrl: null, avatarPath: null },
  settings: { compact: false, welcomeDismissed: true, onboarded: true, notifyPrefs: {} },
  myCreator: null,
  tiers: LADDER,
  following: [], saved: [], liked: [], memberships: [],
  ...overrides
});

// What createFakeApi() has besides the api itself.
const FAKE_HELPERS = ['session', 'db', 'calls', 'signInAs', 'confirmEmail', 'fail', 'emit', 'refresh'];

// An api whose session, viewer and badge counts the test controls, for the store and the shell. It is built on createFakeApi(): every
// method it does not define itself (media, signedUrls, feed, ...) is the fake's, so the whole contract of docs/ARCHITECTURE.md section 6 is
// there with the real result shapes. What it does define is what the core calls, with the calls recorded as tuples in `calls`:
// ['setFollow', id, on]. Use createFakeApi() directly (tests/helpers/fake-api.mjs) when the data should come from the seed.
//   api.emit('SIGNED_IN', makeSession()) simulates the auth events supabase-js delivers.
export function stubApi({ session = null, viewer = makeViewer(), unread = { notifications: 0, messages: 0 }, ...overrides } = {}) {
  const contract = Object.fromEntries(Object.entries(createFakeApi({ signedIn: null })).filter(([name]) => !FAKE_HELPERS.includes(name)));
  const calls = [];
  const listeners = new Set();
  const realtime = new Set();
  const api = {
    ...contract,
    calls,
    session,
    viewer,
    unread,
    emit(event, next = null) { api.session = next; for (const listener of [...listeners]) listener(event, next); },
    pushRealtime(kind, payload) { for (const handlers of [...realtime]) handlers[kind === 'message' ? 'onMessage' : 'onNotification'](payload); },
    async getSession() { return api.session; },
    onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async loadViewer() { calls.push(['loadViewer']); return api.viewer; },
    async unreadCounts() { return api.unread; },
    subscribe(userId, handlers) { calls.push(['subscribe', userId]); realtime.add(handlers); return () => realtime.delete(handlers); },
    async signOut() { calls.push(['signOut']); api.emit('SIGNED_OUT'); },
    async setFollow(id, on) { calls.push(['setFollow', id, on]); },
    async setBookmark(id, on) { calls.push(['setBookmark', id, on]); },
    async setLike(id, on) { calls.push(['setLike', id, on]); },
    async join(creatorId, tierId) { calls.push(['join', creatorId, tierId]); return { creatorId, tierId, level: LADDER.find(t => t.id === tierId)?.level ?? 0 }; },
    async leave(creatorId) { calls.push(['leave', creatorId]); },
    ...overrides
  };
  return api;
}

// --- Mounting the app ------------------------------------------------------------

function appBody() {
  const source = readFileSync(APP_HTML, 'utf8');
  return /<body[^>]*>([\s\S]*)<\/body>/i.exec(source)[1].replace(/<script[\s\S]*?<\/script>/gi, '');
}

let mounted = null;

// Boots the real application (app.html's body, the shell, the router, the store) on `path`. Resolves once the first page is drawn.
// `routes` replaces the route table (tests of the router use small inline views); the last route must be '*'.
export async function mountApp({ api = createFakeApi({ signedIn: null }), path = '/app', recovery = false, routes } = {}) {
  const window = installDom();
  await mounted?.destroy();
  const { startApp } = await import('../../src/core/app.js');
  const { store } = await import('../../src/core/store.js');
  window.history.replaceState(null, '', path);
  window.document.body.innerHTML = appBody();
  window.document.title = '';
  const app = await startApp({ api, root: window.document.querySelector('#app'), store, recovery, ...(routes ? { routes } : {}) });

  const find = selector => {
    const element = window.document.querySelector(selector);
    if (!element) throw new Error(`No element matches "${selector}"`);
    return element;
  };
  const handle = {
    window,
    document: window.document,
    api,
    store,
    router: app.router,
    // Markup of the page (or of any selector).
    html: (selector = '#view') => find(selector).innerHTML,
    text: (selector = '#view') => find(selector).textContent.replace(/\s+/g, ' ').trim(),
    find,
    exists: selector => Boolean(window.document.querySelector(selector)),
    async settle() {
      for (let round = 0; round < 4; round++) {
        await app.router.idle();
        await tick();
      }
    },
    async click(selector) {
      const element = typeof selector === 'string' ? find(selector) : selector;
      element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      await handle.settle();
      return element;
    },
    // Fills the named fields of a form and submits it the way a browser does (a bubbling, cancelable submit event).
    async submit(selector, values = {}) {
      const form = find(selector);
      for (const [name, value] of Object.entries(values)) {
        const fields = [...form.querySelectorAll(`[name="${name}"]`)];
        if (!fields.length) throw new Error(`The form has no field named "${name}"`);
        for (const field of fields) {
          if (field.type === 'checkbox') field.checked = Boolean(value);
          else if (field.type === 'radio') field.checked = field.value === String(value);
          else field.value = String(value);
        }
      }
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      await handle.settle();
      return form;
    },
    async navigate(target) {
      const result = await app.router.navigate(target);
      await handle.settle();
      return result;
    },
    async back() {
      window.history.back();
      await tick(20);
      await handle.settle();
    },
    get path() { return window.location.pathname + window.location.search; },
    async destroy() {
      if (mounted === handle) mounted = null;
      app.stop();
      window.document.body.innerHTML = '';
    }
  };
  mounted = handle;
  return handle;
}
