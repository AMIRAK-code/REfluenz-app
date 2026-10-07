// /app/p/:id — one post: its header, the words or the media, the lock for those who are not in the circle yet,
// the conversation, and more from the same atelier (docs/ARCHITECTURE.md section 3, docs/POST_FORMATS.md "Reader").
//
// The page is drawn once. The pieces that change while it is open (the media after a retry, the comments, the list of
// more posts) are drawn by their own modules inside it, so a film keeps playing and typed text is never lost.

import { avatar, badge, button, delegate, entryCard, errorState, followButton, html, icon, likeButton, raw, saveButton, setBusy, toast } from '../core/ui.js';
import { hydrateCovers } from '../core/covers.js';
import { duration, entrySize, formatDate, kindOf, money } from '../core/format.js';
import { paths } from '../core/paths.js';
import { TIER_NAMES, presetUrl } from '../core/constants.js';
import { loadMedia, mediaMarkup, mountMedia } from './entry/media.js';
import { commentsSection, mountComments } from './entry/comments.js';
import { openReport, sharePost } from './entry/actions.js';

const KIND_LABELS = { text: 'Text', image: 'Images', video: 'Video' };
const MORE_FIRST = 7; // one more than shown, so the post itself can be left out
const MORE_NEXT = 6;

// --- Helpers -------------------------------------------------------------------------

const isOwner = (store, entry) => Boolean(store.state.myCreator) && store.state.myCreator.id === entry.creatorId;

// Blank lines start a new paragraph, single line breaks stay line breaks. Everything is text, never markup.
const paragraphs = text => String(text ?? '').split(/\r?\n[ \t]*\r?\n/).map(part => part.trim()).filter(Boolean)
  .map(part => html`<p>${part.split(/\r?\n/).map((line, index) => (index ? [raw('<br>'), line] : line))}</p>`);

const tierOf = (data, id) => data.tiers.find(tier => tier.id === id) ?? null;
const tierName = (data, id) => tierOf(data, id)?.name || TIER_NAMES[id] || 'Members';

// What a locked post shows instead of its media: the public blurred preview, the cover of a text post, or the editorial preset.
function lockedCover(entry) {
  if (kindOf(entry) === 'text') return entry.coverUrl ? { src: entry.coverUrl, tone: '' } : { src: presetUrl(entry.image), tone: ' is-preset' };
  return entry.previewUrl ? { src: entry.previewUrl, tone: ' is-preview' } : { src: presetUrl(entry.image), tone: ' is-preset' };
}

// --- Pieces of the page --------------------------------------------------------------

function notFound() {
  return html`<section class="page post-page" aria-labelledby="post-title">
    <div class="empty post-missing">
      <span class="empty-icon">${icon('text', 26)}</span>
      <h1 id="post-title">This post is not available</h1>
      <p>It may have been removed, moved back to drafts, or the link is not quite right.</p>
      ${button('Back to the feed', { href: paths.home })}
    </div>
  </section>`;
}

function header(ctx, data) {
  const { store } = ctx;
  const { entry, creator, readable } = data;
  const owner = isOwner(store, entry);
  const draft = entry.status !== 'published';
  const published = !draft;
  const kind = kindOf(entry);
  const date = entry.publishedAt || entry.date || entry.createdAt;
  const size = kind === 'video' ? duration(entry.duration) || 'Video' : entrySize(entry);
  const access = entry.access === 'public' ? badge('Open to everyone') : badge(`${tierName(data, entry.access)} and above`, readable ? 'neutral' : 'accent');
  return html`<header class="post-head">
    <p class="eyebrow bronze">${[entry.category, entry.format].filter(Boolean).join(' · ')}</p>
    <h1 class="post-title" id="post-title">${entry.title}</h1>
    ${entry.subtitle && html`<p class="post-subtitle">${entry.subtitle}</p>`}
    <div class="post-badges">${draft && badge('Draft', 'ink')}${badge(KIND_LABELS[kind])}${access}</div>
    <div class="post-byline">
      ${creator && html`<div class="post-author">
        <a class="post-author-link" href="${paths.creator(creator.slug)}">${avatar(creator, { size: 44 })}<span class="post-author-text"><strong>${creator.name}</strong><span class="muted">${[creator.category, creator.location].filter(Boolean).join(' · ')}</span></span></a>
        ${creator.isShowcase && badge('Showcase', 'accent')}
        ${followButton(creator.id)}
      </div>`}
      <p class="post-meta muted"><time datetime="${date}">${formatDate(date, { year: true })}</time>${size && html`<span aria-hidden="true">·</span><span>${size}</span>`}</p>
    </div>
    <div class="post-toolbar" role="group" aria-label="Post actions">
      ${published && readable && likeButton(entry)}
      ${published && saveButton(entry)}
      ${published && html`<button type="button" class="icon-button" data-post-action="share" aria-label="Share this post" title="Share">${icon('export', 17)}</button>`}
      ${published && !owner && html`<button type="button" class="icon-button" data-post-action="report" aria-label="Report this post" title="Report">${icon('flag', 17)}</button>`}
      ${owner && button('Edit post', { variant: 'secondary', size: 'small', href: paths.studioEdit(entry.id), icon: 'edit' })}
    </div>
  </header>`;
}

function lockCard(ctx, data) {
  const { entry, creator } = data;
  const tier = tierOf(data, entry.access);
  const name = tierName(data, entry.access);
  const membership = ctx.store.state.memberships.get(entry.creatorId);
  const closed = tier?.enabled === false;
  const here = ctx.path;
  return html`<section class="post-lock" aria-labelledby="post-lock-title">
    <span class="empty-icon">${icon('lock', 24)}</span>
    <p class="eyebrow bronze">${name} and above</p>
    <h2 id="post-lock-title">There is more inside the circle</h2>
    <p>${creator ? creator.name : 'This atelier'} shares this post with the ${name} circle and above.${membership && html` Your ${membership.tier?.name || 'current'} membership does not include it yet.`}</p>
    ${tier && !closed && html`<p class="post-lock-price"><strong>${money(tier.priceCents, tier.currency)}</strong> <span class="muted">/ month</span></p>`}
    <p class="muted">Joining is free during early access, so nothing is charged yet.${closed && ' This tier is not open to new members right now.'}</p>
    <div class="post-lock-actions">
      ${creator && button(closed ? 'See the memberships' : 'Join to read', { href: paths.creator(creator.slug, { join: 1 }), icon: 'lock' })}
      ${!ctx.store.state.user && html`<a class="text-link" href="${paths.login(here)}">Already a member? Sign in</a>`}
    </div>
  </section>`;
}

function content(ctx, data) {
  const { entry, body, readable } = data;
  const kind = kindOf(entry);
  if (!readable) {
    const cover = lockedCover(entry);
    return html`<div class="post-locked">
      <div class="post-preview${cover.tone}"><img src="${cover.src}" alt="" decoding="async"></div>
      ${entry.excerpt && html`<p class="post-excerpt">${entry.excerpt}</p>`}
      ${lockCard(ctx, data)}
    </div>`;
  }
  const words = paragraphs(body);
  return html`<div class="post-content">
    ${kind === 'text' && entry.coverUrl && html`<figure class="post-cover"><img src="${entry.coverUrl}" alt="" decoding="async"></figure>`}
    ${kind !== 'text' && html`<div class="post-media" data-media>${mediaMarkup(entry, data.media)}</div>`}
    ${words.length > 0 && html`<div class="post-body">${words}</div>`}
    ${words.length === 0 && kind === 'text' && html`<p class="post-note">This post has no text yet.</p>`}
  </div>`;
}

// --- Loading -------------------------------------------------------------------------

async function load(ctx) {
  const { api, store } = ctx;
  const entry = await api.getEntry(ctx.params.id);
  // A draft belongs to its author alone: the database hides it from everybody else, and so does the page.
  if (!entry || (entry.status !== 'published' && !isOwner(store, entry))) return { entry: null };

  // The viewer's membership is only a hint: the server decides whether the words come back. A post that looks readable
  // starts fetching its media right away; one that looks locked makes no media request unless the words do come back.
  const hinted = kindOf(entry) !== 'text' && store.canRead(entry);
  const early = hinted ? loadMedia(api, entry) : null;
  const [body, tiers, creator] = await Promise.all([
    api.getBody(entry.id),
    entry.access === 'public' ? [] : api.listTiers(entry.creatorId).catch(() => []),
    entry.creator ? entry.creator : api.getCreator(entry.creatorId).catch(() => null)
  ]);
  const readable = body !== null && body !== undefined;
  const kind = kindOf(entry);
  let media = null;
  if (readable && kind !== 'text') media = await (early ?? loadMedia(api, entry));
  else if (early) await early;
  return { entry, creator, tiers: tiers || [], body: readable ? String(body) : null, readable, media, recorded: false };
}

// --- More from this atelier ----------------------------------------------------------

function mountMore(root, ctx, data) {
  const section = root.querySelector('[data-more]');
  if (!section) return () => {};
  const { api, store } = ctx;
  const { entry, creator } = data;
  let alive = true;
  let shown = [];
  let cursor = null;
  let loading = false;

  const cards = items => items.map(item => entryCard({ ...item, creator: item.creator ?? creator }, { compact: true, showCreator: false }));

  const frame = inner => html`<div class="section-head"><h2 id="more-title">More from this atelier</h2>${creator && html`<a class="text-link" href="${paths.creator(creator.slug)}">Visit ${creator.name}</a>`}</div>${inner}`;

  function paint() {
    section.innerHTML = frame(html`<div class="grid-cards" data-more-grid>${cards(shown)}</div>${cursor && html`<div class="post-more-foot">${button('Load more', { variant: 'secondary', attrs: { 'data-more-load': '' } })}</div>`}`).value;
    hydrateCovers(section, shown, api, store);
  }

  async function fetchPage(limit) {
    const page = await api.creatorEntries(entry.creatorId, { limit, cursor: cursor ?? undefined });
    return { items: (page?.items || []).filter(item => item.id !== entry.id && !shown.some(known => known.id === item.id)), next: page?.nextCursor ?? null };
  }

  async function first() {
    try {
      const page = await fetchPage(MORE_FIRST);
      if (!alive) return;
      shown = page.items;
      cursor = page.next;
      section.hidden = shown.length === 0;
      if (shown.length) paint();
    } catch (error) {
      if (!alive) return;
      section.hidden = false;
      section.innerHTML = frame(errorState(error, { title: 'We could not load more from this atelier', retry: first })).value;
    }
  }

  const off = delegate(section, 'click', '[data-more-load]', async (event, control) => {
    if (loading) return;
    loading = true;
    setBusy(control, true);
    try {
      const page = await fetchPage(MORE_NEXT);
      if (!alive) return;
      shown = [...shown, ...page.items];
      cursor = page.next;
      paint();
    } catch (error) {
      toast(error?.message || 'We could not load more posts. Try again.', { tone: 'error' });
      setBusy(control, false);
    } finally {
      loading = false;
    }
  });

  first();
  return () => {
    alive = false;
    off();
  };
}

// --- The view ------------------------------------------------------------------------

export default {
  title: (ctx, data) => (data?.entry ? data.entry.title : 'Post not found'),
  auth: 'optional',
  load,

  render(ctx, data) {
    if (!data.entry) return notFound();
    const { entry, readable } = data;
    const canTalk = readable && entry.status === 'published';
    return html`<article class="page post-page" aria-labelledby="post-title" data-post="${entry.id}">
      ${header(ctx, data)}
      ${entry.status !== 'published' && html`<p class="notice post-draft-note">This post is a draft, so only you can see it. <a href="${paths.studioEdit(entry.id)}">Open it in the editor</a> to finish it and publish.</p>`}
      ${content(ctx, data)}
      ${canTalk && commentsSection(ctx, data)}
      <section class="section post-more" data-more aria-labelledby="more-title" hidden></section>
    </article>`;
  },

  mount(el, ctx, data) {
    if (!data.entry) return undefined;
    const { api, store } = ctx;
    const { entry } = data;
    const stops = [mountMedia(el, ctx, data)];
    if (data.readable && entry.status === 'published') stops.push(mountComments(el, ctx, data));
    stops.push(mountMore(el, ctx, data));

    // Opened by someone who is signed in and may read it: counted once for this visit, even if the page is drawn again.
    if (data.readable && entry.status === 'published' && store.state.user && !data.recorded) {
      data.recorded = true;
      Promise.resolve(api.recordRead(entry.id)).catch(() => {});
    }

    stops.push(delegate(el, 'click', '[data-post-action]', (event, control) => {
      event.preventDefault();
      if (control.dataset.postAction === 'share') {
        sharePost(entry);
      } else if (control.dataset.postAction === 'report') {
        openReport(ctx, { targetType: 'entry', targetId: entry.id, subject: 'post' });
      }
    }));

    return () => stops.forEach(stop => stop());
  }
};
