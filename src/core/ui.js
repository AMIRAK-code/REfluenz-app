// The UI kit: safe markup, small components and the dialog / toast / file helpers every view builds on.
// Components return `Safe` markup (see `html`); the few that touch the document (toast, modal, pickFiles, ...) say so.
//
// Toggle buttons (follow, save, like) are plain markup: the shell listens for their clicks once, for the whole page,
// and keeps them in step with the store. Views only render them.

import { icon as drawIcon } from '../icons.js';
import { store } from './store.js';
import { coverFor } from './covers.js';
import { paths } from './paths.js';
import { TIER_NAMES, presetUrl } from './constants.js';
import { compactNumber, duration, entrySize, initials, kindOf, mediaCount, money, plural, timeAgo } from './format.js';

// --- Safe markup ------------------------------------------------------------

class Safe {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

export const isSafe = value => value instanceof Safe;
export const raw = value => (value instanceof Safe ? value : new Safe(String(value ?? '')));

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = value => String(value ?? '').replace(/[&<>"'`]/g, char => ESCAPES[char]);

const SAFE_SCHEMES = new Set(['https:', 'http:', 'mailto:', 'blob:']);

// Allows https:, http:, mailto:, blob: and same-origin paths; everything else ('javascript:', 'data:', '//host', ...) becomes '#'.
export function safeUrl(value) {
  const text = String(value ?? '').trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) return '#';
  if (text.startsWith('#')) return text;
  if (text.startsWith('/')) return text[1] === '/' || text[1] === '\\' ? '#' : text;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  return scheme && SAFE_SCHEMES.has(`${scheme[1].toLowerCase()}:`) ? text : '#';
}

// The text right before an interpolation tells which context it lands in.
const URL_ATTRIBUTE = /(?:^|[\s"'])(?:href|src|action|formaction|poster|xlink:href|data)\s*=\s*["']?$/i;
const EVENT_ATTRIBUTE = /(?:^|[\s"'])on[a-z]+\s*=\s*["']?$/i;
const UNQUOTED_ATTRIBUTE = /=\s*$/;

function render(value) {
  if (value === null || value === undefined || value === false || typeof value === 'function') return '';
  if (value instanceof Safe) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return esc(value);
}

// A value that starts a URL attribute must be a safe URL. Trusted markup (Safe) is checked the same way.
function renderUrl(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return render(value);
  const text = value instanceof Safe ? value.value : String(value);
  const url = safeUrl(text);
  return value instanceof Safe ? url : esc(url);
}

// Without quotes, a space or `=` in the value would start a new attribute: encode them.
const encodeUnquoted = text => text.replace(/[\s=/]/g, char => `&#${char.charCodeAt(0)};`);

// Escapes every interpolation (text, quoted and unquoted attributes), joins arrays, drops null / undefined / false.
// A value that starts an href / src / action / poster attribute goes through safeUrl, and `on*=` attributes never
// receive a value. Nested `html` results and `raw()` are trusted and inserted as they are.
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const before = strings[i];
    let piece;
    if (EVENT_ATTRIBUTE.test(before)) piece = '';
    else {
      piece = URL_ATTRIBUTE.test(before) ? renderUrl(values[i]) : render(values[i]);
      if (UNQUOTED_ATTRIBUTE.test(before)) piece = encodeUnquoted(piece);
    }
    out += piece + strings[i + 1];
  }
  return new Safe(out);
}

const ATTRIBUTE_NAME = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;
const URL_ATTRIBUTE_NAMES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href', 'data']);

// attrs({id: 'x', disabled: true, 'data-id': 7}) → ' id="x" disabled data-id="7"'. Event handler attributes and
// invalid names are dropped, URLs are checked.
export function attrs(map = {}) {
  return raw(Object.entries(map || {})
    .filter(([name, value]) => ATTRIBUTE_NAME.test(name) && !/^on/i.test(name) && value !== null && value !== undefined && value !== false)
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${esc(URL_ATTRIBUTE_NAMES.has(name.toLowerCase()) ? safeUrl(value) : value)}"`))
    .join(''));
}

// --- Components -------------------------------------------------------------

export const icon = (name, size = 18) => raw(drawIcon(name, size));

// A person or creator: their picture, or their initials. `size` is in px.
export function avatar(person, { size = 36 } = {}) {
  const px = Math.max(16, Math.round(Number(size)) || 36);
  const style = `--avatar-size:${px}px`;
  if (person?.avatarUrl) {
    return html`<span class="avatar" style="${style}"><img src="${person.avatarUrl}" alt="" loading="lazy" decoding="async"></span>`;
  }
  return html`<span class="avatar avatar--initials" style="${style}" aria-hidden="true">${initials(person?.name) || icon('user', Math.round(px * 0.5))}</span>`;
}

const BADGE_TONES = new Set(['neutral', 'accent', 'ink', 'danger']);
export const badge = (text, tone = 'neutral') => html`<span class="badge badge--${BADGE_TONES.has(tone) ? tone : 'neutral'}">${text}</span>`;

const BUTTON_VARIANTS = { primary: '', secondary: 'secondary', light: 'light', danger: 'danger', ghost: 'ghost' };

// button('Save', {variant: 'secondary', size: 'small', attrs: {'data-action': 'save'}}); with `href` it renders a link.
export function button(label, { variant = 'primary', size = '', type = 'button', attrs: extra = {}, href, icon: iconName } = {}) {
  const classes = ['button', BUTTON_VARIANTS[variant] ?? '', size === 'small' ? 'small' : ''].filter(Boolean).join(' ');
  const content = html`${iconName && icon(iconName, 16)}<span>${label}</span>`;
  if (href !== undefined) return html`<a class="${classes}" href="${href}"${attrs(extra)}>${content}</a>`;
  return html`<button type="${type === 'submit' || type === 'reset' ? type : 'button'}" class="${classes}"${attrs(extra)}>${content}</button>`;
}

function skeletonCards(count) {
  return html`<div class="skeleton-grid">${Array.from({ length: count }, () => html`<div class="skeleton-card"><span class="skeleton-block skeleton-cover"></span><span class="skeleton-block skeleton-line wide"></span><span class="skeleton-block skeleton-line"></span></div>`)}</div>`;
}
function skeletonRows(count) {
  return html`<div class="skeleton-rows">${Array.from({ length: count }, () => html`<div class="skeleton-row"><span class="skeleton-block skeleton-thumb"></span><span class="skeleton-stack"><span class="skeleton-block skeleton-line wide"></span><span class="skeleton-block skeleton-line"></span></span></div>`)}</div>`;
}

// Loading placeholders: 'page' (heading and cards), 'cards', 'list', 'text'. The status text is for screen readers.
export function skeleton(kind = 'page', count) {
  let body;
  if (kind === 'cards') body = skeletonCards(count ?? 6);
  else if (kind === 'list') body = skeletonRows(count ?? 5);
  else if (kind === 'text') body = html`<div class="skeleton-stack">${Array.from({ length: count ?? 4 }, (_, i) => html`<span class="skeleton-block skeleton-line${i % 3 === 0 ? ' wide' : ''}"></span>`)}</div>`;
  else body = html`<div class="skeleton-head"><span class="skeleton-block skeleton-line short"></span><span class="skeleton-block skeleton-title"></span></div>${skeletonCards(count ?? 6)}`;
  return html`<div class="skeleton skeleton--${kind}" role="status"><span class="visually-hidden">Loading</span><div aria-hidden="true">${body}</div></div>`;
}

function renderAction(action) {
  if (!action) return '';
  if (isSafe(action)) return action;
  return button(action.label, { variant: action.variant, href: action.href, attrs: action.attrs, icon: action.icon });
}

// emptyState({icon: 'bookmark', title, text, action: button(...) | {label, href}})
export function emptyState({ icon: iconName, title, text, action } = {}) {
  return html`<div class="empty">${iconName && html`<span class="empty-icon">${icon(iconName, 26)}</span>`}<h3>${title}</h3>${text && html`<p>${text}</p>`}${renderAction(action)}</div>`;
}

// Retry buttons are plain markup too: the click is routed here by one document listener.
const retries = new Map();
let retryCount = 0;
// The listener belongs to one document (a page has one; tests install a new one per suite), so it is tracked per document.
const retryDocuments = new WeakSet();

function listenForRetries() {
  if (typeof document === 'undefined' || retryDocuments.has(document)) return;
  retryDocuments.add(document);
  document.addEventListener('click', event => {
    const target = event.target?.closest?.('[data-retry]');
    const retry = target && retries.get(target.dataset.retry);
    if (!retry) return;
    event.preventDefault();
    retries.delete(target.dataset.retry);
    retry();
  });
}

// Programming errors say nothing a person can use; everything else (the api's friendly messages) is shown as it is.
const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError, RangeError];
const GENERIC_ERROR = 'Something went wrong. Try again in a moment.';

export function errorState(error, { retry, title = 'We could not load this' } = {}) {
  const programming = PROGRAMMING_ERRORS.some(type => error instanceof type);
  const message = programming ? GENERIC_ERROR : (error?.message || (typeof error === 'string' ? error : '') || GENERIC_ERROR);
  let action = '';
  if (typeof retry === 'function') {
    const id = String(++retryCount);
    retries.set(id, retry);
    listenForRetries();
    action = button('Retry', { variant: 'secondary', attrs: { 'data-retry': id } });
  }
  return html`<div class="error-state" role="alert"><span class="empty-icon">${icon('alert', 26)}</span><h3>${title}</h3><p>${message}</p>${action}</div>`;
}

// What a page registers while it is drawn: retry handlers and the entries behind like buttons. Cleared on navigation.
const likeSubjects = new Map();
export const likeSubject = id => likeSubjects.get(id);
export function resetRegistry() {
  retries.clear();
  likeSubjects.clear();
}

// --- Toasts -----------------------------------------------------------------

const TOAST_LIMIT = 3;
const TOAST_MS = { default: 4500, success: 4500, error: 7000 };

function region(id, tag = 'div') {
  let node = document.getElementById(id);
  if (!node) {
    node = document.createElement(tag);
    node.id = id;
    document.body.append(node);
  }
  return node;
}

// Announced politely through the #toast live region. tone: 'default' | 'success' | 'error'.
export function toast(message, { tone = 'default' } = {}) {
  if (typeof document === 'undefined' || !message) return;
  const host = region('toast');
  const item = document.createElement('p');
  item.className = `toast toast--${tone in TOAST_MS ? tone : 'default'}`;
  item.textContent = String(message);
  host.append(item);
  while (host.children.length > TOAST_LIMIT) host.firstElementChild.remove();
  const timer = setTimeout(() => item.remove(), TOAST_MS[tone] ?? TOAST_MS.default);
  timer.unref?.();
}

// --- Dialogs ----------------------------------------------------------------

let active = null;

function focusInto(dialog) {
  const target = dialog.querySelector('[autofocus]')
    || dialog.querySelector('.dialog-body :is(input, textarea, select, button, a[href]):not([disabled])')
    || dialog.querySelector('[data-modal-close]');
  target?.focus?.();
}

// `replaced`: another dialog takes this one's place straight away, so the element stays open and focus stays put.
function finish(session, result, { replaced = false } = {}) {
  if (session.done) return;
  session.done = true;
  session.listeners.abort();
  if (active === session) active = null;
  if (!replaced && session.dialog.open) session.dialog.close();
  session.options.onClose?.(result);
  if (!replaced && session.opener?.isConnected) session.opener.focus?.();
}

// One dialog at a time, in the shared <dialog id="modal">. Escape, the close button and a click on the backdrop close it.
// open({title, body, className, onMount(el, handle), onClose(result)}) → {el, close(result)}
export const modal = {
  open({ title = '', body = '', className = '', onMount, onClose } = {}) {
    const dialog = region('modal', 'dialog');
    const opener = active ? active.opener : document.activeElement;
    if (active) finish(active, undefined, { replaced: true });
    const session = { dialog, options: { onClose }, listeners: new AbortController(), opener, done: false };
    active = session;
    dialog.className = className ? `modal ${className}` : 'modal';
    dialog.setAttribute('aria-labelledby', 'modal-title');
    dialog.innerHTML = html`<div class="dialog-head"><h2 id="modal-title">${title}</h2><button type="button" class="icon-button" data-modal-close aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${isSafe(body) ? body : html`<p>${body}</p>`}</div>`.value;

    const { signal } = session.listeners;
    // A 'close' event is queued when a dialog closes: one that arrives after the dialog was opened again is not ours.
    dialog.addEventListener('close', () => { if (!dialog.open) finish(session); }, { signal });
    dialog.addEventListener('click', event => {
      if (event.target.closest?.('[data-modal-close]')) return finish(session);
      if (event.target === dialog) {
        const box = dialog.getBoundingClientRect();
        const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
        if (outside) finish(session);
      }
    }, { signal });

    const handle = { el: dialog, close: result => finish(session, result) };
    if (!dialog.open) dialog.showModal();
    focusInto(dialog);
    onMount?.(dialog, handle);
    return handle;
  },
  close(result) {
    if (active) finish(active, result);
  },
  get isOpen() {
    return Boolean(active);
  }
};

// confirmDialog({title, text, confirmLabel, tone: 'danger'}) → Promise<boolean>. Dismissing the dialog is a "no".
export function confirmDialog({ title = 'Are you sure?', text = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'default' } = {}) {
  return new Promise(resolve => {
    modal.open({
      title,
      className: 'confirm',
      body: html`${text && html`<p>${text}</p>`}<div class="dialog-actions">${button(cancelLabel, { variant: 'secondary', attrs: { 'data-confirm': 'no', autofocus: true } })}${button(confirmLabel, { variant: tone === 'danger' ? 'danger' : 'primary', attrs: { 'data-confirm': 'yes' } })}</div>`,
      onMount: (el, handle) => el.addEventListener('click', event => {
        const choice = event.target.closest?.('[data-confirm]');
        if (choice) handle.close(choice.dataset.confirm === 'yes');
      }),
      onClose: result => resolve(result === true)
    });
  });
}

// --- Helpers ----------------------------------------------------------------

const CAPTURED_EVENTS = new Set(['focus', 'blur', 'load', 'error', 'mouseenter', 'mouseleave']);

// Listens on `root` for events whose target is (inside) `selector`; fn(event, matchedElement). Returns the remover.
export function delegate(root, type, selector, fn) {
  const handler = event => {
    const start = event.target instanceof Element ? event.target : event.target?.parentElement;
    const match = start?.closest(selector);
    if (match && root.contains(match)) fn(event, match);
  };
  const capture = CAPTURED_EVENTS.has(type);
  root.addEventListener(type, handler, capture);
  return () => root.removeEventListener(type, handler, capture);
}

// Disables a button and marks it busy while its action runs; restores what was there before.
export function setBusy(control, busy) {
  if (!control) return;
  if (busy) {
    if (control.dataset.busy) return;
    control.dataset.busy = '1';
    control.dataset.wasDisabled = control.disabled ? '1' : '';
    control.disabled = true;
    control.setAttribute('aria-busy', 'true');
  } else if (control.dataset.busy) {
    control.disabled = control.dataset.wasDisabled === '1';
    delete control.dataset.busy;
    delete control.dataset.wasDisabled;
    control.removeAttribute('aria-busy');
  }
}

export function debounce(fn, ms = 250) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  return wrapped;
}

// Calls loadMore() whenever `sentinel` scrolls near the viewport. loadMore resolves false when nothing is left; a
// failure stops the observer (the view shows its own retry) so a broken request cannot loop. Returns disconnect().
export function infiniteScroll(sentinel, loadMore) {
  if (!sentinel || typeof IntersectionObserver === 'undefined') return () => {};
  let loading = false;
  let done = false;
  const observer = new IntersectionObserver(entries => {
    if (!done && !loading && entries.some(entry => entry.isIntersecting)) load();
  }, { rootMargin: '400px 0px' });
  const stop = () => { done = true; observer.disconnect(); };
  async function load() {
    loading = true;
    try {
      if ((await loadMore()) === false) return stop();
    } catch {
      return stop();
    } finally {
      loading = false;
    }
    // The sentinel may still be on screen: observe it again so that a short page keeps filling up.
    observer.unobserve(sentinel);
    observer.observe(sentinel);
  }
  observer.observe(sentinel);
  return stop;
}

// Opens the system file picker. Resolves with the chosen files, or [] when the picker is dismissed.
export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    if (accept) input.accept = accept;
    input.multiple = Boolean(multiple);
    const finishPicking = () => { input.remove(); resolve([...(input.files || [])]); };
    input.addEventListener('change', finishPicking, { once: true });
    input.addEventListener('cancel', finishPicking, { once: true });
    document.body.append(input);
    input.click();
  });
}

// --- Toggle buttons (follow, save, like) ------------------------------------

const followContent = on => html`${icon(on ? 'check' : 'plus', 14)}<span data-label>${on ? 'Following' : 'Follow'}</span>`;
const likeContent = (on, count) => html`${icon('heart', 16)}<span class="count" data-count>${count > 0 ? compactNumber(count) : ''}</span>`;

// Your own atelier cannot be followed, so it gets no button.
export function followButton(creatorId) {
  if (store.state.myCreator?.id === creatorId) return html``;
  const on = store.state.following.has(creatorId);
  return html`<button type="button" class="button secondary small follow-button" data-follow="${creatorId}" aria-pressed="${String(on)}">${followContent(on)}</button>`;
}

export function saveButton(entry) {
  const on = store.state.saved.has(entry.id);
  return html`<button type="button" class="icon-button save-button" data-save="${entry.id}" aria-pressed="${String(on)}" aria-label="Save to library">${icon('bookmark', 17)}</button>`;
}

export function likeButton(entry) {
  likeSubjects.set(entry.id, entry);
  const on = store.state.liked.has(entry.id);
  return html`<button type="button" class="icon-button like-button" data-like="${entry.id}" aria-pressed="${String(on)}" aria-label="Like this post">${likeContent(on, entry.likeCount | 0)}</button>`;
}

// Brings every toggle button inside `root` in line with the store (after an optimistic change, a rollback, a sign-in).
export function syncToggles(root = document) {
  for (const control of root.querySelectorAll('[data-follow]')) {
    const on = store.state.following.has(control.dataset.follow);
    if (control.getAttribute('aria-pressed') === String(on)) continue;
    control.setAttribute('aria-pressed', String(on));
    control.innerHTML = followContent(on).value;
  }
  for (const control of root.querySelectorAll('[data-save]')) {
    control.setAttribute('aria-pressed', String(store.state.saved.has(control.dataset.save)));
  }
  for (const control of root.querySelectorAll('[data-like]')) {
    const id = control.dataset.like;
    control.setAttribute('aria-pressed', String(store.state.liked.has(id)));
    const subject = likeSubjects.get(id);
    const label = control.querySelector('[data-count]');
    if (subject && label) label.textContent = subject.likeCount > 0 ? compactNumber(subject.likeCount) : '';
  }
}

// --- Cards ------------------------------------------------------------------

// Decorative: the same facts are in the card text ("Gallery · 3 images", "Film · 1:32").
export function kindBadge(entry) {
  const kind = kindOf(entry);
  if (kind === 'text') return html``;
  const label = kind === 'image' ? (mediaCount(entry) > 1 ? String(mediaCount(entry)) : '') : duration(entry.duration) || 'Video';
  return html`<span class="kind-badge" aria-hidden="true">${icon(kind === 'image' ? 'image' : 'play', 11)}${label && html`<span>${label}</span>`}</span>`;
}

const tierName = id => store.state.tiers.find(tier => tier.id === id)?.name || TIER_NAMES[id] || 'Members';

// A post in a grid or list. Locked posts keep their title and excerpt but only ever show the blurred preview.
// Covers of readable image and video posts are filled in later: call hydrateCovers(root, entries, api, store) after mounting.
export function entryCard(entry, { compact = false, showCreator = true } = {}) {
  const locked = !store.canRead(entry);
  const cover = coverFor(entry, store);
  const kind = kindOf(entry);
  const creator = entry.creator;
  const frame = cover.state === 'preview' ? ' is-preview' : cover.state === 'preset' ? ' is-preset' : '';
  const meta = [entry.format, entrySize(entry)].filter(Boolean).join(' · ');
  const draft = entry.status === 'draft';
  return html`<article class="entry-card kind-${kind}${compact ? ' is-compact' : ''}${locked ? ' is-locked' : ''}" data-entry="${entry.id}">
    <a class="entry-cover${frame}" href="${paths.entry(entry.id)}" tabindex="-1" aria-hidden="true"><img src="${cover.src}" alt="" loading="lazy" decoding="async"${cover.hydrate && html` data-cover="${entry.id}"`}${cover.hydrate && cover.state === 'media' && raw(' data-cover-ready="1"')}>${kindBadge(entry)}${locked && html`<span class="lock-badge">${icon('lock', 11)}<span>${tierName(entry.access)}</span></span>`}</a>
    <div class="entry-details">
      ${meta && html`<p class="eyebrow entry-meta">${meta}</p>`}
      <h3 class="entry-title"><a href="${paths.entry(entry.id)}">${entry.title}</a></h3>
      ${!compact && entry.excerpt && html`<p class="entry-excerpt">${entry.excerpt}</p>`}
      <div class="entry-card-footer">
        <div class="entry-byline">${showCreator && creator?.slug && html`<a class="entry-author" href="${paths.creator(creator.slug)}">${avatar(creator, { size: 22 })}<span>${creator.name}</span></a>`}<span class="entry-date">${draft ? 'Draft' : timeAgo(entry.publishedAt || entry.date || entry.createdAt)}</span></div>
        ${!compact && !draft && html`<div class="entry-actions">${likeButton(entry)}${saveButton(entry)}</div>`}
      </div>
    </div>
  </article>`;
}

export function creatorCard(creator) {
  const href = paths.creator(creator.slug);
  const line = [creator.category, creator.location].filter(Boolean).join(' · ');
  return html`<article class="creator-card" data-creator="${creator.id}">
    <a class="creator-cover${creator.coverUrl ? '' : ' is-preset'}" href="${href}" tabindex="-1" aria-hidden="true"><img src="${creator.coverUrl || presetUrl(creator.image)}" alt="" loading="lazy" decoding="async"></a>
    <div class="creator-details">
      <div class="creator-head">${avatar(creator, { size: 44 })}<div class="creator-names"><h3><a href="${href}">${creator.name}</a></h3>${line && html`<p class="eyebrow muted">${line}</p>`}</div>${creator.isShowcase && badge('Showcase', 'accent')}</div>
      ${(creator.descriptor || creator.bio) && html`<p class="creator-bio">${creator.descriptor || creator.bio}</p>`}
      <div class="creator-foot"><span class="muted">${plural(creator.followerCount, 'follower')}</span>${followButton(creator.id)}</div>
    </div>
  </article>`;
}

// One tier of a creator's circle. `action` is markup (a button) or {label, href, attrs, variant}.
export function tierCard(tier, { current = false, selected = false, action } = {}) {
  const closed = tier.enabled === false;
  return html`<article class="tier-card${selected ? ' is-selected' : ''}${current ? ' is-current' : ''}${closed ? ' is-closed' : ''}" data-tier="${tier.id}">
    <div class="tier-head"><h3>${tier.name}</h3>${current && badge('Your tier', 'ink')}${closed && badge('Closed')}</div>
    <p class="tier-price"><strong>${money(tier.priceCents, tier.currency)}</strong> <span class="muted">/ month</span></p>
    ${tier.description && html`<p class="tier-description">${tier.description}</p>`}
    ${tier.perks?.length > 0 && html`<ul class="tier-perks">${tier.perks.map(perk => html`<li>${icon('check', 14)}<span>${perk}</span></li>`)}</ul>`}
    ${action && html`<div class="tier-action">${renderAction(action)}</div>`}
  </article>`;
}
