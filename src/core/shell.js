// The application shell (docs/ARCHITECTURE.md 5.6): sidebar, topbar, mobile bar, menus, badges and the listeners that
// serve the whole page (follow / save / like buttons, sign-out, search, new messages).
//
// The chrome is drawn again only when something it shows changes (account, name, picture, atelier). The active link,
// the unread badges, the sign-in links and the search box are patched in place, so a menu that is open, or text that
// is being typed, survives a route change or a realtime update.

import { avatar, delegate, html, icon, likeSubject, raw, syncToggles, toast } from './ui.js';
import { store as defaultStore } from './store.js';
import { KINDS } from './constants.js';
import { paths, safeNext } from './paths.js';

const KIND_ICON = { text: 'text', image: 'image', video: 'video' };
const KIND_LABEL = { text: 'Text', image: 'Image', video: 'Video' };

const badgeText = count => (count > 99 ? '99+' : String(count));

// --- Markup -------------------------------------------------------------------

function badgeFor(kind, count) {
  return html`<span class="nav-count" data-badge="${kind}"${count > 0 ? '' : raw(' hidden')}>${badgeText(count)}</span>`;
}

function navItem({ label, glyph, href, exact = false, badge }, counts) {
  return html`<li><a class="nav-link" href="${href}" data-nav="${href.split('?')[0]}"${exact ? raw(' data-exact') : ''}>${icon(glyph, 18)}<span class="nav-label">${label}</span>${badge && badgeFor(badge, counts[badge])}</a></li>`;
}

function menu({ id, trigger, label, panel, className = '' }) {
  return html`<div class="menu ${className}" data-menu>
    <button type="button" class="${trigger.className}" data-menu-trigger aria-haspopup="menu" aria-expanded="false" aria-controls="${id}"${label && html` aria-label="${label}"`}>${trigger.content}</button>
    <div class="menu-panel" id="${id}" role="menu" hidden>${panel}</div>
  </div>`;
}

function newPostMenu(id, trigger, className) {
  const panel = KINDS.map(kind => html`<a class="menu-item" role="menuitem" href="${paths.studioNew({ kind })}">${icon(KIND_ICON[kind], 16)}<span>${KIND_LABEL[kind]} post</span></a>`);
  return menu({ id, trigger, className, label: trigger.label, panel });
}

function accountMenu(model) {
  const person = { name: model.name, avatarUrl: model.avatarUrl };
  const panel = html`<div class="menu-heading" role="presentation"><strong>${model.name}</strong><span class="muted">${model.email}</span></div>
    <a class="menu-item" role="menuitem" href="${paths.settings()}">${icon('settings', 16)}<span>Settings</span></a>
    ${model.creator
      ? html`<a class="menu-item" role="menuitem" href="${paths.creator(model.creator.slug)}">${icon('user', 16)}<span>My atelier</span></a><a class="menu-item" role="menuitem" href="${paths.studio()}">${icon('studio', 16)}<span>Studio</span></a>`
      : html`<a class="menu-item" role="menuitem" href="${paths.studio()}">${icon('studio', 16)}<span>Open your atelier</span></a>`}
    <a class="menu-item" role="menuitem" href="${paths.memberships}">${icon('members', 16)}<span>Memberships</span></a>
    <button type="button" class="menu-item" role="menuitem" data-action="sign-out">${icon('logout', 16)}<span>Sign out</span></button>`;
  return menu({ id: 'menu-account', label: 'Account menu', className: 'account-menu', trigger: { className: 'avatar-button', content: avatar(person, { size: 36 }) }, panel });
}

function sidebar(model, counts) {
  const items = model.signedIn
    ? [
      { label: 'Home', glyph: 'grid', href: paths.home, exact: true },
      { label: 'Discover', glyph: 'compass', href: paths.discover() },
      { label: 'Library', glyph: 'bookmark', href: paths.library },
      { label: 'Messages', glyph: 'message', href: paths.messages(), badge: 'messages' },
      { label: 'Notifications', glyph: 'bell', href: paths.notifications, badge: 'notifications' },
      { label: 'Memberships', glyph: 'members', href: paths.memberships },
      { label: model.creator ? 'Studio' : 'Open your atelier', glyph: 'studio', href: paths.studio() },
      { label: 'Settings', glyph: 'settings', href: paths.settings() }
    ]
    : [
      { label: 'Home', glyph: 'grid', href: paths.home, exact: true },
      { label: 'Discover', glyph: 'compass', href: paths.discover() }
    ];
  const bottom = model.signedIn
    ? html`<a class="profile-link" href="${paths.settings()}">${avatar({ name: model.name, avatarUrl: model.avatarUrl }, { size: 36 })}<span class="profile-text"><strong>${model.name}</strong><small>${model.email}</small></span></a>`
    : html`<div class="sidebar-join"><p class="eyebrow">Join REFLUENZ</p><p>Follow creators, save work and join circles. Free while we are in early access.</p><a class="button small" href="${paths.signup()}" data-next-link="signup">Join free</a><a class="text-link" href="${paths.login()}" data-next-link="login">Sign in</a></div>`;
  return html`<a class="wordmark sidebar-wordmark" href="${paths.home}" aria-label="REFLUENZ, home">REFLUENZ</a>
    <p class="eyebrow muted sidebar-caption">The digital atelier</p>
    ${model.creator && newPostMenu('menu-new-sidebar', { className: 'button new-post-button', content: html`${icon('plus', 16)}<span class="nav-label">New post</span>` }, 'new-post')}
    <nav aria-label="Main"><ul class="side-nav">${items.map(item => navItem(item, counts))}</ul></nav>
    <div class="sidebar-bottom">${bottom}</div>`;
}

function topbar(model, counts) {
  const actions = model.signedIn
    ? html`<a class="icon-button bell-link" href="${paths.notifications}" data-nav="${paths.notifications}" data-badge-host="notifications" data-label="Notifications" aria-label="Notifications">${icon('bell', 20)}${badgeFor('notifications', counts.notifications)}</a>${accountMenu(model)}`
    : html`<a class="button secondary small" href="${paths.login()}" data-next-link="login">Sign in</a><a class="button small" href="${paths.signup()}" data-next-link="signup">Join free</a>`;
  return html`<a class="wordmark topbar-wordmark" href="${paths.home}" aria-label="REFLUENZ, home">REFLUENZ</a>
    <form class="search" role="search" action="${paths.discover()}" method="get" data-search>
      <label class="visually-hidden" for="shell-search">Search REFLUENZ</label>
      ${icon('search', 16)}
      <input id="shell-search" type="search" name="q" placeholder="Search creators and posts" autocomplete="off" enterkeyhint="search" maxlength="100">
    </form>
    <div class="topbar-actions">${actions}</div>`;
}

function mobileBar(model, counts) {
  const link = ({ label, glyph, href, exact = false, badge }) => html`<a class="mobile-link" href="${href}" data-nav="${href.split('?')[0]}"${exact ? raw(' data-exact') : ''}>${icon(glyph, 20)}<span>${label}</span>${badge && badgeFor(badge, counts[badge])}</a>`;
  if (!model.signedIn) {
    return html`${link({ label: 'Home', glyph: 'grid', href: paths.home, exact: true })}${link({ label: 'Discover', glyph: 'compass', href: paths.discover() })}<a class="mobile-link" href="${paths.login()}" data-next-link="login">${icon('user', 20)}<span>Sign in</span></a><a class="mobile-link mobile-join" href="${paths.signup()}" data-next-link="signup">${icon('plus', 20)}<span>Join free</span></a>`;
  }
  const middle = model.creator
    ? newPostMenu('menu-new-mobile', { className: 'mobile-link', label: 'New post', content: html`${icon('plus', 20)}<span>New post</span>` }, 'mobile-menu')
    : link({ label: 'Library', glyph: 'bookmark', href: paths.library });
  return html`${link({ label: 'Home', glyph: 'grid', href: paths.home, exact: true })}${link({ label: 'Discover', glyph: 'compass', href: paths.discover() })}${middle}${link({ label: 'Messages', glyph: 'message', href: paths.messages(), badge: 'messages' })}${link({ label: 'You', glyph: 'user', href: paths.settings() })}`;
}

const layout = () => html`<div class="shell">
  <aside class="sidebar" data-shell="sidebar"></aside>
  <div class="shell-body">
    <header class="topbar" data-shell="topbar"></header>
    <main id="main" class="shell-content" tabindex="-1"><div id="view" class="view"></div></main>
  </div>
  <nav class="mobile-bar" data-shell="mobile" aria-label="Mobile"></nav>
  <div id="route-announcer" class="visually-hidden" aria-live="polite" aria-atomic="true"></div>
</div>`;

// --- Shell --------------------------------------------------------------------

export function mountShell({ root, store = defaultStore, api, doc = root.ownerDocument }) {
  root.innerHTML = layout().value;
  const regions = {
    sidebar: root.querySelector('[data-shell="sidebar"]'),
    topbar: root.querySelector('[data-shell="topbar"]'),
    mobile: root.querySelector('[data-shell="mobile"]')
  };
  const renderers = { sidebar, topbar, mobile: mobileBar };
  const signatures = {};
  const removers = [];
  let router = null;
  let where = { path: '/app', query: {}, href: '/app' }; // the page the router is showing

  // --- Chrome ---------------------------------------------------------------------

  function modelOf(state) {
    const user = state.user;
    return {
      signedIn: Boolean(user),
      name: state.profile?.name || user?.email?.split('@')[0] || '',
      email: user?.email || '',
      avatarUrl: state.profile?.avatarUrl || '',
      creator: state.myCreator ? { id: state.myCreator.id, slug: state.myCreator.slug } : null
    };
  }

  function paintChrome() {
    const model = modelOf(store.state);
    const none = { notifications: 0, messages: 0 };
    for (const [name, render] of Object.entries(renderers)) {
      const structure = render(model, none).value;
      if (structure === signatures[name]) continue;
      signatures[name] = structure;
      regions[name].innerHTML = render(model, store.state.unread).value;
      patchLocation(regions[name]);
    }
    patchBadges();
  }

  function patchBadges() {
    const { unread } = store.state;
    for (const badge of root.querySelectorAll('[data-badge]')) {
      const count = unread[badge.dataset.badge] || 0;
      badge.textContent = badgeText(count);
      badge.hidden = count <= 0;
    }
    for (const host of root.querySelectorAll('[data-badge-host]')) {
      const count = unread[host.dataset.badgeHost] || 0;
      host.setAttribute('aria-label', count > 0 ? `${host.dataset.label}, ${count} unread` : host.dataset.label);
    }
  }

  const isActive = (link, path) => {
    const base = link.dataset.nav;
    return link.hasAttribute('data-exact') ? path === base : path === base || path.startsWith(`${base}/`);
  };

  // The parts of the chrome that follow the current URL: the active link, the sign-in links, the search box.
  function patchLocation(scope = root) {
    const { path, query, href } = where;
    for (const link of scope.querySelectorAll('[data-nav]')) {
      const active = isActive(link, path);
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    const next = safeNext(href);
    for (const link of scope.querySelectorAll('[data-next-link]')) {
      link.setAttribute('href', link.dataset.nextLink === 'signup' ? paths.signup(next) : paths.login(next));
    }
    const search = scope.querySelector('#shell-search');
    if (search) search.value = path === '/app/discover' ? query.q ?? '' : '';
  }

  // --- Menus ----------------------------------------------------------------------

  const menus = () => [...root.querySelectorAll('[data-menu]')];
  const triggerOf = menuEl => menuEl.querySelector('[data-menu-trigger]');
  const panelOf = menuEl => menuEl.querySelector('.menu-panel');
  const itemsOf = menuEl => [...panelOf(menuEl).querySelectorAll('[role="menuitem"]')];
  const isOpen = menuEl => !panelOf(menuEl).hidden;

  function openMenu(menuEl) {
    closeMenus(menuEl);
    panelOf(menuEl).hidden = false;
    triggerOf(menuEl).setAttribute('aria-expanded', 'true');
    itemsOf(menuEl)[0]?.focus();
  }

  function closeMenu(menuEl, { restoreFocus = false } = {}) {
    if (!isOpen(menuEl)) return;
    panelOf(menuEl).hidden = true;
    triggerOf(menuEl).setAttribute('aria-expanded', 'false');
    if (restoreFocus) triggerOf(menuEl).focus();
  }

  function closeMenus(except, options) {
    for (const menuEl of menus()) if (menuEl !== except) closeMenu(menuEl, options);
  }

  function onMenuKey(event) {
    const open = menus().find(isOpen);
    const owner = event.target.closest?.('[data-menu]');
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeMenu(open, { restoreFocus: true });
      return;
    }
    if (!owner) return;
    const list = itemsOf(owner);
    const at = list.indexOf(doc.activeElement);
    const move = index => { event.preventDefault(); list[(index + list.length) % list.length]?.focus(); };
    if (event.target === triggerOf(owner) && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      openMenu(owner);
    } else if (isOpen(owner) && event.key === 'ArrowDown') move(at + 1);
    else if (isOpen(owner) && event.key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
    else if (isOpen(owner) && event.key === 'Home') move(0);
    else if (isOpen(owner) && event.key === 'End') move(-1);
  }

  // --- Listeners --------------------------------------------------------------------

  function on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  }

  async function signOut(button) {
    button.disabled = true;
    try {
      await api.signOut();
    } catch (error) {
      toast(error?.message || 'We could not sign you out. Try again.', { tone: 'error' });
      button.disabled = false;
      return;
    }
    store.signOutLocal();
    router?.navigate(paths.home);
  }

  function newMessage({ creatorId, memberId, from, text }) {
    const state = store.state;
    const mine = from === 'member' ? memberId === state.user?.id : state.myCreator?.id === creatorId;
    if (mine || where.path === paths.messages(creatorId, memberId)) return;
    const preview = String(text || '').trim();
    toast(preview ? `New message: ${preview.length > 70 ? `${preview.slice(0, 67)}…` : preview}` : 'You have a new message.');
  }

  function wire() {
    removers.push(
      delegate(doc, 'click', '[data-follow]', (event, control) => { event.preventDefault(); store.toggleFollow(control.dataset.follow); }),
      delegate(doc, 'click', '[data-save]', (event, control) => { event.preventDefault(); store.toggleSave(control.dataset.save); }),
      delegate(doc, 'click', '[data-like]', (event, control) => { event.preventDefault(); store.toggleLike(likeSubject(control.dataset.like) ?? { id: control.dataset.like }); }),
      delegate(doc, 'click', '[data-action="sign-out"]', (event, control) => { event.preventDefault(); closeMenus(); signOut(control); }),
      delegate(doc, 'click', '.skip-link', event => { event.preventDefault(); doc.getElementById('main')?.focus(); }),
      delegate(root, 'click', '[data-menu-trigger]', (event, trigger) => {
        event.preventDefault();
        const owner = trigger.closest('[data-menu]');
        if (isOpen(owner)) closeMenu(owner); else openMenu(owner);
      }),
      delegate(root, 'click', '.menu-item', () => closeMenus()),
      delegate(root, 'submit', '[data-search]', (event, form) => {
        event.preventDefault();
        const q = form.querySelector('input[name="q"]').value.trim();
        router?.navigate(paths.discover({ q }));
      }),
      delegate(root, 'focusout', '[data-menu]', (event, owner) => {
        if (!owner.contains(event.relatedTarget)) closeMenu(owner);
      }),
      store.subscribe(() => { paintChrome(); syncToggles(doc); }),
      store.onRealtime(event => { if (event.type === 'message' && event.payload) newMessage(event.payload); })
    );
    on(doc, 'click', event => { if (!event.target.closest?.('[data-menu]')) closeMenus(); });
    on(doc, 'keydown', onMenuKey);
  }

  paintChrome();
  wire();

  return {
    outlet: root.querySelector('#view'),
    announcer: root.querySelector('#route-announcer'),
    // The shell follows the router: active link, sign-in links and search box.
    attach(nextRouter) {
      router = nextRouter;
      const follow = current => {
        if (!current) return;
        where = { path: current.path, query: current.query || {}, href: current.href };
        patchLocation();
        closeMenus();
        syncToggles(doc);
      };
      removers.push(router.onChange(follow));
      follow(router.current);
    },
    destroy() {
      removers.splice(0).forEach(remove => remove());
      root.innerHTML = '';
    }
  };
}
