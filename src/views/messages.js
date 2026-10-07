// Messages: /app/messages (the list of conversations) and /app/messages/:creatorId/:memberId (one conversation).
//
// Two panes on a wide screen (list and thread), one pane at a time on a narrow one. The person may be both a member of other
// ateliers and the owner of their own, so every conversation has a role for the viewer: 'member' (writing to an atelier) or
// 'creator' (the owner answering a member). Members start conversations; the owner can reply once the member has written.
// The thread is updated in place (optimistic sends, live messages): the page is never redrawn from scratch while someone types.

import { avatar, debounce, delegate, emptyState, errorState, html, icon, raw, toast } from '../core/ui.js';
import { paths } from '../core/paths.js';
import { plural, timeAgo } from '../core/format.js';
import { isUuid } from '../api/util.js';
import { clock, dayKey, dayLabel } from './inbox/when.js';

const MAX_LENGTH = 2000;
const HISTORY = 200; // what api.thread returns at most
const PAGE = 30; // conversations listed before "Show more"
const COUNTER_FROM = 1800; // the character counter appears close to the limit

// Unsent text per conversation, kept while the person moves around the app (not across reloads).
const drafts = new Map();

// --- Who is who ------------------------------------------------------------------------

const lower = value => String(value ?? '').toLowerCase();

// 'member': the viewer writes to somebody's atelier. 'creator': the viewer owns the atelier and answers a member. Otherwise null.
function roleOf(store, creatorId, memberId) {
  const me = store.state.user?.id;
  const mine = store.state.myCreator?.id;
  if (!me) return null;
  if (memberId === me && creatorId !== mine) return 'member';
  if (mine && creatorId === mine && memberId !== me) return 'creator';
  return null;
}

const threadKey = thread => `${thread.creatorId}/${thread.memberId}`;
const sameThread = (a, b) => a.creatorId === b.creatorId && a.memberId === b.memberId;

// The other party of a conversation, as the list and the header show it.
function partnerOf(ctx, thread) {
  const asOwner = thread.creatorId === ctx.store.state.myCreator?.id;
  if (asOwner) return { kind: 'member', name: thread.member?.name || 'Member', avatarUrl: thread.member?.avatarUrl || '', slug: '' };
  const creator = thread.creator || {};
  return { kind: 'creator', name: creator.name || 'Atelier', avatarUrl: creator.avatarUrl || '', slug: creator.slug || '' };
}

const isMine = (data, thread, sender) => (sender === 'member' ? thread.memberId === data.me : thread.creatorId === data.myCreatorId);

// Why a conversation cannot be written to, or ''. Showcase ateliers belong to REFLUENZ and have nobody to answer.
function blockReason(creator, me) {
  if (!creator) return '';
  if (creator.isShowcase) return 'showcase';
  if (!creator.ownerId || creator.ownerId === me) return 'closed';
  return '';
}

// 'compose' | 'blocked' | 'wait' (the owner has nothing to reply to yet)
function footKind(open) {
  if (open.role === 'member') return open.blocked ? 'blocked' : 'compose';
  return open.messages.some(message => message.from === 'member') ? 'compose' : 'wait';
}

// --- Markup -------------------------------------------------------------------------------

function threadRow(ctx, data, thread) {
  const partner = partnerOf(ctx, thread);
  const key = threadKey(thread);
  const active = data.open && threadKey(data.open) === key;
  const unread = Number(thread.unread) || 0;
  const mine = isMine(data, thread, thread.lastSender);
  const owner = thread.creatorId === data.myCreatorId;
  return html`<li><a class="inbox-item${unread > 0 ? ' is-unread' : ''}${active ? ' is-active' : ''}" href="${paths.messages(thread.creatorId, thread.memberId)}" data-thread="${key}"${active ? raw(' aria-current="page"') : ''}>
    ${avatar(partner, { size: 44 })}
    <span class="inbox-item-text">
      <span class="inbox-item-top"><strong class="inbox-name">${partner.name}</strong><time class="inbox-time" datetime="${thread.lastAt}">${timeAgo(thread.lastAt)}</time></span>
      <span class="inbox-item-bottom"><span class="inbox-preview">${mine ? 'You: ' : ''}${thread.lastBody}</span>${unread > 0 ? html`<span class="inbox-unread"><span aria-hidden="true">${unread > 99 ? '99+' : unread}</span><span class="visually-hidden">${plural(unread, 'unread message')}</span></span>` : ''}</span>
      ${owner && data.myCreatorId ? html`<span class="eyebrow inbox-tag">Your atelier</span>` : ''}
    </span>
  </a></li>`;
}

// Ateliers whose circle the person belongs to and who can be written to, and no conversation exists with yet.
function starters(ctx, data) {
  const started = new Set(data.inbox.filter(thread => thread.memberId === data.me).map(thread => thread.creatorId));
  const ateliers = [...ctx.store.state.memberships.values()].map(membership => membership.creator)
    .filter(creator => creator?.id && creator.ownerId && !creator.isShowcase && creator.ownerId !== data.me && !started.has(creator.id));
  if (!ateliers.length) return '';
  return html`<div class="inbox-starters"><h3 class="eyebrow muted">Start a conversation</h3><ul>${ateliers.map(creator => html`<li><a class="inbox-starter" href="${paths.messages(creator.id, data.me)}">${avatar(creator, { size: 32 })}<span>Write to ${creator.name}</span>${icon('chevron-right', 14)}</a></li>`)}</ul></div>`;
}

function listMarkup(ctx, data) {
  const rows = data.inbox.slice(0, data.visible);
  return html`${rows.length
    ? html`<ul class="inbox-list">${rows.map(thread => threadRow(ctx, data, thread))}</ul>`
    : html`<p class="inbox-none muted">No conversations yet.</p>`}
    ${data.inbox.length > rows.length ? html`<div class="inbox-more"><button type="button" class="button secondary small" data-more>Show older conversations</button></div>` : ''}
    ${starters(ctx, data)}`;
}

function bubble(item, name, mine) {
  const failed = item.state === 'failed';
  const sending = item.state === 'sending';
  return html`<div class="bubble-row${mine ? ' is-mine' : ''}${failed ? ' is-failed' : ''}${sending ? ' is-sending' : ''}"${item.id ? html` data-message="${item.id}"` : html` data-pending="${item.key}"`}>
    <p class="bubble">${item.text}</p>
    <p class="bubble-meta"><span class="visually-hidden">${mine ? 'You' : name}, </span><time datetime="${item.date}">${clock(item.date)}</time>${sending ? html` · Sending…` : ''}${failed
      ? html` · <span class="bubble-error">${item.error || 'Not sent.'}</span> <button type="button" class="text-button" data-resend="${item.key}">Retry</button> <button type="button" class="text-button" data-edit-failed="${item.key}">Edit</button>`
      : ''}</p>
  </div>`;
}

function logMarkup(ctx, data) {
  const open = data.open;
  const name = open.partner.name;
  const items = [...open.messages, ...open.pending];
  if (!items.length) {
    return html`<p class="thread-empty muted">${open.role === 'member'
      ? (open.blocked ? 'There are no messages in this conversation.' : `Say hello to ${name}. Only the two of you can read this conversation.`)
      : `${name} has not written to you yet.`}</p>`;
  }
  let day = '';
  return html`${open.messages.length >= HISTORY ? html`<p class="thread-note muted">Showing the latest ${HISTORY} messages.</p>` : ''}${items.map(item => {
    const key = dayKey(item.date);
    const separator = key !== day ? html`<p class="thread-day"><span>${dayLabel(item.date)}</span></p>` : '';
    day = key;
    return html`${separator}${bubble(item, name, item.from === open.role)}`;
  })}`;
}

function footMarkup(ctx, data) {
  const open = data.open;
  const name = open.partner.name;
  const kind = footKind(open);
  if (kind === 'blocked') {
    return html`<div class="thread-notice" role="note">
      <p>${open.blocked === 'showcase'
        ? html`${name} is a showcase atelier of REFLUENZ, so it is not taking messages. Follow it to see new work, or join its circle.`
        : html`${name} is not taking messages right now.`}</p>
      ${open.partner.slug ? html`<a class="text-link" href="${paths.creator(open.partner.slug)}">View ${name}</a>` : ''}
    </div>`;
  }
  if (kind === 'wait') {
    return html`<div class="thread-notice" role="note"><p>Members start the conversation. You can reply here once ${name} has written to you.</p></div>`;
  }
  return html`<form class="thread-compose" id="thread-form" novalidate>
    <label class="visually-hidden" for="compose-text">Message to ${name}</label>
    <textarea id="compose-text" name="text" rows="1" maxlength="${MAX_LENGTH}" placeholder="Write a message" aria-describedby="compose-hint" autocomplete="off" enterkeyhint="send"></textarea>
    <button type="submit" class="button" data-send disabled>${icon('send', 16)}<span>Send</span></button>
    <p class="compose-hint muted" id="compose-hint">Enter sends, Shift and Enter start a new line. <span class="compose-count" data-count></span></p>
  </form>`;
}

function threadMarkup(ctx, data) {
  const open = data.open;
  const back = html`<a class="button secondary small inbox-back" href="${paths.messages()}">${icon('back', 14)}<span>All conversations</span></a>`;
  if (open.state === 'unavailable') {
    return html`<div class="inbox-state">${emptyState({ icon: 'message', title: 'This conversation is not available', text: 'It may have been removed, or the link is not quite right. Your own conversations are listed under Messages.', action: { label: 'Back to messages', href: paths.messages(), variant: 'secondary' } })}</div>`;
  }
  if (open.state === 'error') {
    return html`<div class="inbox-state">${back}${errorState(open.error, { title: 'We could not open this conversation', retry: () => ctx.reload() })}</div>`;
  }
  const partner = open.partner;
  const sub = partner.kind === 'creator' ? open.creator?.descriptor || open.creator?.category || 'Atelier' : `Member of ${ctx.store.state.myCreator?.name || 'your atelier'}`;
  return html`<header class="thread-head">
      <a class="icon-button thread-back" href="${paths.messages()}" aria-label="Back to all conversations">${icon('back', 18)}</a>
      ${avatar(partner, { size: 44 })}
      <div class="thread-who">
        <h2 id="thread-title">${partner.slug ? html`<a href="${paths.creator(partner.slug)}">${partner.name}</a>` : partner.name}</h2>
        <p class="eyebrow muted">${sub}</p>
      </div>
    </header>
    <div class="thread-body">
      <div class="thread-log" id="thread-log" role="log" aria-labelledby="thread-title" tabindex="0">${logMarkup(ctx, data)}</div>
      <button type="button" class="button small thread-jump" data-jump hidden>${icon('down', 14)}<span>New messages</span></button>
    </div>
    <div class="thread-foot" id="thread-foot" data-foot="${footKind(open)}">${footMarkup(ctx, data)}</div>`;
}

function placeholderMarkup() {
  return html`<div class="inbox-placeholder"><span class="empty-icon">${icon('message', 26)}</span><h2>Choose a conversation</h2><p class="muted">Messages are private between you and the other person.</p></div>`;
}

// --- Loading --------------------------------------------------------------------------------

async function loadOpen(ctx, inbox, creatorId, memberId) {
  const { api, store } = ctx;
  const me = store.state.user.id;
  const role = isUuid(creatorId) && isUuid(memberId) ? roleOf(store, creatorId, memberId) : null;
  const open = { creatorId, memberId, role, state: 'ready', error: null, creator: null, member: null, partner: { kind: 'creator', name: '', avatarUrl: '', slug: '' }, blocked: '', messages: [], pending: [] };
  if (!role) return { ...open, state: 'unavailable' };

  let messages;
  try {
    messages = await api.thread(creatorId, memberId);
  } catch (error) {
    return { ...open, state: 'error', error };
  }
  const summary = inbox.find(thread => thread.creatorId === creatorId && thread.memberId === memberId);

  try {
    if (role === 'member') {
      const creator = summary?.creator ?? await api.getCreator(creatorId);
      if (!creator) return { ...open, state: 'unavailable' };
      open.creator = creator;
      open.member = { id: me, name: store.state.profile?.name || 'You', avatarUrl: store.state.profile?.avatarUrl || '' };
      open.partner = { kind: 'creator', name: creator.name, avatarUrl: creator.avatarUrl || '', slug: creator.slug || '' };
      open.blocked = blockReason(creator, me);
    } else {
      open.creator = store.state.myCreator;
      let member = summary?.member;
      if (!member) {
        // Only reachable by typing the address: the person has not written yet. The circle may still know their name.
        const circle = await api.circleMembers(creatorId).catch(() => []);
        member = circle.find(row => row.member?.id === memberId)?.member ?? { id: memberId, name: 'Member', avatarUrl: '' };
      }
      open.member = member;
      open.partner = { kind: 'member', name: member.name || 'Member', avatarUrl: member.avatarUrl || '', slug: '' };
    }
  } catch (error) {
    return { ...open, state: 'error', error };
  }
  open.messages = messages;
  return open;
}

// --- The view ---------------------------------------------------------------------------------

export default {
  title: (ctx, data) => (data?.open?.partner?.name ? `Conversation with ${data.open.partner.name}` : 'Messages'),
  auth: 'required',

  async load(ctx) {
    const { api, store, params } = ctx;
    const creatorId = lower(params.creatorId);
    const memberId = lower(params.memberId);
    const inbox = await api.inbox();
    const data = { me: store.state.user.id, myCreatorId: store.state.myCreator?.id ?? null, inbox, visible: PAGE, open: null };
    if (params.creatorId && params.memberId) data.open = await loadOpen(ctx, inbox, creatorId, memberId);
    return data;
  },

  render(ctx, data) {
    const open = data.open;
    const showEmpty = !data.inbox.length && !open;
    return html`<section class="page inbox" data-pane="${open ? 'thread' : 'list'}">
      <header class="page-head inbox-head"><div><p class="eyebrow muted">Your conversations</p><h1>Messages</h1></div></header>
      ${showEmpty
        ? html`<div id="inbox-empty">${emptyState({
          icon: 'message',
          title: 'No conversations yet',
          text: data.myCreatorId
            ? 'Members start the conversation. When someone writes to your atelier it appears here, and you can reply. You can also write to the ateliers whose circle you belong to.'
            : 'Write to a creator whose circle you belong to, or ask a question from their atelier page. Only you and the creator can read what you send.',
          action: { label: 'Discover creators', href: paths.discover() }
        })}<div class="inbox-starters-wide" data-inbox-list>${starters(ctx, data)}</div></div>`
        : html`<div class="inbox-layout">
          <section class="inbox-list-pane" aria-labelledby="inbox-list-title">
            <h2 class="visually-hidden" id="inbox-list-title">Conversations</h2>
            <div data-inbox-list>${listMarkup(ctx, data)}</div>
          </section>
          <section class="inbox-thread-pane" data-thread-pane${open ? '' : raw(' aria-label="Conversation"')}>${open ? threadMarkup(ctx, data) : placeholderMarkup()}</section>
        </div>`}
    </section>`;
  },

  mount(el, ctx, data) {
    const { api, store, router } = ctx;
    const open = data.open?.state === 'ready' ? data.open : null;
    const removers = [];
    let alive = true;

    // --- The list -------------------------------------------------------------------------
    // Without any conversation the page has no list pane, only the empty state with its suggestions.
    const bare = !data.inbox.length && !data.open;
    const listEl = bare ? null : el.querySelector('[data-inbox-list]');

    function paintList() {
      if (!listEl || !alive) return;
      const focused = el.ownerDocument.activeElement?.closest?.('[data-thread]')?.dataset.thread;
      listEl.innerHTML = listMarkup(ctx, data).value;
      if (focused) listEl.querySelector(`[data-thread="${focused}"]`)?.focus();
    }

    // Brings the list in line with a message that was just sent or received in the open conversation.
    function touchSummary(message) {
      if (!open) return;
      let thread = data.inbox.find(row => sameThread(row, open));
      if (!thread) {
        thread = { creatorId: open.creatorId, memberId: open.memberId, creator: open.creator, member: open.member, lastBody: '', lastSender: message.from, lastAt: message.date, unread: 0 };
        data.inbox.unshift(thread);
      }
      if (Date.parse(message.date) >= Date.parse(thread.lastAt) || !thread.lastBody) {
        Object.assign(thread, { lastBody: message.text, lastSender: message.from, lastAt: message.date });
      }
      thread.unread = 0;
      data.inbox.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
      paintList();
    }

    const refreshInbox = debounce(async () => {
      try {
        const next = await api.inbox();
        if (!alive) return;
        data.inbox = next;
        if (open) for (const thread of data.inbox) if (sameThread(thread, open)) thread.unread = 0;
        paintList();
      } catch { /* the list refreshes on the next visit */ }
    }, 250);

    if (listEl) {
      removers.push(delegate(el, 'click', '[data-more]', () => {
        const first = data.visible;
        data.visible += PAGE;
        paintList();
        listEl.querySelectorAll('.inbox-item')[first]?.focus();
      }));
    }

    // --- Reading state ---------------------------------------------------------------------
    async function markRead() {
      if (!open) return;
      try {
        await api.markThreadRead(open.creatorId, open.memberId);
      } catch {
        return; // not worth a message: the thread stays unread and is tried again on the next visit
      }
      if (alive) {
        for (const thread of data.inbox) if (sameThread(thread, open)) thread.unread = 0;
        paintList();
      }
      store.refreshUnread();
    }

    if (!open) {
      removers.push(store.onRealtime(event => {
        if (event.type !== 'message' || !event.payload) return;
        if (bare) ctx.reload(); else refreshInbox();
      }));
      return () => { alive = false; refreshInbox.cancel(); removers.splice(0).forEach(remove => remove()); };
    }

    // --- The open conversation --------------------------------------------------------------
    const draftKey = `${data.me}:${open.creatorId}:${open.memberId}`;
    const log = el.querySelector('#thread-log');
    const foot = el.querySelector('#thread-foot');
    const jump = el.querySelector('[data-jump]');
    const field = () => el.querySelector('#compose-text');
    const sendButton = () => el.querySelector('[data-send]');
    let local = 0;
    let chain = Promise.resolve();
    let shownFoot = foot.dataset.foot;

    const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const toBottom = () => { log.scrollTop = log.scrollHeight; jump.hidden = true; };

    function paintLog({ stick } = {}) {
      if (!alive) return;
      const stay = stick ?? nearBottom();
      log.innerHTML = logMarkup(ctx, data).value;
      if (stay) toBottom();
      paintFoot();
    }

    function syncComposer() {
      const input = field();
      if (!input) return;
      const text = input.value;
      const button = sendButton();
      if (button && !button.dataset.busy) button.disabled = !text.trim();
      const count = el.querySelector('[data-count]');
      if (count) count.textContent = text.length >= COUNTER_FROM ? `${text.length} / ${MAX_LENGTH}` : '';
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight || 0, 180)}px`;
    }

    // The footer changes kind when the owner receives the first message of a thread.
    function paintFoot() {
      const kind = footKind(open);
      if (kind === shownFoot) return;
      shownFoot = kind;
      foot.dataset.foot = kind;
      foot.innerHTML = footMarkup(ctx, data).value;
      restoreDraft();
    }

    function restoreDraft() {
      const input = field();
      if (!input) return;
      input.value = drafts.get(draftKey) ?? '';
      syncComposer();
    }

    function addMessage(message) {
      if (open.messages.some(known => known.id === message.id)) return false;
      open.messages.push(message);
      open.messages.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
      return true;
    }

    // Our own message can come back through the live channel before the request that sent it has answered.
    function adoptEcho(message) {
      const index = open.pending.findIndex(item => item.state === 'sending' && item.text === message.text);
      if (index >= 0) open.pending.splice(index, 1);
    }

    async function deliver(item) {
      if (!alive) return;
      try {
        const message = await api.sendMessage(open.creatorId, open.memberId, open.role, item.text);
        open.pending = open.pending.filter(other => other !== item);
        if (!alive) return;
        addMessage(message);
        touchSummary(message);
        paintLog({ stick: true });
      } catch (error) {
        item.state = 'failed';
        item.error = error?.message || 'Your message could not be sent.';
        if (!alive) return;
        paintLog({ stick: true });
        toast(item.error, { tone: 'error' });
      }
    }

    // Shown at once; the requests go one after the other so that the messages keep their order.
    function send(text, again) {
      const item = again ?? { key: `local-${++local}`, from: open.role, text, date: new Date().toISOString(), state: 'sending', error: '' };
      item.state = 'sending';
      item.error = '';
      if (!again) open.pending.push(item);
      paintLog({ stick: true });
      chain = chain.then(() => deliver(item));
    }

    function submit() {
      const input = field();
      if (!input) return;
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      if (text.length > MAX_LENGTH) { toast(`Messages can be up to ${MAX_LENGTH.toLocaleString('en')} characters.`, { tone: 'error' }); return; }
      input.value = '';
      drafts.delete(draftKey);
      syncComposer();
      send(text);
      input.focus();
    }

    removers.push(
      delegate(el, 'input', '#compose-text', (event, input) => {
        if (input.value) drafts.set(draftKey, input.value); else drafts.delete(draftKey);
        syncComposer();
      }),
      delegate(el, 'keydown', '#compose-text', event => {
        if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
        event.preventDefault();
        submit();
      }),
      delegate(el, 'submit', '#thread-form', event => { event.preventDefault(); submit(); }),
      delegate(el, 'click', '[data-resend]', (event, control) => {
        const item = open.pending.find(other => other.key === control.dataset.resend);
        if (item && item.state === 'failed') send(null, item);
      }),
      // A message that did not go through goes back into the box, so nothing typed is lost.
      delegate(el, 'click', '[data-edit-failed]', (event, control) => {
        const item = open.pending.find(other => other.key === control.dataset.editFailed);
        const input = field();
        if (!item || !input) return;
        open.pending = open.pending.filter(other => other !== item);
        input.value = input.value.trim() ? `${item.text}\n${input.value}` : item.text;
        drafts.set(draftKey, input.value);
        paintLog({ stick: true });
        syncComposer();
        input.focus();
      }),
      delegate(el, 'click', '[data-jump]', () => { toBottom(); field()?.focus(); })
    );
    const onScroll = () => { if (nearBottom()) jump.hidden = true; };
    log.addEventListener('scroll', onScroll, { passive: true });
    removers.push(() => log.removeEventListener('scroll', onScroll));

    // A message that was typed and not delivered would be lost on leaving: ask first.
    router.block = () => (open.pending.length ? 'A message has not been sent yet. If you leave now it will be lost.' : null);

    // --- Live -------------------------------------------------------------------------------
    removers.push(store.onRealtime(event => {
      if (event.type !== 'message' || !event.payload?.id) return;
      const message = event.payload;
      if (message.creatorId !== open.creatorId || message.memberId !== open.memberId) { refreshInbox(); return; }
      const fromOther = message.from !== open.role;
      const stay = nearBottom();
      if (!fromOther) adoptEcho(message);
      const added = addMessage(message);
      if (!added) return;
      touchSummary(message);
      paintLog({ stick: stay || !fromOther });
      if (fromOther) {
        if (!stay) jump.hidden = false;
        markRead();
      }
    }));

    // --- First paint ------------------------------------------------------------------------
    restoreDraft();
    toBottom();
    const unreadHere = data.inbox.find(thread => sameThread(thread, open))?.unread > 0
      || open.messages.some(message => message.from !== open.role && !message.readAt);
    if (unreadHere) markRead();

    return () => {
      alive = false;
      refreshInbox.cancel();
      removers.splice(0).forEach(remove => remove());
    };
  }
};
