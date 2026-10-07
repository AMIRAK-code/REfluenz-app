// Notifications: /app/notifications. The activity feed (new posts, comments, replies, likes, follows, memberships, messages, notes),
// newest first, grouped by day, with unread styling, mark-read and delete. New items arrive live.
//
// The list is patched in place (mark, delete, load more, live items) so a keyboard user never loses their place.

import { avatar, button, delegate, emptyState, html, icon, infiniteScroll, setBusy, toast } from '../core/ui.js';
import { paths } from '../core/paths.js';
import { timeAgo } from '../core/format.js';
import { bucketOf } from './inbox/when.js';

const PAGE = 20;
const GROUPS = [['today', 'Today'], ['week', 'This week'], ['earlier', 'Earlier']];

// --- What each notification says and where it leads --------------------------------------

const quoted = entry => (entry?.title ? html`“${entry.title}”` : null);

// The sentence, with the person in bold. Every piece of text goes through html``, so names and titles cannot inject markup.
function sentence(note) {
  const who = note.actor?.name || note.creator?.name || 'Someone';
  const person = html`<strong>${who}</strong>`;
  const post = quoted(note.entry);
  const atelier = note.creator?.name;
  switch (note.type) {
    case 'new_entry': return html`${atelier ? html`<strong>${atelier}</strong>` : 'A creator you follow'} published ${post ?? 'a new post'}`;
    case 'comment': return html`${person} commented on ${post ?? 'your post'}`;
    case 'reply': return html`${person} replied to your comment${post ? html` on ${post}` : ''}`;
    case 'like': return html`${person} liked ${post ?? 'your post'}`;
    case 'follow': return html`${person} started following ${atelier ? html`<strong>${atelier}</strong>` : 'your atelier'}`;
    case 'membership': return html`${person} joined ${atelier ? html`<strong>${atelier}</strong>` : 'your circle'}`;
    case 'message': return html`${person} sent you a message`;
    case 'note': return html`${atelier ? html`<strong>${atelier}</strong>` : 'A creator'} posted a note to the circle`;
    default: return html`New activity from ${person}`;
  }
}

// The page a notification opens, or null when what it was about is gone.
function targetOf(store, note) {
  const me = store.state.user?.id;
  switch (note.type) {
    case 'new_entry':
    case 'like':
      return note.entry ? paths.entry(note.entry.id) : null;
    case 'comment':
    case 'reply':
      return note.entry ? `${paths.entry(note.entry.id)}#comments` : null;
    case 'follow':
    case 'membership':
      return paths.studio({ tab: 'members' });
    case 'message': {
      if (!note.creator) return paths.messages();
      // The owner answers the member who wrote; a member opens their own thread with that atelier.
      if (store.state.myCreator?.id === note.creator.id) return note.actor ? paths.messages(note.creator.id, note.actor.id) : paths.messages();
      return me ? paths.messages(note.creator.id, me) : paths.messages();
    }
    case 'note':
      return note.creator?.slug ? paths.creator(note.creator.slug) : null;
    default:
      return null;
  }
}

// --- Markup ----------------------------------------------------------------------------------

function row(ctx, note) {
  const unread = !note.readAt;
  const href = targetOf(ctx.store, note);
  const body = html`${avatar(note.actor || note.creator || { name: '' }, { size: 40 })}
    <span class="notice-text">
      <span class="notice-sentence">${sentence(note)}</span>
      <span class="notice-meta"><time datetime="${note.createdAt}">${timeAgo(note.createdAt)}</time>${unread ? html`<span class="eyebrow notice-new">New</span>` : ''}</span>
    </span>`;
  return html`<li class="notice${unread ? ' is-unread' : ''}" data-notice="${note.id}">
    ${href
      ? html`<a class="notice-main" href="${href}" data-open="${note.id}" data-focus="open:${note.id}">${body}</a>`
      : html`<div class="notice-main">${body}</div>`}
    <div class="notice-actions">
      ${unread ? html`<button type="button" class="icon-button" data-read="${note.id}" data-focus="read:${note.id}" aria-label="Mark as read">${icon('check', 16)}</button>` : ''}
      <button type="button" class="icon-button" data-delete="${note.id}" data-focus="delete:${note.id}" aria-label="Delete this notification">${icon('trash', 16)}</button>
    </div>
  </li>`;
}

function bodyMarkup(ctx, data) {
  if (!data.items.length) {
    return emptyState({
      icon: 'bell',
      title: 'Nothing new yet',
      text: 'When someone comments, follows you or joins your circle, and when a creator you follow publishes, it shows up here.',
      action: { label: 'Discover creators', href: paths.discover(), variant: 'secondary' }
    });
  }
  const now = Date.now();
  const groups = GROUPS.map(([key, label]) => [key, label, data.items.filter(note => bucketOf(note.createdAt, now) === key)]).filter(([, , rows]) => rows.length);
  return html`${groups.map(([key, label, rows]) => html`<section class="notice-group" aria-labelledby="notices-${key}">
      <div class="section-head"><h2 id="notices-${key}">${label}</h2></div>
      <ul class="notice-list">${rows.map(note => row(ctx, note))}</ul>
    </section>`)}
    ${data.nextCursor || data.moreError ? html`<div class="notices-more">
      <div data-sentinel></div>
      ${data.moreError ? html`<p class="field-error" role="alert">${data.moreError}</p>` : ''}
      <button type="button" class="button secondary" data-more data-focus="more">${data.moreError ? 'Try again' : 'Load more'}</button>
    </div>` : ''}`;
}

// --- The view --------------------------------------------------------------------------------

export default {
  title: 'Notifications',
  auth: 'required',

  async load(ctx) {
    const page = await ctx.api.listNotifications({ limit: PAGE });
    return { items: page.items, nextCursor: page.nextCursor, moreError: '', fresh: 0 };
  },

  render(ctx, data) {
    return html`<section class="page notices">
      <header class="page-head">
        <div><p class="eyebrow muted">Activity</p><h1>Notifications</h1><p class="page-sub">What is happening around your atelier and the creators you follow.</p></div>
        <div class="notices-tools">${button('Mark all read', { variant: 'secondary', size: 'small', icon: 'check', attrs: { 'data-mark-all': true, disabled: !data.items.some(note => !note.readAt) && !ctx.store.state.unread.notifications } })}</div>
      </header>
      <p class="visually-hidden" id="notices-status" role="status"></p>
      <div id="notices-body">${bodyMarkup(ctx, data)}</div>
    </section>`;
  },

  mount(el, ctx, data) {
    const { api, store } = ctx;
    const body = el.querySelector('#notices-body');
    const status = el.querySelector('#notices-status');
    const markAll = el.querySelector('[data-mark-all]');
    const removers = [];
    const deleting = new Set();
    let alive = true;
    let loading = false;
    let stopScroll = () => {};

    const byId = id => data.items.find(note => note.id === id);
    const hasUnread = () => data.items.some(note => !note.readAt);

    // Newest first, no duplicates (a live item can also be on the next page).
    function addItem(note) {
      if (!note?.id || byId(note.id)) return false;
      data.items.push(note);
      data.items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return true;
    }

    function syncTools() {
      if (!markAll || markAll.dataset.busy) return;
      markAll.disabled = !hasUnread() && !store.state.unread.notifications;
    }

    // Draws the list again and keeps the keyboard where it was: on the same control, or on `fallback`.
    function paint({ fallback } = {}) {
      if (!alive) return;
      const doc = el.ownerDocument;
      const focused = doc.activeElement?.closest?.('[data-focus]')?.dataset.focus;
      body.innerHTML = bodyMarkup(ctx, data).value;
      const target = (focused && body.querySelector(`[data-focus="${focused}"]`)) || (fallback && body.querySelector(`[data-focus="${fallback}"]`));
      if (target) target.focus();
      else if (focused) doc.getElementById('main')?.focus({ preventScroll: true });
      syncTools();
      bindScroll();
    }

    function bindScroll() {
      stopScroll();
      stopScroll = () => {};
      const sentinel = body.querySelector('[data-sentinel]');
      if (sentinel && data.nextCursor && !data.moreError) stopScroll = infiniteScroll(sentinel, loadMore);
    }

    async function loadMore() {
      if (loading || !data.nextCursor) return false;
      loading = true;
      data.moreError = '';
      try {
        const page = await api.listNotifications({ cursor: data.nextCursor, limit: PAGE });
        if (!alive) return false;
        const before = data.items.length;
        page.items.forEach(addItem);
        data.nextCursor = page.nextCursor;
        const firstNew = data.items.length > before ? data.items[before]?.id : null;
        paint({ fallback: firstNew && `open:${firstNew}` });
        return Boolean(data.nextCursor);
      } catch (error) {
        if (alive) {
          data.moreError = error?.message || 'We could not load more notifications.';
          paint();
        }
        throw error;
      } finally {
        loading = false;
      }
    }

    // --- Reading -------------------------------------------------------------------------------
    async function markOne(id) {
      const note = byId(id);
      if (!note || note.readAt) return false;
      note.readAt = new Date().toISOString();
      syncTools();
      try {
        await api.markNotificationsRead([id]);
      } catch (error) {
        note.readAt = null;
        if (alive) paint();
        toast(error?.message || 'We could not mark that as read. Try again.', { tone: 'error' });
        return false;
      }
      store.refreshUnread();
      return true;
    }

    // The row is patched, not replaced: the link under the pointer must survive the click that is navigating.
    function showRead(id) {
      const item = body.querySelector(`[data-notice="${id}"]`);
      if (!item) return;
      item.classList.remove('is-unread');
      item.querySelector('.notice-new')?.remove();
      const button = item.querySelector('[data-read]');
      if (button) {
        const focusBack = el.ownerDocument.activeElement === button;
        button.remove();
        if (focusBack) item.querySelector('[data-open]')?.focus();
      }
    }

    removers.push(
      delegate(el, 'click', '[data-open]', (event, link) => {
        const id = link.dataset.open;
        if (byId(id)?.readAt) return;
        markOne(id);
        showRead(id);
      }),
      delegate(el, 'click', '[data-read]', (event, control) => {
        const id = control.dataset.read;
        showRead(id);
        markOne(id);
      }),
      delegate(el, 'click', '[data-more]', async (event, control) => {
        setBusy(control, true);
        try { await loadMore(); } catch { /* shown in the list */ } finally { setBusy(control, false); }
      }),
      delegate(el, 'click', '[data-mark-all]', async (event, control) => {
        if (control.dataset.busy) return;
        setBusy(control, true);
        try {
          await api.markNotificationsRead('all');
        } catch (error) {
          setBusy(control, false);
          syncTools();
          toast(error?.message || 'We could not mark your notifications as read. Try again.', { tone: 'error' });
          return;
        }
        setBusy(control, false);
        const now = new Date().toISOString();
        for (const note of data.items) note.readAt ??= now;
        paint();
        toast('You are all caught up.', { tone: 'success' });
        store.refreshUnread();
      }),
      delegate(el, 'click', '[data-delete]', async (event, control) => {
        const id = control.dataset.delete;
        const index = data.items.findIndex(note => note.id === id);
        if (index < 0 || deleting.has(id)) return;
        deleting.add(id);
        const [removed] = data.items.splice(index, 1);
        const neighbour = data.items[index] ?? data.items[index - 1];
        paint({ fallback: neighbour && `open:${neighbour.id}` });
        try {
          await api.deleteNotification(id);
          store.refreshUnread();
        } catch (error) {
          addItem(removed);
          if (alive) paint({ fallback: `delete:${id}` });
          toast(error?.message || 'We could not delete that notification. Try again.', { tone: 'error' });
        } finally {
          deleting.delete(id);
        }
      })
    );

    // --- Live ----------------------------------------------------------------------------------
    removers.push(store.subscribe(syncTools));
    removers.push(store.onRealtime(event => {
      if (event.type !== 'notification' || !addItem(event.payload)) return;
      data.fresh += 1;
      paint();
      status.textContent = data.fresh === 1 ? 'You have a new notification.' : `You have ${data.fresh} new notifications.`;
    }));

    bindScroll();

    return () => {
      alive = false;
      stopScroll();
      removers.splice(0).forEach(remove => remove());
    };
  }
};
