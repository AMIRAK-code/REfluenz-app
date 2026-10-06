// The router: History API paths, guards, view lifecycle (docs/ARCHITECTURE.md 5.2 and 5.3).
//
// A route is {path, view: () => import(...), auth?}. The view module's default export is
// {title, auth, load(ctx), render(ctx, data), mount(el, ctx, data) → cleanup}. A route may override the view's `auth`.

import * as ui from './ui.js';
import { GUEST_PATHS, isAppPath, legacyTarget, parseQuery, paths, safeNext } from './paths.js';
import { SITE_NAME } from './constants.js';

export { legacyTarget, parseQuery, safeNext };

const MAX_REDIRECTS = 6;
const GENERIC_TITLE = 'Something went wrong';
// Where a person who has not finished onboarding may go without being sent to /app/welcome first.
const ONBOARDING_EXEMPT = ['/app/welcome', '/app/reset', '/app/settings'];

// --- Matching ---------------------------------------------------------------

const cssEscape = value => (globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&'));
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compilePattern(path) {
  if (path === '*') return { keys: [], regex: /^.*$/ };
  const keys = [];
  const source = path.split('/').map(segment => {
    if (!segment.startsWith(':')) return escapeRegex(segment);
    keys.push(segment.slice(1));
    return '([^/]+)';
  }).join('/');
  return { keys, regex: new RegExp(`^${source}/?$`) };
}

export const compileRoutes = routes => routes.map(route => ({ ...route, ...compilePattern(route.path) }));

const decode = value => {
  try { return decodeURIComponent(value); } catch { return value; }
};

// → {route, params} for the first route whose pattern matches, else null. A trailing slash is ignored.
export function matchRoute(compiled, pathname) {
  for (const route of compiled) {
    const found = route.regex.exec(pathname);
    if (found) return { route, params: Object.fromEntries(route.keys.map((key, i) => [key, decode(found[i + 1])])) };
  }
  return null;
}

// --- Guards -------------------------------------------------------------------

// Where a person has to go instead of the page they asked for, or null. Pure: the router passes in what it knows.
//   auth      'optional' | 'required' | 'guest' | 'creator' | 'recovery'
//   url       the requested URL, query      its parsed query
//   state     store.state                   welcomed  the person was already sent to /app/welcome once
export function resolveGuard({ auth = 'optional', url, query = {}, state, welcomed = false }) {
  const signedIn = Boolean(state.user);
  const here = `${url.pathname}${url.search}`;
  if ((auth === 'required' || auth === 'creator') && !signedIn) return paths.login(here);
  if (auth === 'recovery' && !state.recovery && !signedIn) return paths.forgot;
  if (auth === 'creator' && !state.myCreator) return paths.studio();
  if (auth === 'guest' && signedIn) {
    const next = safeNext(query.next);
    return next && !GUEST_PATHS.includes(next.split(/[?#]/)[0]) ? next : paths.home;
  }
  const exempt = ONBOARDING_EXEMPT.some(path => url.pathname === path || url.pathname.startsWith(`${path}/`));
  if (signedIn && auth !== 'guest' && state.settings?.onboarded === false && !welcomed && !exempt) {
    return paths.welcome({ next: here === paths.home ? '' : here });
  }
  return null;
}

// --- Router -------------------------------------------------------------------

export function createRouter({ routes, outlet, store, api, announcer, win = globalThis.window, doc = globalThis.document }) {
  const compiled = compileRoutes(routes);
  const fallback = compiled.find(route => route.path === '*');
  if (!fallback) throw Error('The router needs a "*" route for pages that do not exist.');
  const origin = () => win.location.origin;
  const listeners = new Set();
  const removers = [];

  let current = null; // {path, search, hash, href, query, params, title}
  let view = null;
  let data;
  let ctx = null;
  let cleanup = null;
  let navigation = 0; // the newest navigation; older ones stop when they notice
  let inflight = Promise.resolve();
  let welcomed = false;
  let recoveryRouted = false;
  let seen = { user: null, recovery: false, onboarded: true };
  let started = false;
  let busy = 0; // navigations in progress
  let revalidate = false; // the account changed while one was: check the page again when they are done
  let shownFor = null; // the account the page on screen was loaded for


  const toUrl = target => {
    try { return new URL(String(target), `${origin()}${win.location.pathname}`); } catch { return null; }
  };
  const isLegacy = url => url.pathname === '/app.html';
  const sameDocument = url => url.origin === origin() && (isAppPath(url.pathname) || isLegacy(url));
  const hrefOf = url => `${url.pathname}${url.search}${url.hash}`;

  // --- Leaving a page ---------------------------------------------------------

  const confirmLeave = () => {
    const message = router.block?.();
    return !message || win.confirm(message);
  };

  function runCleanup() {
    const done = cleanup;
    cleanup = null;
    try { if (typeof done === 'function') done(); } catch (error) { console.error(error); }
  }

  function teardown() {
    runCleanup();
    router.block = null;
    ui.modal.close();
    ui.resetRegistry();
  }

  // --- Navigating -------------------------------------------------------------

  // Moves to `target` (a path or URL). Resolves true when a page was shown. `force` skips the "leave this page?" check.
  async function navigate(target, { replace = false, force = false } = {}) {
    const url = toUrl(target);
    if (!url || !sameDocument(url)) {
      win.location.assign(String(target));
      return false;
    }
    if (!force && !confirmLeave()) return false;
    const same = hrefOf(url) === `${win.location.pathname}${win.location.search}${win.location.hash}`;
    return go(url, { replace: replace || same });
  }

  const reload = () => go(toUrl(`${win.location.pathname}${win.location.search}`), { replace: true, keepScroll: true });

  function go(url, options) {
    busy++;
    const run = navigateTo(url, options);
    inflight = run.catch(() => {}).finally(() => {
      if (--busy === 0 && revalidate) {
        revalidate = false;
        recheck();
      }
    });
    return run;
  }

  async function navigateTo(url, { replace = false, popped = false, keepScroll = false, hops = 0, initial = false } = {}) {
    const legacy = isLegacy(url) ? legacyTarget(url.pathname, url.hash) : null;
    if (legacy) return navigateTo(toUrl(legacy), { replace: true, popped, hops: hops + 1, initial });

    const ticket = ++navigation;
    const { route, params } = matchRoute(compiled, url.pathname) ?? { route: fallback, params: {} };
    const query = parseQuery(url.search);

    let module = null;
    let failure = null;
    try { module = await route.view(); } catch (error) { failure = error; }
    if (ticket !== navigation) return false;

    const next = module && (module.default ?? module);
    if (next && hops < MAX_REDIRECTS) {
      const target = guardTarget(route, next, url, query);
      if (target) return navigateTo(toUrl(target), { replace: replace || popped || initial, popped: false, hops: hops + 1, initial });
    }

    if (!popped) commitHistory(url, replace || initial);
    return show({ route, view: next, failure, params, query, url, ticket, popped, keepScroll, initial });
  }

  function guardTarget(route, next, url, query) {
    const state = store.state;
    if (state.recovery && !recoveryRouted && url.pathname !== paths.reset) {
      recoveryRouted = true;
      return paths.reset;
    }
    const target = resolveGuard({ auth: route.auth ?? next.auth, url, query, state, welcomed });
    if (target && target.startsWith('/app/welcome')) welcomed = true;
    return target;
  }

  function saveScroll() {
    try { win.history.replaceState({ ...(win.history.state || {}), scrollY: win.scrollY || 0 }, ''); } catch { /* history is a convenience */ }
  }

  // Keeps the scroll position in the history entry, so back and forward can restore it.
  let scrollTimer = null;
  function onScroll() {
    win.clearTimeout(scrollTimer);
    scrollTimer = win.setTimeout(saveScroll, 150);
  }

  function commitHistory(url, replace) {
    if (!replace) saveScroll();
    try { win.history[replace ? 'replaceState' : 'pushState']({ scrollY: 0 }, '', hrefOf(url)); } catch { /* sandboxed frames */ }
  }

  // --- Showing a page ------------------------------------------------------------

  const titleOf = (page, pageCtx, pageData) => (typeof page.title === 'function' ? page.title(pageCtx, pageData) : page.title) || '';
  const fullTitle = title => (title ? `${title} — ${SITE_NAME}` : SITE_NAME);

  function announce(title) {
    if (!announcer) return;
    announcer.replaceChildren(doc.createTextNode(title ? `${title}, page loaded` : 'Page loaded'));
  }

  function makeContext({ params, query, url, ticket }) {
    const live = () => ticket === navigation;
    return {
      api, store, router, params, query, ui,
      path: url.pathname,
      // Draws the page again from the same data (or from `next`, when given). Does nothing once the person has moved on.
      rerender(next) {
        if (!live()) return;
        if (arguments.length) data = next;
        runCleanup();
        try { paint({ keepFocus: true }); } catch (error) { showFailure(error, ticket); }
      },
      navigate: (path, options) => navigate(path, options),
      reload: () => (live() ? reload() : Promise.resolve(false))
    };
  }

  function markup(output) {
    return ui.isSafe(output) ? output.value : ui.esc(output ?? '');
  }

  function remember(update) {
    current = { ...current, ...update };
  }

  // Draws the current view into the outlet and mounts it.
  function paint({ keepFocus = false } = {}) {
    const focus = keepFocus ? focusKey(doc.activeElement) : null;
    outlet.innerHTML = markup(view.render(ctx, data));
    outlet.removeAttribute('aria-busy');
    const title = titleOf(view, ctx, data);
    remember({ title });
    doc.title = fullTitle(title);
    const done = view.mount?.(outlet, ctx, data);
    cleanup = typeof done === 'function' ? done : null;
    if (focus) restoreFocus(focus);
    return title;
  }

  function focusKey(element) {
    if (!element || !outlet.contains(element)) return null;
    const { id, name, selectionStart, selectionEnd } = element;
    if (id) return { selector: `#${cssEscape(id)}`, selectionStart, selectionEnd };
    if (name) return { selector: `[name="${cssEscape(name)}"]`, selectionStart, selectionEnd };
    return null;
  }

  function restoreFocus({ selector, selectionStart, selectionEnd }) {
    const element = outlet.querySelector(selector);
    if (!element) return;
    element.focus({ preventScroll: true });
    try { if (selectionStart != null) element.setSelectionRange(selectionStart, selectionEnd); } catch { /* not a text field */ }
  }

  function showFailure(error, ticket) {
    console.error(error);
    outlet.innerHTML = ui.errorState(error, { retry: () => { if (ticket === navigation) reload(); } }).value;
    outlet.removeAttribute('aria-busy');
    remember({ title: GENERIC_TITLE });
    doc.title = fullTitle(GENERIC_TITLE);
    announce(GENERIC_TITLE);
  }

  async function show({ route, view: next, failure, params, query, url, ticket, popped, keepScroll, initial }) {
    teardown();
    view = next;
    data = undefined;
    ctx = null;
    current = { path: url.pathname, search: url.search, hash: url.hash, href: hrefOf(url), query, params, title: '', route };
    shownFor = store.state.user?.id ?? null;
    outlet.setAttribute('aria-busy', 'true');
    outlet.innerHTML = ui.skeleton('page').value;
    tell();

    if (failure) {
      showFailure(failure, ticket);
      return false;
    }
    ctx = makeContext({ params, query, url, ticket });
    try {
      if (view.load) data = await view.load(ctx);
      if (ticket !== navigation) return false;
      const title = paint();
      tell();
      afterShow({ title, popped, keepScroll, initial });
      return true;
    } catch (error) {
      if (ticket !== navigation) return false;
      runCleanup();
      showFailure(error, ticket);
      return false;
    }
  }

  function afterShow({ title, popped, keepScroll, initial }) {
    announce(title);
    if (!keepScroll) win.scrollTo(0, popped ? win.history.state?.scrollY || 0 : 0);
    if (!initial) doc.getElementById('main')?.focus({ preventScroll: true });
  }

  function tell() {
    for (const listener of [...listeners]) {
      try { listener(current); } catch (error) { console.error(error); }
    }
  }

  const onChange = fn => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const idle = async () => {
    let last;
    do {
      last = inflight;
      await last;
    } while (last !== inflight);
  };

  // --- Browser events ---------------------------------------------------------------

  function onClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target?.closest?.('a[href]');
    if (!link || link.hasAttribute('data-native') || link.hasAttribute('download')) return;
    const target = link.getAttribute('target');
    if (target && target !== '_self') return;
    const href = link.getAttribute('href');
    if (href.startsWith('#')) return;
    const url = toUrl(href);
    if (!url || !sameDocument(url)) return;
    event.preventDefault();
    navigate(hrefOf(url));
  }

  function onPopState() {
    const url = toUrl(`${win.location.pathname}${win.location.search}${win.location.hash}`);
    if (current && url.pathname === current.path && url.search === current.search) {
      remember({ hash: url.hash, href: hrefOf(url) }); // only the fragment changed
      return;
    }
    if (!confirmLeave()) {
      try { win.history.pushState({ scrollY: 0 }, '', current.href); } catch { /* nothing to undo */ }
      return;
    }
    go(url, { popped: true });
  }

  function onBeforeUnload(event) {
    if (router.block?.()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  // The account changed while a page is open: a page that needs another kind of visitor is left, the others are drawn
  // again for the new account (unless they were loaded for it already).
  function recheck() {
    if (!current || !view || !started) return;
    const url = toUrl(current.href);
    const target = guardTarget(current.route, view, url, current.query);
    if (target) navigate(target, { replace: true, force: true });
    else if (shownFor !== (store.state.user?.id ?? null)) go(url, { replace: true, keepScroll: true });
  }

  function onStoreChange(state) {
    const now = { user: state.user?.id ?? null, recovery: state.recovery, onboarded: state.settings?.onboarded !== false };
    const changed = now.user !== seen.user || now.recovery !== seen.recovery || now.onboarded !== seen.onboarded;
    if (now.user !== seen.user) welcomed = false;
    seen = now;
    if (!changed || !started) return;
    if (!now.recovery) recoveryRouted = false;
    if (busy) revalidate = true; // the navigation in progress is not interrupted; it is checked when it ends
    else recheck();
  }

  // --- Lifecycle ---------------------------------------------------------------------

  async function start() {
    if (started) return;
    started = true;
    try { win.history.scrollRestoration = 'manual'; } catch { /* optional */ }
    doc.addEventListener('click', onClick);
    win.addEventListener('popstate', onPopState);
    win.addEventListener('beforeunload', onBeforeUnload);
    win.addEventListener('scroll', onScroll, { passive: true });
    removers.push(
      () => { win.clearTimeout(scrollTimer); win.removeEventListener('scroll', onScroll); },
      () => doc.removeEventListener('click', onClick),
      () => win.removeEventListener('popstate', onPopState),
      () => win.removeEventListener('beforeunload', onBeforeUnload),
      store.subscribe(onStoreChange)
    );
    await store.whenReady();
    seen = { user: store.state.user?.id ?? null, recovery: store.state.recovery, onboarded: store.state.settings?.onboarded !== false };
    const url = toUrl(`${win.location.pathname}${win.location.search}${win.location.hash}`);
    await go(url && sameDocument(url) ? url : toUrl(paths.home), { replace: true, initial: true });
  }

  function stop() {
    started = false;
    navigation++;
    removers.splice(0).forEach(remove => remove());
    teardown();
    listeners.clear();
  }

  // `block`: a view sets it to a function returning a message while it holds unsaved work (the editor).
  const router = { block: null, start, stop, navigate, reload, idle, onChange, get current() { return current; } };
  return router;
}

