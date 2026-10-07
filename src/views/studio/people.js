// The Members and Notes tabs of the studio. Markup only; the view owns the data and the events.

import { avatar, badge, button, emptyState, errorState, html, icon, skeleton } from '../../core/ui.js';
import { formatDate, plural, timeAgo } from '../../core/format.js';
import { paths } from '../../core/paths.js';

export const MEMBER_PAGE = 25;
export const NOTE_PAGE = 10;
export const NOTE_MAX = 2000;

// --- Members -------------------------------------------------------------------

// members: {items, query, tier}. Search by name, filter by tier.
export function filterMembers({ items, query = '', tier = '' }) {
  const needle = query.trim().toLowerCase();
  return items.filter(entry => (!tier || entry.tier?.id === tier) && (!needle || String(entry.member?.name || '').toLowerCase().includes(needle)));
}

// The tiers present in the circle, lowest first, as <option>s ("All tiers" first).
export function tierOptions(members) {
  const tiers = [];
  for (const entry of members.items) if (entry.tier && !tiers.some(tier => tier.id === entry.tier.id)) tiers.push(entry.tier);
  tiers.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  return html`<option value="">All tiers</option>${tiers.map(tier => html`<option value="${tier.id}"${tier.id === members.tier ? ' selected' : ''}>${tier.name}</option>`)}`;
}

// The controls above the list. They are drawn once per visit to the tab, so typing in the search box is never interrupted.
export function renderMemberTools(members) {
  return html`<div class="studio-tools">
    <div class="field studio-search"><label for="studio-member-search">Search members</label><input id="studio-member-search" type="search" name="q" data-member-search value="${members.query}" placeholder="Search by name" autocomplete="off" maxlength="80"></div>
    <div class="field studio-tier-filter"><label for="studio-member-tier">Tier</label><select id="studio-member-tier" name="tier" data-member-tier>${tierOptions(members)}</select></div>
    <div class="studio-export">${button('Export CSV', { variant: 'secondary', icon: 'export', attrs: { 'data-export-members': true, disabled: members.status !== 'ready' || members.items.length === 0 } })}</div>
  </div>`;
}

export function memberRow(entry) {
  return html`<li class="studio-member">${avatar(entry.member, { size: 40 })}<div class="studio-member-name"><strong>${entry.member?.name || 'Member'}</strong><span class="muted">Joined ${formatDate(entry.joinedAt)}</span></div>${badge(entry.tier?.name || 'Member', 'neutral')}</li>`;
}

export function renderMembers(members, { retry, creator } = {}) {
  if (members.status === 'error') return errorState(members.error, { retry, title: 'We could not load your circle' });
  if (members.status !== 'ready') return skeleton('list', 4);
  if (members.items.length === 0) {
    return emptyState({
      icon: 'members',
      title: 'Your circle is forming',
      text: 'People who join one of your tiers appear here, with the tier they chose. Joining is free during early access.',
      action: button('View your public page', { variant: 'secondary', href: paths.creator(creator.slug) })
    });
  }
  const matches = filterMembers(members);
  if (matches.length === 0) {
    return html`<div class="empty"><h3>No one matches</h3><p>Try another name, or choose all tiers.</p></div>`;
  }
  const shown = matches.slice(0, members.shown);
  const rest = matches.length - shown.length;
  return html`<ul class="studio-members">${shown.map(memberRow)}</ul>
    <p class="studio-list-foot muted">${rest > 0 ? `Showing ${shown.length} of ${plural(matches.length, 'member')}` : plural(matches.length, 'member')}${matches.length !== members.items.length ? ` of ${members.items.length} in your circle` : ''}</p>
    ${rest > 0 && html`<div class="studio-more">${button('Show more', { variant: 'secondary', attrs: { 'data-more-members': true } })}</div>`}`;
}

// What a screen reader hears when the filter changes.
export function memberStatus(members) {
  if (members.status !== 'ready') return '';
  const total = filterMembers(members).length;
  return total === 0 ? 'No members match.' : `${plural(total, 'member')} shown.`;
}

// --- Notes ---------------------------------------------------------------------

export function renderNoteForm(notes) {
  return html`<form class="studio-note-form" data-note-form novalidate aria-labelledby="studio-note-title">
    <h3 id="studio-note-title" class="eyebrow">A note to your circle</h3>
    <p class="muted studio-hint">A small update, a question, a new direction. Followers and members are notified when you post one.</p>
    <div class="field">
      <label for="studio-note-text">Your note</label>
      <textarea id="studio-note-text" name="note" maxlength="${NOTE_MAX}" rows="4" data-note-text aria-describedby="studio-note-count studio-note-error" placeholder="What is on your mind?">${notes.draft}</textarea>
      <div class="studio-note-foot"><p class="field-help" id="studio-note-count" data-note-count>${notes.draft.length.toLocaleString('en')} / ${NOTE_MAX.toLocaleString('en')}</p></div>
      <p class="field-error" id="studio-note-error" data-note-error role="alert">${notes.formError}</p>
    </div>
    <div class="form-actions">${button('Post note', { type: 'submit', icon: 'send', attrs: { 'data-note-submit': true } })}</div>
  </form>`;
}

export function noteRow(note) {
  return html`<li class="studio-note" data-note-row="${note.id}">
    <p class="studio-note-text">${note.text}</p>
    <div class="studio-note-meta"><span class="muted">${timeAgo(note.date)}</span><button type="button" class="button ghost small" data-delete-note="${note.id}" aria-label="Delete note from ${formatDate(note.date)}">${icon('trash', 14)}<span>Delete</span></button></div>
  </li>`;
}

export function renderNotes(notes, { retry } = {}) {
  if (notes.status === 'error') return errorState(notes.error, { retry, title: 'We could not load your notes' });
  if (notes.status !== 'ready') return skeleton('text', 3);
  if (notes.items.length === 0) {
    return html`<div class="empty"><h3>No notes yet</h3><p>Write one above. It is the quietest way to keep your circle close.</p></div>`;
  }
  const shown = notes.items.slice(0, notes.shown);
  const rest = notes.items.length - shown.length;
  return html`<h3 class="eyebrow studio-notes-title">Your notes</h3>
    <ul class="studio-notes">${shown.map(noteRow)}</ul>
    <p class="studio-list-foot muted">${rest > 0 ? `Showing ${shown.length} of ${plural(notes.items.length, 'note')}` : plural(notes.items.length, 'note')}</p>
    ${rest > 0 && html`<div class="studio-more">${button('Show more', { variant: 'secondary', attrs: { 'data-more-notes': true } })}</div>`}`;
}
