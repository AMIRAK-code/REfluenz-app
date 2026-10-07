// The conversation under a post: a flat list of comments with one level of replies, written, edited, deleted and
// reported in place. The list is drawn by this module alone (the page around it is never redrawn), so a film keeps
// playing and nothing typed is lost when something else changes. Comments are shown only for readable, published posts.

import { avatar, badge, confirmDialog, delegate, emptyState, html, setBusy, skeleton, toast } from '../../core/ui.js';
import { formatDate, plural, timeAgo } from '../../core/format.js';
import { paths } from '../../core/paths.js';
import { cleanComment } from '../../api/util.js';
import { openReport } from './actions.js';
import { failureState } from './states.js';

export const COMMENT_MAX = 2000;
export const PAGE = 20; // conversations shown at first and added by "Show more comments"
const LEAVE_MESSAGE = 'You have a comment that has not been posted. Leave this page and discard it?';

// --- Threading --------------------------------------------------------------------

// Top-level comments oldest first, each with its replies oldest first. A reply whose parent is gone, or that points at
// another reply, is attached to the nearest comment that is shown, so nothing a person wrote disappears from the page.
export function thread(list) {
  const byId = new Map(list.map(comment => [comment.id, comment]));
  const roots = [];
  const replies = new Map();
  const attach = (rootId, comment) => replies.set(rootId, [...(replies.get(rootId) ?? []), comment]);
  const sorted = [...list].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const comment of sorted) {
    let parent = comment.parentId ? byId.get(comment.parentId) : null;
    if (parent?.parentId) parent = byId.get(parent.parentId) ?? null;
    if (parent && !parent.parentId) attach(parent.id, comment);
    else roots.push(comment);
  }
  return { roots, replies };
}

// --- Markup (the section around the list is drawn with the page) -------------------

const composer = () => html`<form class="post-comment-form" data-comment-form data-mode="new" novalidate>
  <label for="comment-body">Add a comment</label>
  <textarea id="comment-body" name="body" rows="3" maxlength="${COMMENT_MAX}" placeholder="What stayed with you?"></textarea>
  <p class="form-error" data-form-error></p>
  <div class="post-comment-foot">
    <span class="muted post-comment-hint">Ctrl or Cmd + Enter posts</span>
    <span class="muted count" data-counter>0 / ${COMMENT_MAX}</span>
    <button type="submit" class="button small">Post comment</button>
  </div>
</form>`;

const guestPrompt = ctx => {
  const here = `${ctx.path}`;
  return html`<p class="post-comment-guest"><a class="text-link" href="${paths.login(here)}">Sign in</a> to join the conversation. <a href="${paths.signup(here)}">Create a free account</a> if you are new here.</p>`;
};

export function commentsSection(ctx, data) {
  const signedIn = Boolean(ctx.store.state.user);
  return html`<section class="section post-comments" id="comments" aria-labelledby="comments-title" data-comments>
    <div class="section-head"><h2 id="comments-title" tabindex="-1">Comments</h2><span class="muted" data-comments-count role="status"></span></div>
    ${signedIn ? composer() : guestPrompt(ctx)}
    <div class="post-comments-body" data-comments-body>${skeleton('text', 3)}</div>
  </section>`;
}

// --- Mounting ----------------------------------------------------------------------

export function mountComments(root, ctx, data) {
  const section = root.querySelector('[data-comments]');
  if (!section) return () => {};
  const { api, store } = ctx;
  const { entry } = data;
  const list = section.querySelector('[data-comments-body]');
  const count = section.querySelector('[data-comments-count]');
  const mainField = section.querySelector('#comment-body');

  let alive = true;
  let comments = [];
  let status = 'loading'; // 'loading' | 'ready' | 'error'
  let failure = null;
  let visible = PAGE;
  let open = null; // the one reply or edit form that is open: {mode: 'reply' | 'edit', id}
  const drafts = new Map(); // what was typed in the forms that are closed or redrawn, by 'reply:<id>' / 'edit:<id>'

  const viewer = () => store.state.user?.id ?? null;
  const ownsPost = () => Boolean(store.state.myCreator) && store.state.myCreator.id === entry.creatorId;
  const find = id => comments.find(comment => comment.id === id);

  // --- Unsaved work ---

  const dirty = () => Boolean(mainField?.value.trim())
    || [...drafts].some(([key, text]) => (key.startsWith('edit:') ? text.trim() && text !== find(key.slice(5))?.body : text.trim()));
  ctx.router.block = () => (dirty() ? LEAVE_MESSAGE : null);

  // --- Drawing ---

  const authorName = comment => comment.author?.name || 'Member';

  const action = (name, id, label, text, extra = '') => html`<button type="button" class="post-comment-action" data-comment-action="${name}" data-id="${id}" aria-label="${label}"${extra && html` ${extra}`}>${text}</button>`;

  function form(mode, comment) {
    const key = `${mode}:${comment.id}`;
    const text = drafts.get(key) ?? (mode === 'edit' ? comment.body : '');
    const label = mode === 'edit' ? 'Edit your comment' : `Reply to ${authorName(comment)}`;
    return html`<form class="post-comment-form is-inline" data-comment-form data-mode="${mode}" data-target="${comment.id}" novalidate>
      <label class="visually-hidden" for="comment-${mode}-${comment.id}">${label}</label>
      <textarea id="comment-${mode}-${comment.id}" name="body" rows="3" maxlength="${COMMENT_MAX}">${text}</textarea>
      <p class="form-error" data-form-error></p>
      <div class="post-comment-foot">
        <span class="muted count" data-counter>${text.length} / ${COMMENT_MAX}</span>
        <span class="post-comment-buttons">
          <button type="button" class="button ghost small" data-comment-action="cancel" data-id="${comment.id}">Cancel</button>
          <button type="submit" class="button small">${mode === 'edit' ? 'Save changes' : 'Reply'}</button>
        </span>
      </div>
    </form>`;
  }

  function item(comment, replies = [], isReply = false) {
    const mine = viewer() !== null && comment.author?.id === viewer();
    const editing = open?.mode === 'edit' && open.id === comment.id;
    const replying = open?.mode === 'reply' && open.id === comment.id;
    const name = authorName(comment);
    const byCreator = Boolean(data.creator?.ownerId) && comment.author?.id === data.creator.ownerId;
    return html`<li class="post-comment${isReply ? ' is-reply' : ''}" id="comment-${comment.id}" data-comment="${comment.id}" tabindex="-1">
      <div class="post-comment-head">
        ${avatar(comment.author, { size: 32 })}
        <p class="post-comment-meta"><strong class="post-comment-author">${name}</strong>${byCreator && badge('Author', 'accent')}<time datetime="${comment.createdAt}" title="${formatDate(comment.createdAt, { year: true })}">${timeAgo(comment.createdAt)}</time>${comment.editedAt && html`<span class="muted">edited</span>`}</p>
      </div>
      ${editing ? form('edit', comment) : html`<p class="post-comment-body">${comment.body}</p>`}
      ${!editing && html`<div class="post-comment-actions">
        ${action('reply', comment.id, `Reply to ${name}`, 'Reply', html`aria-expanded="${String(replying)}"`)}
        ${mine && action('edit', comment.id, 'Edit your comment', 'Edit')}
        ${(mine || ownsPost()) && action('delete', comment.id, mine ? 'Delete your comment' : `Delete the comment by ${name}`, 'Delete')}
        ${!mine && action('report', comment.id, `Report the comment by ${name}`, 'Report')}
      </div>`}
      ${replying && form('reply', comment)}
      ${replies.length > 0 && html`<ol class="post-comment-replies">${replies.map(reply => item(reply, [], true))}</ol>`}
    </li>`;
  }

  function listMarkup() {
    if (status === 'loading') return skeleton('text', 3);
    if (status === 'error') return failureState(failure, { title: 'We could not load the comments', attr: 'data-comments-retry' });
    if (!comments.length) {
      return html`<div class="post-comments-empty">${emptyState({ icon: 'message', title: 'No comments yet', text: viewer() ? 'Be the first to say what this post made you think of.' : 'Sign in to start the conversation.' })}</div>`;
    }
    const { roots, replies } = thread(comments);
    const more = roots.length - visible;
    return html`<ol class="post-comment-list">${roots.slice(0, visible).map(comment => item(comment, replies.get(comment.id)))}</ol>${more > 0 && html`<button type="button" class="button secondary post-comments-more" data-comment-action="more">Show more comments (${more} more)</button>`}`;
  }

  // Redraws the list. `focus` is the id of the element that should take focus afterwards.
  function paint({ focus } = {}) {
    if (!alive) return;
    count.textContent = status === 'ready' && comments.length ? plural(comments.length, 'comment') : '';
    list.innerHTML = listMarkup().value;
    if (focus) {
      const target = section.ownerDocument.getElementById(focus);
      target?.focus?.({ preventScroll: false });
      if (target?.localName === 'textarea') target.setSelectionRange?.(target.value.length, target.value.length);
    }
  }

  async function load() {
    status = 'loading';
    paint();
    try {
      const result = await api.listComments(entry.id);
      if (!alive) return;
      comments = Array.isArray(result) ? result : [];
      status = 'ready';
    } catch (error) {
      if (!alive) return;
      failure = error;
      status = 'error';
    }
    paint();
  }

  // --- Writing ---

  const setError = (form, message) => {
    const slot = form.querySelector('[data-form-error]');
    if (slot) slot.textContent = message;
  };

  async function submit(form) {
    const field = form.querySelector('[name="body"]');
    const button = form.querySelector('[type="submit"]');
    if (!field || button?.dataset.busy) return;
    const { mode, target } = form.dataset;
    let text;
    try {
      text = cleanComment(field.value);
    } catch (error) {
      setError(form, error.message);
      field.focus();
      return;
    }
    setError(form, '');
    if (!store.requireAuth('Sign in to join the conversation.')) return;
    if (mode === 'edit' && text === find(target)?.body) {
      cancel(target);
      return;
    }
    setBusy(button, true);
    try {
      if (mode === 'edit') {
        const updated = await api.editComment(target, text);
        if (!alive) return;
        comments = comments.map(comment => (comment.id === target ? updated : comment));
        drafts.delete(`edit:${target}`);
        open = null;
        paint({ focus: `comment-${target}` });
        toast('Your comment is updated.', { tone: 'success' });
      } else {
        const created = await api.addComment(entry.id, text, mode === 'reply' ? target : null);
        if (!alive) return;
        comments = [...comments, created];
        visible = Math.max(visible, thread(comments).roots.length);
        if (mode === 'reply') {
          drafts.delete(`reply:${target}`);
          open = null;
          paint({ focus: `comment-${created.id}` });
        } else {
          field.value = '';
          form.querySelector('[data-counter]').textContent = `0 / ${COMMENT_MAX}`;
          paint({ focus: `comment-${created.id}` });
        }
        toast(mode === 'reply' ? 'Your reply is posted.' : 'Your comment is posted.', { tone: 'success' });
      }
    } catch (error) {
      if (!alive) return;
      const message = error?.message || 'We could not save your comment. Try again.';
      setError(form, message);
      toast(message, { tone: 'error' });
    } finally {
      setBusy(button, false);
    }
  }

  function cancel(id) {
    if (!open) return;
    const returnTo = `comment-${id}`;
    drafts.delete(`${open.mode}:${open.id}`);
    open = null;
    paint({ focus: returnTo });
  }

  function openForm(mode, id) {
    if (mode === 'reply' && !store.requireAuth('Sign in to reply to this comment.')) return;
    if (open?.mode === mode && open.id === id) {
      // A second press on Reply closes the form and keeps what was typed for later.
      if (mode === 'reply') {
        open = null;
        paint({ focus: `comment-${id}` });
      } else document.getElementById(`comment-${mode}-${id}`)?.focus();
      return;
    }
    open = { mode, id };
    paint({ focus: `comment-${mode}-${id}` });
  }

  async function remove(id, control) {
    const comment = find(id);
    if (!comment) return;
    const hasReplies = comments.some(other => other.parentId === id);
    const confirmed = await confirmDialog({
      title: 'Delete this comment?',
      text: hasReplies ? 'Its replies are removed with it. This cannot be undone.' : 'This cannot be undone.',
      confirmLabel: 'Delete comment',
      tone: 'danger'
    });
    if (!confirmed || !alive) return;
    setBusy(control, true);
    try {
      await api.deleteComment(id);
      if (!alive) return;
      comments = comments.filter(other => other.id !== id && other.parentId !== id);
      for (const key of [...drafts.keys()]) if (key.endsWith(`:${id}`)) drafts.delete(key);
      if (open?.id === id) open = null;
      paint();
      section.querySelector('#comments-title')?.focus?.();
      toast('The comment is deleted.', { tone: 'success' });
    } catch (error) {
      toast(error?.message || 'We could not delete the comment. Try again.', { tone: 'error' });
    } finally {
      setBusy(control, false);
    }
  }

  // --- Events ---

  const offs = [
    delegate(section, 'submit', '[data-comment-form]', (event, form) => {
      event.preventDefault();
      submit(form);
    }),
    delegate(section, 'keydown', '[data-comment-form] textarea', (event, field) => {
      const form = field.closest('[data-comment-form]');
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submit(form);
      } else if (event.key === 'Escape' && form.dataset.mode !== 'new') {
        event.preventDefault();
        event.stopPropagation();
        cancel(form.dataset.target);
      }
    }),
    delegate(section, 'input', '[data-comment-form] textarea', (event, field) => {
      const form = field.closest('[data-comment-form]');
      const counter = form.querySelector('[data-counter]');
      if (counter) counter.textContent = `${field.value.length} / ${COMMENT_MAX}`;
      if (form.dataset.mode !== 'new') drafts.set(`${form.dataset.mode}:${form.dataset.target}`, field.value);
      setError(form, '');
    }),
    delegate(section, 'click', '[data-comments-retry]', () => load()),
    delegate(section, 'click', '[data-comment-action]', (event, control) => {
      event.preventDefault();
      const { id } = control.dataset;
      switch (control.dataset.commentAction) {
        case 'reply': openForm('reply', id); break;
        case 'edit': openForm('edit', id); break;
        case 'cancel': cancel(id); break;
        case 'delete': remove(id, control); break;
        case 'report': openReport(ctx, { targetType: 'comment', targetId: id, subject: 'comment' }); break;
        case 'more':
          visible += PAGE;
          paint();
          break;
        default: break;
      }
    }),
    // Someone commented or replied while this page is open: read the list again, unless a form is being written in.
    store.onRealtime(async event => {
      const row = event.payload;
      if (event.type !== 'notification' || row?.entry?.id !== entry.id || !['comment', 'reply'].includes(row.type)) return;
      if (status !== 'ready' || list.contains(section.ownerDocument.activeElement)) return;
      try {
        const next = await api.listComments(entry.id);
        if (!alive || list.contains(section.ownerDocument.activeElement)) return;
        comments = Array.isArray(next) ? next : comments;
        paint();
      } catch { /* the list is read again on the next visit */ }
    })
  ];

  load();

  return () => {
    alive = false;
    offs.forEach(off => off());
  };
}
