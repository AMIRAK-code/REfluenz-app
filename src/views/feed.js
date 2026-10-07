// Home (/app): the newest work from the creators you follow, or from everyone, with a rail for your circle.
//
// Signed in: a "Following" feed (the viewer's follows and memberships) and an "Everything" feed, a post-type filter and
// category chips. Guests see the latest from everyone and a way in. The first post of a list leads. Filters change the
// list in place and are kept in the address (?tab=all&kind=image&category=Design), so a link can be shared.

import { avatar, button, creatorCard, debounce, delegate, emptyState, entryCard, followButton, html, icon, setBusy, toast } from '../core/ui.js';
import { paths, withQuery } from '../core/paths.js';
import { KINDS } from '../core/constants.js';
import { plural, timeAgo } from '../core/format.js';
import { createPager } from './feed/pager.js';
import { CATEGORIES, KIND_LABELS, PAGE_SIZE, circleIds, clip, firstName, pick, replaceUrl } from './feed/shared.js';

const RAIL_CIRCLE = 6; // creators listed in "Your circle"
const NOTE_SOURCES = 4; // ateliers whose circle notes are read
const NOTES_SHOWN = 3;
const SUGGESTIONS = 6;

// --- Data ----------------------------------------------------------------------

function readView(query, signedIn) {
  return {
    tab: signedIn && query.tab !== 'all' ? 'following' : 'all',
    kind: pick(query.kind, KINDS),
    category: pick(query.category, CATEGORIES)
  };
}

// One page of the feed for the current tab and filters. Nobody to follow: nothing to ask for.
async function fetchFeedPage(api, store, view, cursor) {
  const args = { scope: view.tab === 'following' ? 'following' : 'all', limit: PAGE_SIZE };
  if (view.category) args.category = view.category;
  if (view.kind) args.kind = view.kind;
  if (cursor) args.cursor = cursor;
  if (args.scope === 'following') {
    const ids = circleIds(store);
    if (!ids.length) return { items: [], nextCursor: null };
    args.creatorIds = ids;
  }
  return api.feed(args);
}

// The viewer's circle for the rail: who is in it and what they said lately. Never throws: the rail is decoration.
async function loadRail(api, store) {
  const { following, memberships } = store.state;
  const ids = circleIds(store);
  if (!ids.length) return { creators: [], total: 0, notes: [] };
  const order = [...memberships.keys(), ...[...following].filter(id => !memberships.has(id))].slice(0, RAIL_CIRCLE);
  const creators = (await Promise.all(order.map(id => memberships.get(id)?.creator ?? api.getCreator(id).catch(() => null)))).filter(Boolean);
  const notes = (await Promise.all(creators.slice(0, NOTE_SOURCES).map(creator =>
    api.listNotes(creator.id).then(list => list.slice(0, 1).map(note => ({ ...note, creator }))).catch(() => []))))
    .flat()
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, NOTES_SHOWN);
  return { creators, total: ids.length, notes };
}

// --- Markup --------------------------------------------------------------------

const listHeading = (view, signedIn) => (view.tab === 'following' ? 'From your circle' : signedIn ? 'Everything, newest first' : 'Latest posts');

function controls(view, signedIn) {
  const on = (current, value) => (current === value ? ' is-active' : '');
  const tab = (id, label) => html`<button type="button" class="tab${on(view.tab, id)}" data-feed-tab="${id}" aria-pressed="${String(view.tab === id)}">${label}</button>`;
  return html`<div class="feed-controls">
    ${signedIn && html`<div class="tabs feed-tabs" role="group" aria-label="Feed">${tab('following', 'Following')}${tab('all', 'Everything')}</div>`}
    <div class="feed-filters">
      <div class="seg" role="group" aria-label="Post type">${['', ...KINDS].map(kind => html`<button type="button" class="seg-button${on(view.kind, kind)}" data-feed-kind="${kind}" aria-pressed="${String(view.kind === kind)}">${kind ? KIND_LABELS[kind] : 'All'}</button>`)}</div>
      <div class="chips" role="group" aria-label="Category">${['', ...CATEGORIES].map(category => html`<button type="button" class="chip${on(view.category, category)}" data-feed-category="${category}" aria-pressed="${String(view.category === category)}">${category || 'All topics'}</button>`)}</div>
    </div>
  </div>`;
}

const welcomeCard = () => html`<section class="welcome-card" data-welcome aria-labelledby="welcome-title">
  <div class="welcome-text">
    <p class="eyebrow bronze">Welcome</p>
    <h2 id="welcome-title">Make this space yours.</h2>
    <p>Follow a few creators, save what you want to keep and join a circle when you are ready. Joining is free during early access.</p>
    <div class="row">${button('Find creators', { href: paths.discover(), size: 'small' })}<a class="text-link" href="${paths.settings()}">Complete your profile</a></div>
  </div>
  <button type="button" class="icon-button" data-dismiss-welcome aria-label="Dismiss the welcome message">${icon('close', 16)}</button>
</section>`;

const joinCard = () => html`<section class="join-card" aria-labelledby="join-title">
  <div>
    <p class="eyebrow bronze">Free during early access</p>
    <h2 id="join-title">Follow the people whose work you want to read.</h2>
    <p>Create a free account to follow creators, save posts to your library and join their circles. Nothing is charged while payments are not live.</p>
  </div>
  <div class="row">${button('Join free', { href: paths.signup() })}${button('Sign in', { variant: 'secondary', href: paths.login() })}</div>
</section>`;

const railPerson = (creator, { line, action }) => html`<li class="rail-person">
  ${avatar(creator, { size: 40 })}
  <div class="rail-person-text"><a class="rail-person-name" href="${paths.creator(creator.slug)}">${creator.name}</a>${line && html`<p class="eyebrow muted">${line}</p>`}</div>
  ${action}
</li>`;

function railMarkup(rail, suggested, { signedIn, memberships }) {
  const circleSection = signedIn && html`<section class="rail-section" aria-labelledby="rail-circle-title">
    <div class="section-head"><h2 id="rail-circle-title">Your circle</h2><span class="muted count">${rail.total}</span></div>
    ${rail.creators.length
      ? html`<ul class="rail-list">${rail.creators.map(creator => {
        const tier = memberships.get(creator.id)?.tier;
        return railPerson(creator, { line: tier ? `${tier.name} circle` : creator.descriptor || creator.category });
      })}</ul>${rail.total > rail.creators.length && html`<p class="rail-more muted">and ${plural(rail.total - rail.creators.length, 'more creator')}</p>`}`
      : html`<p class="rail-empty muted">Follow a creator to start your circle.</p>`}
    <a class="text-link" href="${paths.discover()}">Discover a new voice ${icon('plus', 12)}</a>
  </section>`;
  const notesSection = rail.notes.length > 0 && html`<section class="rail-section" aria-labelledby="rail-notes-title">
    <div class="section-head"><h2 id="rail-notes-title">Circle notes</h2></div>
    <ul class="rail-notes">${rail.notes.map(note => html`<li class="rail-note">
      <p class="rail-note-text">“${clip(note.text, 140)}”</p>
      <p class="eyebrow muted"><a href="${paths.creator(note.creator.slug)}">${note.creator.name}</a> · ${timeAgo(note.date)}</p>
    </li>`)}</ul>
  </section>`;
  const suggestedSection = suggested.length > 0 && html`<section class="rail-section" aria-labelledby="rail-suggested-title" data-rail-suggested>
    <div class="section-head"><h2 id="rail-suggested-title">Suggested creators</h2></div>
    <ul class="rail-list">${suggested.slice(0, 4).map(creator => railPerson(creator, {
      line: [creator.category, plural(creator.followerCount, 'follower')].filter(Boolean).join(' · '),
      action: followButton(creator.id)
    }))}</ul>
    <a class="text-link" href="${paths.discover()}">Browse all creators ${icon('arrow', 12)}</a>
  </section>`;
  return html`${circleSection}${notesSection}${suggestedSection}<p class="rail-footer muted">No ads. No algorithm.<br>Just the people you choose.</p>`;
}

// --- View ----------------------------------------------------------------------

export default {
  title: 'Home',
  auth: 'optional',

  async load(ctx) {
    const { api, store } = ctx;
    const signedIn = Boolean(store.state.user);
    const view = readView(ctx.query, signedIn);
    const [page, suggested, rail] = await Promise.all([
      fetchFeedPage(api, store, view, null),
      api.suggestedCreators(SUGGESTIONS).catch(() => []),
      signedIn ? loadRail(api, store) : { creators: [], total: 0, notes: [] }
    ]);
    return { view, page, suggested, rail };
  },

  render(ctx, data) {
    const { state } = ctx.store;
    const signedIn = Boolean(state.user);
    const name = firstName(state.profile?.name);
    return html`<section class="page feed-page">
      <header class="page-head">
        <div>
          <p class="eyebrow muted">${signedIn ? 'Home' : 'Latest from everyone'}</p>
          <h1 id="feed-title" tabindex="-1">${signedIn ? `Welcome back${name ? `, ${name}` : ''}.` : 'Work worth slowing down for.'}</h1>
          <p class="page-sub">${signedIn
            ? 'The newest work from the creators you follow, and everything else when you want to wander.'
            : 'Public posts from independent creators, newest first. Browse freely, and create a free account to follow, save and join circles.'}</p>
        </div>
      </header>
      ${signedIn && !state.settings.welcomeDismissed && welcomeCard()}
      ${!signedIn && joinCard()}
      <div class="feed-layout">
        <div class="feed-main">
          ${controls(data.view, signedIn)}
          <div class="feed-notice" role="status" data-feed-notice hidden><span data-notice-text></span> <button type="button" class="text-button" data-feed-refresh>Refresh the feed</button></div>
          <div class="section-head feed-list-head"><h2 data-feed-heading>${listHeading(data.view, signedIn)}</h2></div>
          <p class="visually-hidden" role="status" data-feed-status></p>
          <div class="feed-list" data-feed-list></div>
        </div>
        <aside class="feed-rail" aria-label="Your circle and suggestions" data-rail>${railMarkup(data.rail, data.suggested, { signedIn, memberships: state.memberships })}</aside>
      </div>
    </section>`;
  },

  mount(el, ctx, data) {
    const { api, store } = ctx;
    const signedIn = Boolean(store.state.user);
    const { view } = data;
    const host = el.querySelector('[data-feed-list]');
    const status = el.querySelector('[data-feed-status]');
    const notice = el.querySelector('[data-feed-notice]');
    const rail = el.querySelector('[data-rail]');
    let alive = true;
    let railTicket = 0;
    let circleKey = circleIds(store).sort().join();

    const filtered = () => Boolean(view.kind || view.category);
    const showsSuggestions = () => view.tab === 'following' && !filtered();

    const emptyFeed = () => {
      if (filtered()) {
        return emptyState({ icon: 'filter', title: 'Nothing matches these filters', text: 'Try another type or topic, or clear the filters to see everything.', action: button('Clear filters', { variant: 'secondary', attrs: { 'data-feed-clear': true } }) });
      }
      if (view.tab === 'following') {
        const lonely = circleIds(store).length === 0;
        const suggestions = data.suggested.length > 0 && html`<div class="section feed-suggest"><div class="section-head"><h2>Creators to follow</h2></div><div class="grid-creators">${data.suggested.map(creatorCard)}</div></div>`;
        return html`${emptyState({
          icon: 'members',
          title: lonely ? 'Your circle is empty' : 'Nothing new from your circle yet',
          text: lonely
            ? 'Follow creators and their new posts will gather here, newest first. Start with a few of these.'
            : 'When the creators you follow publish, their posts will appear here. Meanwhile, browse everything or find someone new.',
          action: lonely ? { label: 'Discover creators', href: paths.discover() } : button('Browse everything', { variant: 'secondary', attrs: { 'data-feed-tab': 'all' } })
        })}${suggestions}`;
      }
      return emptyState({ icon: 'grid', title: 'No posts yet', text: 'New posts from every atelier will appear here as they are published.', action: { label: 'Discover creators', href: paths.discover() } });
    };

    const syncRailSuggestions = () => {
      const section = rail.querySelector('[data-rail-suggested]');
      if (section) section.hidden = showsSuggestions() && data.suggested.length > 0 && pager.items.length === 0;
    };

    const pager = createPager({
      host,
      api,
      store,
      fetchPage: cursor => fetchFeedPage(api, store, view, cursor),
      renderItem: entry => entryCard(entry),
      renderLead: entry => entryCard(entry),
      renderEmpty: emptyFeed,
      onChange({ reason, count, done, empty }) {
        if (reason === 'show' || reason === 'error') {
          status.textContent = reason === 'error' ? 'The feed could not be loaded.' : empty ? 'No posts to show.' : `Showing ${plural(count, 'post')}${done ? '' : ', more available'}.`;
        }
        syncRailSuggestions();
      }
    });
    pager.show(data.page);

    // --- Filters ---------------------------------------------------------------

    const syncControls = () => {
      for (const control of el.querySelectorAll('[data-feed-tab], [data-feed-kind], [data-feed-category]')) {
        if (!control.matches('.tab, .seg-button, .chip')) continue; // the empty state's buttons keep their look
        const value = control.dataset.feedTab ?? control.dataset.feedKind ?? control.dataset.feedCategory;
        const key = control.hasAttribute('data-feed-tab') ? 'tab' : control.hasAttribute('data-feed-kind') ? 'kind' : 'category';
        const on = view[key] === value;
        control.classList.toggle('is-active', on);
        control.setAttribute('aria-pressed', String(on));
      }
      el.querySelector('[data-feed-heading]').textContent = listHeading(view, signedIn);
    };

    const hideNotice = () => { notice.hidden = true; };
    const showNotice = message => {
      notice.querySelector('[data-notice-text]').textContent = message;
      notice.hidden = false;
    };

    function setView(patch) {
      const next = { ...view, ...patch };
      if (!signedIn) next.tab = 'all';
      if (next.tab === view.tab && next.kind === view.kind && next.category === view.category) return;
      Object.assign(view, next);
      syncControls();
      replaceUrl(withQuery(paths.home, { tab: signedIn && view.tab === 'all' ? 'all' : '', kind: view.kind, category: view.category }));
      hideNotice();
      pager.reset();
    }

    // --- The rail --------------------------------------------------------------

    const paintRail = () => {
      rail.innerHTML = railMarkup(data.rail, data.suggested, { signedIn, memberships: store.state.memberships }).value;
      syncRailSuggestions();
    };

    // The circle or its notes changed: read them again, a moment later so that several changes are one request.
    const refreshRail = debounce(async () => {
      if (!signedIn) return;
      const ticket = ++railTicket;
      const next = await loadRail(api, store);
      if (!alive || ticket !== railTicket) return;
      data.rail = next;
      paintRail();
    }, 400);

    // --- Welcome ---------------------------------------------------------------

    async function dismissWelcome(control) {
      setBusy(control, true);
      try {
        const settings = await api.saveSettings({ welcomeDismissed: true });
        store.update({ settings });
        if (!alive) return;
        el.querySelector('[data-welcome]')?.remove();
        el.querySelector('#feed-title')?.focus();
      } catch (error) {
        toast(error?.message || 'We could not save that. Try again.', { tone: 'error' });
        setBusy(control, false);
      }
    }

    const stops = [
      delegate(el, 'click', '[data-feed-tab]', (event, control) => { event.preventDefault(); setView({ tab: control.dataset.feedTab }); }),
      delegate(el, 'click', '[data-feed-kind]', (event, control) => { event.preventDefault(); setView({ kind: control.dataset.feedKind }); }),
      delegate(el, 'click', '[data-feed-category]', (event, control) => { event.preventDefault(); setView({ category: control.dataset.feedCategory }); }),
      delegate(el, 'click', '[data-feed-clear]', event => { event.preventDefault(); setView({ kind: '', category: '' }); }),
      delegate(el, 'click', '[data-feed-refresh]', event => {
        event.preventDefault();
        hideNotice();
        pager.reset();
        refreshRail();
      }),
      delegate(el, 'click', '[data-dismiss-welcome]', (event, control) => { event.preventDefault(); dismissWelcome(control); }),
      // Following or joining someone changes the circle: the rail follows, and the feed offers to catch up.
      store.subscribe(() => {
        const key = circleIds(store).sort().join();
        if (key === circleKey) return;
        circleKey = key;
        refreshRail();
        if (view.tab === 'following') showNotice('Your circle has changed.');
      }),
      store.onRealtime(event => {
        const type = event.type === 'notification' ? event.payload?.type : '';
        if (type === 'new_entry') showNotice('There are new posts from your circle.');
        else if (type === 'note') refreshRail();
      })
    ];

    return () => {
      alive = false;
      refreshRail.cancel();
      pager.destroy();
      stops.forEach(stop => stop());
    };
  }
};
