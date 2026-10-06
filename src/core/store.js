// The viewer's state: who is signed in and everything the interface needs to know about them
// (profile, settings, atelier, tiers, follows, saves, likes, memberships, unread counts).
//
// `store` is the instance the app uses; createStore() makes independent ones for tests.
// Writes that the person triggers with one click (follow, save, like) are optimistic: the state changes at once, the
// request follows, and a failure rolls the change back with a toast. Everything is guarded against account changes:
// an answer that arrives for a previous account is dropped.

import { DEFAULT_SETTINGS, TIER_LEVELS } from './constants.js';
import { paths, safeNext } from './paths.js';
import { html, modal, toast } from './ui.js';

const emptyUnread = () => ({ notifications: 0, messages: 0 });

const initialState = () => ({
  ready: false,
  session: null,
  user: null, // {id, email}
  profile: null,
  settings: { ...DEFAULT_SETTINGS },
  myCreator: null,
  tiers: [],
  following: new Set(),
  saved: new Set(),
  liked: new Set(),
  memberships: new Map(),
  unread: emptyUnread(),
  recovery: false, // the person arrived through a password recovery link and still has to choose a new password
  viewerError: null // set when the viewer's data could not be loaded
});

const toUser = user => ({ id: user.id, email: user.email ?? '' });
const count = value => Math.max(0, Math.trunc(Number(value)) || 0);

export function createStore() {
  const state = initialState();
  const listeners = new Set();
  const realtimeListeners = new Set();
  const pending = new Set(); // toggles in flight, one per target
  let api = null;
  let generation = 0; // bumped by init() and destroy(): older work is dropped
  let accountTicket = 0; // bumped on every sign-in and sign-out: older viewer loads are dropped
  let loadingFor = null; // user id whose viewer data is being loaded
  let stopAuth = null;
  let stopRealtime = null;
  let ready = Promise.resolve();
  let markReady = () => {};

  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener(state); } catch (error) { console.error(error); }
    }
  };
  const subscribe = fn => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  // --- Reading ---------------------------------------------------------------

  const levelOf = tierId => {
    if (!tierId || tierId === 'public') return 0;
    return state.tiers.find(tier => tier.id === tierId)?.level ?? TIER_LEVELS[tierId] ?? 99;
  };
  const membershipLevel = creatorId => {
    const membership = state.memberships.get(creatorId);
    return membership ? membership.level ?? levelOf(membership.tierId) : 0;
  };
  // A hint for the interface (what to draw, what to offer). The database enforces the same rule.
  const canRead = entry => {
    if (!entry) return false;
    if (state.myCreator && entry.creatorId === state.myCreator.id) return true;
    if (!entry.access || entry.access === 'public') return true;
    return membershipLevel(entry.creatorId) >= levelOf(entry.access);
  };

  // --- Account ---------------------------------------------------------------

  function applyViewer(viewer) {
    state.profile = viewer.profile ?? null;
    state.settings = { ...DEFAULT_SETTINGS, ...viewer.settings };
    state.myCreator = viewer.myCreator ?? null;
    state.tiers = viewer.tiers ?? [];
    state.following = new Set(viewer.following ?? []);
    state.saved = new Set(viewer.saved ?? []);
    state.liked = new Set(viewer.liked ?? []);
    state.memberships = new Map((viewer.memberships ?? []).map(membership => [membership.creatorId, membership]));
  }

  // Back to the guest state. A recovery flag survives a sign-in (the recovery link signs the person in) but not a sign-out.
  function clearViewer({ keepRecovery = false } = {}) {
    const { ready: wasReady, recovery } = state;
    Object.assign(state, initialState(), { ready: wasReady, recovery: keepRecovery && recovery });
  }

  // The session and the viewer's data arrive together, so nothing reacts to a half-loaded account.
  async function signIn(session) {
    const user = toUser(session.user);
    if (state.user?.id === user.id) {
      const changed = state.user.email !== user.email;
      state.session = session;
      state.user = user;
      if (changed) notify();
      return;
    }
    if (loadingFor === user.id) return;
    loadingFor = user.id;
    const ticket = ++accountTicket;
    const stale = () => ticket !== accountTicket;
    let viewer = null;
    let failure = null;
    try {
      viewer = await api.loadViewer();
    } catch (error) {
      failure = error;
    }
    if (stale()) return;
    loadingFor = null;
    clearViewer({ keepRecovery: true });
    if (viewer) applyViewer(viewer);
    state.session = session;
    state.user = user;
    state.viewerError = failure;
    notify();
    refreshUnread();
    listen(user.id);
  }

  function signOutLocal() {
    accountTicket++;
    loadingFor = null;
    stopRealtime?.();
    stopRealtime = null;
    if (!state.user && !state.session) return;
    clearViewer();
    notify();
  }

  function handleAuthEvent(event, session) {
    if (event === 'SIGNED_OUT') return signOutLocal();
    if (event === 'PASSWORD_RECOVERY') {
      state.recovery = true;
      notify();
    }
    if (session?.user) return signIn(session);
    return undefined;
  }

  async function init(nextApi, { recovery = false } = {}) {
    destroy();
    api = nextApi;
    const mine = ++generation;
    Object.assign(state, initialState(), { recovery: Boolean(recovery) });
    ready = new Promise(resolve => { markReady = resolve; });
    // Subscribe first: supabase-js can announce a recovery or a session while getSession() is still reading the URL.
    // The api delivers events a tick late, so one can arrive after destroy() or a newer init(): those are ignored.
    stopAuth = api.onAuthChange?.((event, session) => { if (mine === generation) handleAuthEvent(event, session); }) ?? null;
    let session = null;
    try { session = await api.getSession(); } catch { /* treated as signed out */ }
    if (mine !== generation) return;
    if (session?.user) await signIn(session);
    if (mine !== generation) return;
    state.ready = true;
    markReady();
    notify();
  }

  function destroy() {
    generation++;
    accountTicket++;
    loadingFor = null;
    stopAuth?.();
    stopRealtime?.();
    stopAuth = stopRealtime = null;
    markReady();
  }

  // Re-reads the viewer's data after something changed it on the server. Rejects when the request fails.
  async function reloadViewer() {
    if (!state.user) return state;
    const ticket = accountTicket;
    const viewer = await api.loadViewer();
    if (ticket !== accountTicket) return state;
    applyViewer(viewer);
    state.viewerError = null;
    notify();
    return state;
  }

  // Merges the result of a write into the state: update({profile, settings: {onboarded: true}, myCreator}).
  function update(partial = {}) {
    const { settings, ...rest } = partial;
    Object.assign(state, rest);
    if (settings) state.settings = { ...state.settings, ...settings };
    notify();
  }

  const setRecovery = on => {
    if (state.recovery === Boolean(on)) return;
    state.recovery = Boolean(on);
    notify();
  };

  async function refreshUnread() {
    const user = state.user?.id;
    if (!user) {
      state.unread = emptyUnread();
      return;
    }
    try {
      const counts = await api.unreadCounts();
      if (state.user?.id !== user) return;
      state.unread = { notifications: count(counts?.notifications), messages: count(counts?.messages) };
      notify();
    } catch { /* the badges keep their last values */ }
  }

  // --- Realtime --------------------------------------------------------------

  const onRealtime = fn => {
    realtimeListeners.add(fn);
    return () => realtimeListeners.delete(fn);
  };
  const emitRealtime = event => {
    for (const listener of [...realtimeListeners]) {
      try { listener(event); } catch (error) { console.error(error); }
    }
  };

  function listen(userId) {
    stopRealtime?.();
    stopRealtime = null;
    try {
      const stop = api.subscribe?.(userId, {
        onNotification: payload => { emitRealtime({ type: 'notification', payload }); refreshUnread(); },
        onMessage: payload => { emitRealtime({ type: 'message', payload }); refreshUnread(); }
      });
      if (state.user?.id === userId) stopRealtime = stop ?? null;
      else stop?.();
    } catch { /* live updates are a convenience: the badges refresh on the next load */ }
  }

  // --- Signing in on demand ---------------------------------------------------

  // Guests who try an account action get a dialog with the two ways in, and the action does not run.
  function requireAuth(message = 'Sign in to continue.') {
    if (state.user) return true;
    const here = safeNext(`${globalThis.location?.pathname ?? ''}${globalThis.location?.search ?? ''}`);
    modal.open({
      title: 'Sign in to continue',
      className: 'sign-in-prompt',
      body: html`<p>${message}</p><div class="dialog-actions"><a class="button" href="${paths.login(here)}">Sign in</a><a class="button secondary" href="${paths.signup(here)}">Create a free account</a></div>`
    });
    return false;
  }

  // --- Optimistic toggles ------------------------------------------------------

  const withMember = (set, id, on) => {
    const next = new Set(set);
    if (on) next.add(id); else next.delete(id);
    return next;
  };

  // `apply(on)` changes the state and returns the function that puts it back exactly as it was.
  async function toggle({ key, message, has, apply, request, fallback }) {
    if (!requireAuth(message)) return false;
    if (pending.has(key)) return false;
    pending.add(key);
    const user = state.user.id;
    const next = !has();
    const undo = apply(next);
    notify();
    try {
      await request(next);
      return true;
    } catch (error) {
      if (state.user?.id === user) {
        undo();
        notify();
      }
      toast(error?.message || fallback, { tone: 'error' });
      return false;
    } finally {
      pending.delete(key);
    }
  }

  const toggleFollow = creatorId => {
    if (state.myCreator?.id === creatorId) return Promise.resolve(false);
    return toggle({
      key: `follow:${creatorId}`,
      message: 'Sign in to follow creators.',
      fallback: 'We could not update your follows. Try again.',
      has: () => state.following.has(creatorId),
      apply: on => {
        state.following = withMember(state.following, creatorId, on);
        return () => { state.following = withMember(state.following, creatorId, !on); };
      },
      request: on => api.setFollow(creatorId, on)
    });
  };

  const toggleSave = entryId => toggle({
    key: `save:${entryId}`,
    message: 'Sign in to save posts to your library.',
    fallback: 'We could not update your library. Try again.',
    has: () => state.saved.has(entryId),
    apply: on => {
      state.saved = withMember(state.saved, entryId, on);
      return () => { state.saved = withMember(state.saved, entryId, !on); };
    },
    request: on => api.setBookmark(entryId, on)
  });

  // The entry object is updated in place (likeCount), so the post you are looking at shows the new number.
  const toggleLike = entry => toggle({
    key: `like:${entry.id}`,
    message: 'Sign in to like posts.',
    fallback: 'We could not save your like. Try again.',
    has: () => state.liked.has(entry.id),
    apply: on => {
      const before = entry.likeCount;
      state.liked = withMember(state.liked, entry.id, on);
      entry.likeCount = Math.max(0, count(before) + (on ? 1 : -1));
      return () => {
        state.liked = withMember(state.liked, entry.id, !on);
        entry.likeCount = before;
      };
    },
    request: on => api.setLike(entry.id, on)
  });

  // --- Memberships (not optimistic: the views show progress and handle the error) ---

  async function join(creatorId, tierId) {
    if (!requireAuth('Sign in to join a circle.')) return null;
    const user = state.user.id;
    const membership = await api.join(creatorId, tierId);
    if (state.user?.id === user) {
      state.memberships = new Map(state.memberships).set(creatorId, membership);
      notify();
    }
    return membership;
  }

  async function leave(creatorId) {
    const user = state.user?.id;
    await api.leave(creatorId);
    if (state.user?.id === user) {
      const next = new Map(state.memberships);
      next.delete(creatorId);
      state.memberships = next;
      notify();
    }
  }

  return {
    state,
    subscribe,
    init,
    destroy,
    whenReady: () => ready,
    reloadViewer,
    refreshUnread,
    update,
    setRecovery,
    signOutLocal,
    onRealtime,
    requireAuth,
    canRead,
    levelOf,
    toggleFollow,
    toggleSave,
    toggleLike,
    join,
    leave
  };
}

export const store = createStore();
