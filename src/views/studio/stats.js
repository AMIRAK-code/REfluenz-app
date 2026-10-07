// The overview of the studio: numbers, members by tier, top posts. Markup only; the view fetches and repaints.

import { errorState, html } from '../../core/ui.js';
import { money, plural } from '../../core/format.js';
import { paths } from '../../core/paths.js';

export const KIND_LABEL = { text: 'Text', image: 'Image', video: 'Video' };

const whole = value => (Number(value) || 0).toLocaleString('en');

function skeleton() {
  const cell = html`<div class="studio-metric"><span class="skeleton-block skeleton-line short"></span><span class="skeleton-block studio-skeleton-number"></span></div>`;
  return html`<div class="studio-metrics" role="status"><span class="visually-hidden">Loading your numbers</span>${Array.from({ length: 8 }, () => cell)}</div>`;
}

const delta = (count, noun) => (count > 0 ? `+${whole(count)} ${noun} in 30 days` : `No new ${noun} in 30 days`);

function metric({ label, value, note, wide = false }) {
  return html`<div class="studio-metric${wide ? ' studio-metric--wide' : ''}"><dt class="eyebrow muted">${label}</dt><dd><strong class="count">${value}</strong>${note && html`<span class="studio-metric-note">${note}</span>`}</dd></div>`;
}

function tiers(stats) {
  const rows = stats.byTier || [];
  const total = rows.reduce((sum, tier) => sum + (Number(tier.members) || 0), 0);
  return html`<section class="studio-block" aria-labelledby="studio-tiers-title">
    <h3 id="studio-tiers-title" class="eyebrow">Members by tier</h3>
    ${rows.length === 0
      ? html`<p class="muted studio-hint">Your tiers appear here once they are set up.</p>`
      : html`<ul class="studio-tiers">${rows.map(tier => {
        const share = total > 0 ? Math.round((tier.members / total) * 100) : 0;
        return html`<li class="studio-tier${tier.enabled === false ? ' is-closed' : ''}">
          <div class="studio-tier-line"><span class="studio-tier-name">${tier.name}${tier.enabled === false && html` <span class="muted">(closed)</span>`}</span><span class="count">${plural(tier.members, 'member')}</span></div>
          <div class="studio-bar" data-share="${share}" aria-hidden="true"><span></span></div>
          <p class="muted studio-tier-price">${money(tier.priceCents)} a month once payments launch</p>
        </li>`;
      })}</ul>`}
    <p class="studio-hint muted">Payments are not live yet: joining is free during early access, so nothing is charged.</p>
  </section>`;
}

function topPosts(stats) {
  const rows = stats.topEntries || [];
  return html`<section class="studio-block" aria-labelledby="studio-top-title">
    <h3 id="studio-top-title" class="eyebrow">Top posts</h3>
    ${rows.length === 0
      ? html`<p class="muted studio-hint">Your most read and most liked posts appear here once you have published.</p>`
      : html`<ol class="studio-top">${rows.map(post => html`<li>
        <a class="studio-top-title" href="${paths.entry(post.id)}">${post.title}</a>
        <span class="muted studio-top-meta">${KIND_LABEL[post.kind] || 'Text'} · ${plural(post.readCount, 'read')} · ${plural(post.likeCount, 'like')} · ${plural(post.commentCount, 'comment')}</span>
      </li>`)}</ol>`}
  </section>`;
}

// stats: {status: 'loading' | 'ready' | 'error', value, error}; retry() asks for the numbers again.
export function renderStats(stats, { retry } = {}) {
  if (stats.status === 'error') return errorState(stats.error, { retry, title: 'We could not load your numbers' });
  if (stats.status !== 'ready') return skeleton();
  const s = stats.value;
  return html`<dl class="studio-metrics">
    ${metric({ label: 'Followers', value: whole(s.followers), note: delta(s.newFollowers30d, 'followers') })}
    ${metric({ label: 'Members', value: whole(s.members), note: delta(s.newMembers30d, 'members') })}
    ${metric({ label: 'Published', value: whole(s.entries), note: s.entries === 1 ? 'post' : 'posts' })}
    ${metric({ label: 'Drafts', value: whole(s.drafts), note: 'Only visible to you' })}
    ${metric({ label: 'Reads', value: whole(s.reads), note: 'Counted once per reader' })}
    ${metric({ label: 'Likes', value: whole(s.likes), note: 'Across all posts' })}
    ${metric({ label: 'Comments', value: whole(s.comments), note: 'Across all posts' })}
    ${metric({ label: 'Monthly value', value: money(s.monthlyValueCents), note: 'Once payments launch. Joining is free during early access.', wide: true })}
  </dl>
  <div class="studio-columns">${tiers(s)}${topPosts(s)}</div>`;
}

// The bars are sized from script (a style attribute would be blocked by the content security policy).
export function paintBars(root) {
  for (const bar of root.querySelectorAll('.studio-bar[data-share]')) bar.style.setProperty('--share', `${Number(bar.dataset.share) || 0}%`);
}
