// The atelier page: /app/c/:slug (docs/ARCHITECTURE.md section 3).
//
// A banner and header (who the atelier is, how big its circle is, what you can do), then three tabs:
//   Posts       the atelier's published work, filtered by kind, paged with "Load more" and infinite scroll; locks follow store.canRead
//   Membership  the open tiers, with join / switch / leave
//   About       the facts about the atelier
// `?join=1` opens the join dialog (locked posts elsewhere link here), `?tab=membership|about` opens a tab.
//
// The page never redraws as a whole after it is mounted: each region (actions, counts, tiers, posts) is painted on its own, so a
// focused button or a loaded page of posts survives a follow, a join or a leave. Follower and member counts are derived from the
// store (the number the server gave, with the viewer's own follow / membership swapped for what the store says now).

import {
  avatar, badge, button, confirmDialog, delegate, emptyState, entryCard, followButton, html, icon, infiniteScroll, modal, raw, safeUrl, setBusy, skeleton, tierCard, toast
} from '../core/ui.js';
import { hydrateCovers } from '../core/covers.js';
import { compactNumber, formatDate, money, plural } from '../core/format.js';
import { paths } from '../core/paths.js';
import { TIER_NAMES, presetUrl } from '../core/constants.js';
import { REPORT_REASONS } from '../api/util.js';

const PAGE_SIZE = 12;
const TAB_IDS = ['posts', 'membership', 'about'];
const TAB_LABELS = { posts: 'Posts', membership: 'Membership', about: 'About' };
const KIND_FILTERS = [['', 'All'], ['text', 'Text'], ['image', 'Images'], ['video', 'Video']];
const REASON_LABELS = {
  spam: 'Spam or misleading', harassment: 'Harassment or hate', nudity: 'Nudity or sexual content',
  violence: 'Violence or dangerous content', copyright: 'Copyright', other: 'Something else'
};
const EARLY_ACCESS = 'Free during early access. Prices apply once payments launch.';

// Programming errors say nothing a person can use; the api's friendly messages are shown as they are.
const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError, RangeError];
const messageOf = (error, fallback) => (PROGRAMMING_ERRORS.some(type => error instanceof type) ? fallback : error?.message || fallback);

// --- What the viewer is to this atelier ---------------------------------------------

const isOwner = (ctx, creator) => Boolean(ctx.store.state.myCreator && ctx.store.state.myCreator.id === creator.id);
const heldBy = (ctx, creator) => ctx.store.state.memberships.get(creator.id) || null;
const tierNameOf = (data, membership) => data.tiers.find(tier => tier.id === membership?.tierId)?.name || membership?.tier?.name || TIER_NAMES[membership?.tierId] || 'Member';
// Tiers people can choose, and the one they hold even when the creator has closed it since.
const shownTiers = (data, held) => data.tiers.filter(tier => tier.enabled || tier.id === held?.tierId);
const joinableTiers = data => data.tiers.filter(tier => tier.enabled);

function countsOf(ctx, data) {
  const { creator } = data;
  const { following, memberships } = ctx.store.state;
  return {
    followers: Math.max(0, creator.followerCount - data.followedAtLoad + (following.has(creator.id) ? 1 : 0)),
    members: Math.max(0, creator.memberCount - data.memberAtLoad + (memberships.has(creator.id) ? 1 : 0)),
    posts: creator.entryCount
  };
}

// --- Markup -------------------------------------------------------------------------

function externalLinks(creator) {
  const links = [];
  for (const link of creator.links || []) {
    const url = safeUrl(link?.url);
    if (!/^(https?:\/\/|mailto:)/i.test(url)) continue;
    let label = String(link.label || '').trim();
    if (!label) {
      let host = '';
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* shown as the address */ }
      label = host || url.replace(/^mailto:/i, '');
    }
    links.push({ url, label, web: /^https?:/i.test(url) });
  }
  return links.slice(0, 8);
}

const linksMarkup = creator => {
  const links = externalLinks(creator);
  if (!links.length) return '';
  return html`<ul class="atelier-links" aria-label="Links">${links.map(link => html`<li><a class="atelier-link" href="${link.url}" rel="noopener noreferrer ugc"${link.web && raw(' target="_blank"')}>${icon('external', 13)}<span>${link.label}</span>${link.web && html`<span class="visually-hidden"> (opens in a new tab)</span>`}</a></li>`)}</ul>`;
};

function statsMarkup(ctx, data) {
  const { followers, members, posts } = countsOf(ctx, data);
  const item = (key, value, one, many) => html`<div class="atelier-stat"><dt>${value === 1 ? one : many}</dt><dd data-stat="${key}">${compactNumber(value)}</dd></div>`;
  return html`${item('followers', followers, 'Follower', 'Followers')}${item('members', members, 'Member', 'Members')}${item('posts', posts, 'Post', 'Posts')}`;
}

function actionsMarkup(ctx, data) {
  const { store } = ctx;
  const { creator } = data;
  const owner = isOwner(ctx, creator);
  const held = heldBy(ctx, creator);
  const canShare = typeof globalThis.navigator?.share === 'function';
  const utility = html`<div class="atelier-utility">
    ${button('Copy link', { variant: 'ghost', size: 'small', icon: 'link', attrs: { 'data-action': 'copy' } })}
    ${canShare && button('Share', { variant: 'ghost', size: 'small', icon: 'external', attrs: { 'data-action': 'share' } })}
    ${!owner && button('Report', { variant: 'ghost', size: 'small', icon: 'flag', attrs: { 'data-action': 'report' } })}
  </div>`;
  if (owner) {
    return html`<div class="atelier-primary">${button('New post', { href: paths.studioNew(), icon: 'plus' })}${button('Edit atelier', { href: paths.studioSettings(), variant: 'secondary', icon: 'edit' })}</div>
      <p class="atelier-state eyebrow muted">This is your atelier</p>${utility}`;
  }
  let join;
  if (held) join = button('Manage membership', { variant: 'secondary', icon: 'members', attrs: { 'data-action': 'manage' } });
  else if (joinableTiers(data).length) join = button('Join circle', { icon: 'members', attrs: { 'data-action': 'join' } });
  else join = button('Memberships closed', { variant: 'secondary', attrs: { disabled: true } });

  const viewer = store.state.user?.id;
  let message = '';
  if (!creator.isShowcase && creator.ownerId) {
    message = viewer
      ? button('Message', { variant: 'secondary', icon: 'message', href: paths.messages(creator.id, viewer), attrs: { 'data-action': 'message' } })
      : button('Message', { variant: 'secondary', icon: 'message', attrs: { 'data-action': 'message' } });
  }
  const state = held
    ? `Member at ${tierNameOf(data, held)}`
    : joinableTiers(data).length ? 'Joining is free during early access' : 'Memberships are not open right now';
  return html`<div class="atelier-primary">${followButton(creator.id)}${join}${message}</div><p class="atelier-state eyebrow muted">${state}</p>${utility}`;
}

function tierActionOf(data, tier, held) {
  const free = html`<p class="tier-free muted">Free during early access</p>`;
  if (held?.tierId === tier.id) return html`${button('Leave circle', { variant: 'secondary', attrs: { 'data-action': 'leave' } })}${free}`;
  if (!tier.enabled) return null;
  const label = held ? `Switch to ${tier.name}` : `Choose ${tier.name}`;
  return html`${button(label, { attrs: { 'data-action': 'join', 'data-tier': tier.id } })}${free}`;
}

function tiersMarkup(ctx, data) {
  const { creator } = data;
  const owner = isOwner(ctx, creator);
  const held = heldBy(ctx, creator);
  const tiers = shownTiers(data, held);
  let lead;
  if (owner) lead = html`This is how your circle sees your tiers. <a class="text-link" href="${paths.studioSettings({ tab: 'tiers' })}">Edit your tiers</a>`;
  else if (held) lead = `You are in ${creator.name}’s circle at ${tierNameOf(data, held)}. Switch tier or leave whenever you like.`;
  else lead = `Join ${creator.name}’s circle to read members’ posts and take part. Choose the tier that suits you.`;
  if (!tiers.length) {
    return html`<p class="atelier-lead">${lead}</p>${emptyState({ icon: 'members', title: 'Memberships are closed', text: `${creator.name} is not taking new members right now. You can still follow the atelier and read its open posts.` })}`;
  }
  return html`<p class="atelier-lead">${lead}</p>
    <div class="tier-grid">${tiers.map(tier => tierCard(tier, { current: held?.tierId === tier.id, action: owner ? null : tierActionOf(data, tier, held) }))}</div>
    <p class="notice atelier-early">${EARLY_ACCESS} You can leave a circle at any time.</p>`;
}

function aboutMarkup(data) {
  const { creator } = data;
  const open = joinableTiers(data);
  const from = [...open].sort((a, b) => a.priceCents - b.priceCents)[0];
  const facts = [
    ['Category', creator.category],
    ['Based in', creator.location],
    ['Atelier opened', formatDate(creator.createdAt, { year: true })],
    ['Published', plural(creator.entryCount, 'post')],
    ['Membership', from ? `From ${money(from.priceCents, from.currency)} / month. ${EARLY_ACCESS}` : 'Not open right now']
  ].filter(([, value]) => value);
  return html`<dl class="atelier-facts">${facts.map(([label, value]) => html`<div><dt class="eyebrow muted">${label}</dt><dd>${value}</dd></div>`)}</dl>
    ${creator.isShowcase && html`<p class="notice">${creator.name} is a showcase atelier, curated by REFLUENZ to show how an atelier can look. It has no owner, so it cannot receive messages.</p>`}`;
}

function postsPanel(data) {
  return html`<div class="atelier-filters" role="group" aria-label="Show posts of a kind">${KIND_FILTERS.map(([kind, label]) => html`<button type="button" class="filter-button" data-kind="${kind}" aria-pressed="${String(data.kind === kind)}">${label}</button>`)}</div>
    <div data-region="posts-notice"></div>
    <div data-region="posts-body">${skeleton('cards', 3)}</div>
    <div class="atelier-more" data-region="posts-footer"></div>
    <div class="atelier-sentinel" data-region="posts-sentinel" hidden></div>
    <p class="visually-hidden" role="status" data-region="posts-status"></p>`;
}

const tabButton = (name, data) => html`<button type="button" class="tab" role="tab" id="atelier-tab-${name}" aria-controls="atelier-panel-${name}" aria-selected="${String(data.tab === name)}" tabindex="${data.tab === name ? '0' : '-1'}" data-tab="${name}">${TAB_LABELS[name]}</button>`;

function page(ctx, data) {
  const { creator } = data;
  const line = [creator.category, creator.location].filter(Boolean).join(' · ');
  const cover = creator.coverUrl || presetUrl(creator.image);
  const panel = (name, body) => html`<div role="tabpanel" id="atelier-panel-${name}" aria-labelledby="atelier-tab-${name}" data-panel="${name}"${data.tab === name ? '' : raw(' hidden')}>${body}</div>`;
  return html`<section class="page atelier" aria-labelledby="atelier-name" data-creator="${creator.id}">
    <div class="atelier-banner${creator.coverUrl ? '' : ' is-preset'}"><img src="${cover}" alt="" decoding="async"></div>
    <header class="atelier-head">
      <div class="atelier-identity">
        <span class="atelier-avatar">${avatar(creator, { size: 104 })}</span>
        <div class="atelier-names">
          <p class="eyebrow atelier-eyebrow">${line && html`<span>${line}</span>`}${creator.isShowcase && badge('Showcase', 'accent')}</p>
          <h1 id="atelier-name">${creator.name}</h1>
          ${creator.descriptor && html`<p class="atelier-descriptor">${creator.descriptor}</p>`}
        </div>
      </div>
      <div class="atelier-actions" data-region="actions">${actionsMarkup(ctx, data)}</div>
    </header>
    <div class="atelier-intro">
      ${creator.bio && html`<p class="atelier-bio">${creator.bio}</p>`}
      ${linksMarkup(creator)}
      <dl class="atelier-stats" aria-label="Atelier in numbers" data-region="stats">${statsMarkup(ctx, data)}</dl>
    </div>
    <div class="tabs atelier-tabs" role="tablist" aria-label="Atelier sections">${TAB_IDS.map(name => tabButton(name, data))}</div>
    ${panel('posts', postsPanel(data))}
    ${panel('membership', html`<div data-region="tiers">${tiersMarkup(ctx, data)}</div>`)}
    ${panel('about', aboutMarkup(data))}
  </section>`;
}

const missing = () => html`<section class="page atelier-missing">
  <header class="page-head"><div><p class="eyebrow muted">Atelier</p><h1>We could not find that atelier</h1></div></header>
  ${emptyState({ icon: 'search', title: 'Nothing lives at this address', text: 'The address may be mistyped, or the atelier may have been closed. Discover other creators instead.', action: { label: 'Discover creators', href: paths.discover() } })}
</section>`;

// --- The view -----------------------------------------------------------------------

export default {
  title: (ctx, data) => (data?.missing ? 'Atelier not found' : data?.creator?.name || 'Atelier'),
  auth: 'optional',

  async load(ctx) {
    const found = await ctx.api.getCreatorBySlug(ctx.params.slug);
    if (!found?.creator) return { missing: true };
    const { creator } = found;
    const { following, memberships } = ctx.store.state;
    return {
      creator,
      tiers: found.tiers || [],
      tab: TAB_IDS.includes(ctx.query.tab) ? ctx.query.tab : 'posts',
      kind: '',
      followedAtLoad: following.has(creator.id) ? 1 : 0,
      memberAtLoad: memberships.has(creator.id) ? 1 : 0
    };
  },

  render: (ctx, data) => (data.missing ? missing() : page(ctx, data)),

  mount(el, ctx, data) {
    if (data.missing) return undefined;
    const { api, store } = ctx;
    const { creator } = data;
    let disposed = false;
    let stopScroll = () => {};
    const posts = { items: [], cursor: null, loaded: false, loading: false, error: null, started: false, ticket: 0 };
    const region = name => el.querySelector(`[data-region="${name}"]`);

    // --- Posts ---------------------------------------------------------------------

    const cardOf = entry => entryCard(entry, { showCreator: false });
    const hydrate = () => hydrateCovers(region('posts-body'), posts.items, api, store);
    const announce = text => { const status = region('posts-status'); if (status) status.textContent = text; };

    function emptyMarkup() {
      if (data.kind) {
        return emptyState({
          icon: 'search', title: `No ${data.kind} posts yet`, text: `${creator.name} has not published a ${data.kind} post.`,
          action: button('Show all posts', { variant: 'secondary', attrs: { 'data-kind': '' } })
        });
      }
      if (isOwner(ctx, creator)) {
        return emptyState({ icon: 'studio', title: 'Nothing published yet', text: 'Your first post will appear here, open to everyone or for the tier you choose.', action: { label: 'Write a post', href: paths.studioNew() } });
      }
      return emptyState({ icon: 'bookmark', title: 'Nothing published yet', text: `${creator.name} has not shared a post yet. Follow the atelier to hear when the first one arrives.`, action: followButton(creator.id) });
    }

    function paintBody() {
      const body = region('posts-body');
      body.setAttribute('aria-busy', String(posts.loading && posts.items.length === 0));
      if (posts.error && posts.items.length === 0) {
        body.innerHTML = html`<div class="error-state" role="alert"><span class="empty-icon">${icon('alert', 26)}</span><h3>We could not load the posts</h3><p>${messageOf(posts.error, 'Something went wrong. Try again in a moment.')}</p>${button('Retry', { variant: 'secondary', attrs: { 'data-action': 'retry-posts' } })}</div>`.value;
      } else if (!posts.loaded) {
        body.innerHTML = skeleton('cards', 3).value;
      } else if (posts.items.length === 0) {
        body.innerHTML = emptyMarkup().value;
      } else {
        body.innerHTML = html`<div class="grid-cards atelier-grid" data-region="posts-grid">${posts.items.map(cardOf)}</div>`.value;
        hydrate();
      }
    }

    function paintFooter() {
      const footer = region('posts-footer');
      const more = Boolean(posts.cursor);
      region('posts-sentinel').hidden = !more;
      if (posts.items.length === 0) footer.innerHTML = '';
      else if (posts.error) {
        footer.innerHTML = html`<div class="atelier-more-error" role="alert"><p>${messageOf(posts.error, 'We could not load more posts.')}</p>${button('Try again', { variant: 'secondary', attrs: { 'data-action': 'more' } })}</div>`.value;
      } else if (more) {
        footer.innerHTML = button(posts.loading ? 'Loading…' : 'Load more', { variant: 'secondary', attrs: { 'data-action': 'more', disabled: posts.loading || false, 'aria-busy': posts.loading ? 'true' : false } }).value;
      } else footer.innerHTML = '';
    }

    function paintNotice() {
      const notice = region('posts-notice');
      const locked = isOwner(ctx, creator) ? 0 : posts.items.filter(entry => !store.canRead(entry)).length;
      if (!locked) { notice.innerHTML = ''; return; }
      const held = heldBy(ctx, creator);
      const text = `${plural(locked, 'post')} here ${locked === 1 ? 'is' : 'are'} for ${held ? 'members at a higher tier' : 'circle members'}. Joining is free during early access.`;
      notice.innerHTML = html`<div class="notice atelier-lock-note"><p>${text}</p>${button(held ? 'See tiers' : 'Join the circle', { variant: 'secondary', size: 'small', attrs: { 'data-action': held ? 'manage' : 'join' } })}</div>`.value;
    }

    // Resolves true while more pages may exist. A failure is recorded, painted and thrown (infiniteScroll stops on a throw).
    async function load({ reset = false } = {}) {
      if (!reset && (posts.loading || !posts.cursor)) return Boolean(posts.cursor);
      const recovered = !reset && Boolean(posts.error);
      const ticket = reset ? ++posts.ticket : posts.ticket;
      if (reset) {
        stopScroll();
        stopScroll = () => {};
        posts.items = [];
        posts.cursor = null;
        posts.loaded = false;
      }
      posts.loading = true;
      posts.error = null;
      if (reset) paintBody();
      paintFooter();
      try {
        const page = await api.creatorEntries(creator.id, { kind: data.kind || undefined, cursor: reset ? undefined : posts.cursor, limit: PAGE_SIZE });
        if (disposed || ticket !== posts.ticket) return false;
        const known = new Set(posts.items.map(entry => entry.id));
        const fresh = (page?.items || []).filter(entry => !known.has(entry.id)).map(entry => ({ ...entry, creator }));
        posts.items.push(...fresh);
        posts.cursor = page?.nextCursor || null;
        posts.loaded = true;
        posts.loading = false;
        if (reset || posts.items.length === fresh.length) paintBody();
        else {
          region('posts-grid')?.insertAdjacentHTML('beforeend', html`${fresh.map(cardOf)}`.value);
          hydrate();
        }
        paintFooter();
        paintNotice();
        announce(posts.items.length ? `Showing ${plural(posts.items.length, 'post')}.` : 'No posts to show.');
        if (reset || recovered) {
          stopScroll();
          stopScroll = posts.cursor ? infiniteScroll(region('posts-sentinel'), () => load()) : () => {};
        }
        return Boolean(posts.cursor);
      } catch (error) {
        if (disposed || ticket !== posts.ticket) return false;
        posts.loading = false;
        posts.error = error;
        paintBody();
        paintFooter();
        throw error;
      }
    }

    function setKind(kind) {
      if (data.kind === kind) return;
      data.kind = kind;
      for (const control of el.querySelectorAll('.filter-button')) control.setAttribute('aria-pressed', String(control.dataset.kind === kind));
      load({ reset: true }).catch(() => {});
    }

    // --- Tabs ----------------------------------------------------------------------

    function syncUrl() {
      const target = paths.creator(creator.slug, data.tab === 'posts' ? {} : { tab: data.tab });
      try {
        if (`${location.pathname}${location.search}` !== target) history.replaceState(history.state, '', target);
      } catch { /* the address is a convenience */ }
    }

    function selectTab(name, { focus = false, scroll = false, sync = true } = {}) {
      if (!TAB_IDS.includes(name)) return;
      data.tab = name;
      for (const tab of el.querySelectorAll('[role="tab"]')) {
        const on = tab.dataset.tab === name;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
      }
      for (const panel of el.querySelectorAll('[role="tabpanel"]')) panel.hidden = panel.dataset.panel !== name;
      if (sync) syncUrl();
      if (name === 'posts' && !posts.started) {
        posts.started = true;
        load({ reset: true }).catch(() => {});
      }
      if (focus) el.querySelector(`#atelier-tab-${name}`)?.focus();
      if (scroll) el.querySelector('.atelier-tabs')?.scrollIntoView?.({ block: 'start' });
    }

    // --- Dialogs and writes ----------------------------------------------------------

    const pageUrl = () => new URL(paths.creator(creator.slug), globalThis.location.origin).href;

    function showLink(url) {
      modal.open({
        title: 'Copy the link',
        body: html`<div class="field"><label for="share-url">Link to ${creator.name}</label><input id="share-url" readonly value="${url}"></div>`,
        onMount: dialog => dialog.querySelector('#share-url')?.select?.()
      });
    }

    async function copyLink() {
      const url = pageUrl();
      try {
        await globalThis.navigator.clipboard.writeText(url);
        toast('Link copied.', { tone: 'success' });
      } catch {
        showLink(url);
      }
    }

    async function share() {
      try {
        await globalThis.navigator.share({ title: creator.name, text: creator.descriptor || `${creator.name} on REFLUENZ`, url: pageUrl() });
      } catch (error) {
        if (error?.name !== 'AbortError') copyLink();
      }
    }

    function refocusActions() {
      Promise.resolve().then(() => {
        if (disposed || (document.activeElement && document.activeElement !== document.body)) return;
        region('actions')?.querySelector('[data-action="join"], [data-action="manage"]')?.focus();
      });
    }

    function openJoin(tierId) {
      if (isOwner(ctx, creator)) return;
      if (!store.requireAuth(`Sign in to join ${creator.name}’s circle. It is free during early access.`)) return;
      const open = joinableTiers(data);
      if (!open.length) { toast('Memberships are not open right now.', { tone: 'error' }); return; }
      const held = heldBy(ctx, creator);
      const chosen = open.find(tier => tier.id === tierId) || open.find(tier => tier.id === held?.tierId) || open[0];
      const option = tier => html`<label class="join-option"><input type="radio" name="tier" value="${tier.id}"${tier.id === chosen.id && raw(' checked')}>
        <span class="join-option-body"><span class="join-option-head"><strong>${tier.name}</strong>${held?.tierId === tier.id && badge('Your tier', 'ink')}<span class="join-option-price">${money(tier.priceCents, tier.currency)} / month</span></span>
        ${tier.description && html`<span class="join-option-text">${tier.description}</span>`}
        ${tier.perks?.length > 0 && html`<span class="join-option-text">${tier.perks.slice(0, 3).join(' · ')}</span>`}</span></label>`;
      modal.open({
        title: held ? `Your membership at ${creator.name}` : `Join ${creator.name}`,
        className: 'join-dialog',
        body: html`<form id="join-form" class="join-form" novalidate>
          <p>${held ? 'Choose another tier to switch. The change applies at once.' : 'Choose a tier. You can switch or leave at any time.'}</p>
          <fieldset class="join-tiers"><legend class="eyebrow">Tier</legend>${open.map(option)}</fieldset>
          <p class="notice join-early">${EARLY_ACCESS} Nothing is charged today.</p>
          <p class="form-error" role="alert" data-join-error></p>
          <div class="dialog-actions">${button('Cancel', { variant: 'secondary', attrs: { 'data-modal-close': true } })}<button type="submit" class="button" data-join-submit><span>${held ? 'Change tier' : 'Join circle'}</span></button></div>
        </form>`,
        onClose: refocusActions,
        onMount: (dialog, handle) => {
          const form = dialog.querySelector('#join-form');
          const submit = form.querySelector('[data-join-submit]');
          const problem = form.querySelector('[data-join-error]');
          const selected = () => form.querySelector('input[name="tier"]:checked')?.value;
          const sync = () => { submit.disabled = Boolean(held) && selected() === held.tierId; problem.textContent = ''; };
          sync();
          form.addEventListener('change', sync);
          form.addEventListener('submit', async event => {
            event.preventDefault();
            const id = selected();
            problem.textContent = '';
            if (!id) { problem.textContent = 'Choose a tier to continue.'; return; }
            if (id === held?.tierId) { problem.textContent = 'This is already your tier.'; return; }
            setBusy(submit, true);
            try {
              const membership = await store.join(creator.id, id);
              if (!membership) return;
              handle.close('joined');
              const name = tierNameOf(data, membership);
              toast(held ? `You are now at ${name}.` : `Welcome to ${creator.name}’s circle.`, { tone: 'success' });
            } catch (error) {
              problem.textContent = messageOf(error, 'We could not complete that. Try again in a moment.');
            } finally {
              setBusy(submit, false);
            }
          });
        }
      });
    }

    async function leaveCircle(trigger) {
      const confirmed = await confirmDialog({
        title: `Leave ${creator.name}’s circle?`,
        text: 'You will lose access to posts that are for members. You can rejoin whenever you like; it is free during early access.',
        confirmLabel: 'Leave circle',
        tone: 'danger'
      });
      if (!confirmed) return;
      setBusy(trigger, true);
      try {
        await store.leave(creator.id);
        toast(`You have left ${creator.name}’s circle.`, { tone: 'success' });
        refocusActions();
      } catch (error) {
        toast(messageOf(error, 'We could not update your membership. Try again.'), { tone: 'error' });
      } finally {
        setBusy(trigger, false);
      }
    }

    function openReport() {
      if (!store.requireAuth('Sign in to report an atelier.')) return;
      modal.open({
        title: `Report ${creator.name}`,
        className: 'report-dialog',
        body: html`<form id="report-form" novalidate>
          <p>Tell us what is wrong with this atelier. The REFLUENZ team reviews every report.</p>
          <fieldset class="report-reasons"><legend class="eyebrow">Reason</legend>${REPORT_REASONS.map(reason => html`<label class="check-label"><input type="radio" name="reason" value="${reason}"><span>${REASON_LABELS[reason] || reason}</span></label>`)}</fieldset>
          <div class="field"><label for="report-details">Details <span class="muted">(optional)</span></label><textarea id="report-details" name="details" maxlength="1000" rows="4"></textarea></div>
          <p class="form-error" role="alert" data-report-error></p>
          <div class="dialog-actions">${button('Cancel', { variant: 'secondary', attrs: { 'data-modal-close': true } })}<button type="submit" class="button" data-report-submit><span>Send report</span></button></div>
        </form>`,
        onMount: (dialog, handle) => {
          const form = dialog.querySelector('#report-form');
          const submit = form.querySelector('[data-report-submit]');
          const problem = form.querySelector('[data-report-error]');
          form.addEventListener('submit', async event => {
            event.preventDefault();
            const reason = form.querySelector('input[name="reason"]:checked')?.value;
            problem.textContent = '';
            if (!reason) { problem.textContent = 'Choose a reason for the report.'; return; }
            setBusy(submit, true);
            try {
              await api.report({ targetType: 'creator', targetId: creator.id, reason, details: form.querySelector('#report-details').value });
              handle.close('sent');
              toast('Thank you. We will review this atelier.', { tone: 'success' });
            } catch (error) {
              problem.textContent = messageOf(error, 'We could not send your report. Try again in a moment.');
            } finally {
              setBusy(submit, false);
            }
          });
        }
      });
    }

    // --- Events --------------------------------------------------------------------

    const removers = [
      delegate(el, 'click', '[data-tab]', (event, control) => selectTab(control.dataset.tab)),
      delegate(el, 'keydown', '[role="tab"]', (event, tab) => {
        const at = TAB_IDS.indexOf(tab.dataset.tab);
        const next = { ArrowRight: TAB_IDS[(at + 1) % TAB_IDS.length], ArrowLeft: TAB_IDS[(at + TAB_IDS.length - 1) % TAB_IDS.length], Home: TAB_IDS[0], End: TAB_IDS.at(-1) }[event.key];
        if (!next) return;
        event.preventDefault();
        selectTab(next, { focus: true });
      }),
      delegate(el, 'click', '[data-kind]', (event, control) => setKind(control.dataset.kind)),
      delegate(el, 'click', '[data-action]', (event, control) => {
        const action = control.dataset.action;
        if (action === 'message' && control.tagName === 'A') return; // a link: the router takes it
        if (action !== 'message') event.preventDefault();
        if (action === 'join') openJoin(control.dataset.tier);
        else if (action === 'manage') selectTab('membership', { focus: true, scroll: true });
        else if (action === 'leave') leaveCircle(control);
        else if (action === 'copy') copyLink();
        else if (action === 'share') share();
        else if (action === 'report') openReport();
        else if (action === 'message') store.requireAuth(`Sign in to message ${creator.name}.`);
        else if (action === 'more') load().then(() => {}, () => {});
        else if (action === 'retry-posts') load({ reset: true }).catch(() => {});
      })
    ];

    // Counts follow the store at once; the parts that depend on the membership are painted again only when it changes.
    const signature = () => `${store.state.user?.id ?? ''}|${store.state.memberships.get(creator.id)?.tierId ?? ''}`;
    let last = signature();
    removers.push(store.subscribe(() => {
      if (disposed) return;
      region('stats').innerHTML = statsMarkup(ctx, data).value;
      const now = signature();
      if (now === last) return;
      last = now;
      const actions = region('actions');
      const hadFocus = actions.contains(document.activeElement);
      actions.innerHTML = actionsMarkup(ctx, data).value;
      if (hadFocus) actions.querySelector('[data-action="join"], [data-action="manage"]')?.focus();
      region('tiers').innerHTML = tiersMarkup(ctx, data).value;
      if (posts.loaded && posts.items.length) paintBody();
      paintNotice();
    }));

    selectTab(data.tab, { sync: false });
    if (ctx.query.join === '1') {
      openJoin();
      syncUrl(); // after the sign-in prompt has noted this address, so the person comes back to the dialog
    }

    return () => {
      disposed = true;
      stopScroll();
      for (const remove of removers) remove();
    };
  }
};
