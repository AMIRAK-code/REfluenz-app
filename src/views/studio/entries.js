// The Published and Drafts lists of the studio. Markup only; the view owns the data and the events.

import { badge, button, emptyState, errorState, html, icon, kindBadge, raw, skeleton } from '../../core/ui.js';
import { coverFor } from '../../core/covers.js';
import { formatDate, entrySize, kindOf, plural, timeAgo } from '../../core/format.js';
import { paths } from '../../core/paths.js';
import { TIER_NAMES } from '../../core/constants.js';
import { KIND_LABEL } from './stats.js';

// Who can read a post, in the creator's own tier names once their numbers are known.
export function accessLabel(access, stats) {
  if (!access || access === 'public') return 'Open to everyone';
  const name = stats?.byTier?.find(tier => tier.tierId === access)?.name || TIER_NAMES[access] || 'Members';
  return `${name} and above`;
}

function thumb(entry, store) {
  const cover = coverFor(entry, store);
  const frame = cover.state === 'preview' ? ' is-preview' : cover.state === 'preset' ? ' is-preset' : '';
  return html`<a class="studio-thumb${frame}" href="${paths.entry(entry.id)}" tabindex="-1" aria-hidden="true"><img src="${cover.src}" alt="" loading="lazy" decoding="async"${cover.hydrate && html` data-cover="${entry.id}"`}${cover.hydrate && cover.state === 'media' && raw(' data-cover-ready="1"')}>${kindBadge(entry)}</a>`;
}

export function entryRow(entry, stats, store) {
  const draft = entry.status === 'draft';
  const kind = kindOf(entry);
  const meta = [entry.format, entrySize(entry)].filter(Boolean).join(' · ');
  const when = draft ? `Edited ${timeAgo(entry.updatedAt || entry.createdAt)}` : `Published ${formatDate(entry.publishedAt || entry.date)}`;
  return html`<li class="studio-entry" data-entry-row="${entry.id}">
    ${thumb(entry, store)}
    <div class="studio-entry-body">
      <p class="eyebrow muted">${meta || KIND_LABEL[kind]}</p>
      <h3 class="studio-entry-title"><a href="${paths.entry(entry.id)}">${entry.title}</a></h3>
      <p class="studio-entry-flags">${badge(KIND_LABEL[kind])}${draft && badge('Draft', 'accent')}</p>
      <p class="studio-entry-meta muted"><span>${when}</span><span data-access="${entry.access}">${accessLabel(entry.access, stats)}</span>${!draft && html`<span>${plural(entry.readCount, 'read')} · ${plural(entry.likeCount, 'like')} · ${plural(entry.commentCount, 'comment')}</span>`}</p>
    </div>
    <div class="studio-entry-actions">
      <a class="button secondary small" href="${paths.studioEdit(entry.id)}" aria-label="Edit ${entry.title}">${icon('edit', 14)}<span>Edit</span></a>
      <a class="button ghost small" href="${paths.entry(entry.id)}" aria-label="${draft ? 'Preview' : 'View'} ${entry.title}">${icon('eye', 14)}<span>${draft ? 'Preview' : 'View'}</span></a>
      <button type="button" class="button ghost small studio-delete" data-delete-entry="${entry.id}" aria-label="Delete ${entry.title}">${icon('trash', 14)}<span>Delete</span></button>
    </div>
  </li>`;
}

const EMPTY = {
  published: { icon: 'text', title: 'Nothing published yet', text: 'Your first post starts with an observation. Publish it to everyone, or keep it for your circle.' },
  drafts: { icon: 'edit', title: 'No drafts', text: 'Drafts are only visible to you. Start a post and save it for later.' }
};

// list: {status, items, cursor, error, loadingMore, moreError}; the retry handlers are plain markup (data-retry / data-more).
export function renderEntries(kind, list, { stats, retry, store } = {}) {
  if (list.status === 'error') return errorState(list.error, { retry, title: kind === 'drafts' ? 'We could not load your drafts' : 'We could not load your posts' });
  if (list.status !== 'ready') return skeleton('list', 3);
  if (list.items.length === 0) {
    return emptyState({ ...EMPTY[kind], action: button('New text post', { href: paths.studioNew({ kind: 'text' }), icon: 'plus' }) });
  }
  return html`<ul class="studio-entries">${list.items.map(entry => entryRow(entry, stats, store))}</ul>
    <p class="studio-list-foot muted" role="status">${plural(list.items.length, kind === 'drafts' ? 'draft' : 'post')} shown${list.cursor ? '' : '. That is everything.'}</p>
    ${list.moreError && html`<p class="field-error" role="alert">${list.moreError}</p>`}
    ${list.cursor && html`<div class="studio-more">${button(list.moreError ? 'Try again' : 'Load more', { variant: 'secondary', attrs: { 'data-more-entries': kind, ...(list.loadingMore ? { disabled: true, 'aria-busy': 'true' } : {}) } })}</div>`}`;
}
