// Your memberships: /app/memberships (docs/ARCHITECTURE.md section 3). Every circle you belong to, at which tier, since when,
// what it will cost once payments launch, and the ways to manage or leave it.
//
// The api returns the whole list, so it is paged here: the first rows, then "Show more".

import { avatar, button, confirmDialog, delegate, emptyState, html, setBusy, toast } from '../core/ui.js';
import { formatDate, money, plural } from '../core/format.js';
import { paths } from '../core/paths.js';

const PAGE = 20;
const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError, RangeError];
const messageOf = (error, fallback) => (PROGRAMMING_ERRORS.some(type => error instanceof type) ? fallback : error?.message || fallback);

// What the circles will cost per month once payments launch, one amount per currency: "€28" or "€28 + US$12".
function monthlyTotal(items) {
  const totals = new Map();
  for (const membership of items) {
    const tier = membership.tier;
    if (!tier || !Number.isFinite(Number(tier.priceCents))) continue;
    const currency = tier.currency || 'EUR';
    totals.set(currency, (totals.get(currency) || 0) + Number(tier.priceCents));
  }
  return [...totals].map(([currency, cents]) => money(cents, currency)).join(' + ') || money(0);
}

function rowOf(membership) {
  const { creator, tier } = membership;
  const name = creator?.name || 'This atelier';
  const href = creator?.slug ? paths.creator(creator.slug) : paths.discover();
  const line = [creator?.descriptor || creator?.category, creator?.location].filter(Boolean).join(' · ');
  return html`<li class="membership-row" data-membership="${membership.creatorId}">
    <a class="membership-avatar" href="${href}" tabindex="-1" aria-hidden="true">${avatar(creator || { name }, { size: 56 })}</a>
    <div class="membership-main">
      <h2><a href="${href}">${name}</a></h2>
      ${line && html`<p class="eyebrow muted">${line}</p>`}
      <p class="membership-tier"><strong>${tier?.name || 'Member'}</strong> <span class="muted">· ${money(tier?.priceCents ?? 0, tier?.currency)} / month once payments launch</span></p>
      <p class="membership-since muted">Member since ${formatDate(membership.createdAt, { year: true })}. Free during early access.</p>
    </div>
    <div class="membership-actions">
      ${creator?.slug && button('Manage', { variant: 'secondary', size: 'small', href: paths.creator(creator.slug, { tab: 'membership' }), attrs: { 'aria-label': `Manage your membership at ${name}` } })}
      ${button('Leave', { variant: 'ghost', size: 'small', attrs: { 'data-leave': membership.creatorId, 'aria-label': `Leave ${name}’s circle` } })}
    </div>
  </li>`;
}

export default {
  title: 'Memberships',
  auth: 'required',

  async load(ctx) {
    const items = await ctx.api.myMemberships();
    return { items: Array.isArray(items) ? items : [], shown: PAGE };
  },

  render(ctx, data) {
    const { items } = data;
    const visible = items.slice(0, data.shown);
    const left = items.length - visible.length;
    return html`<section class="page memberships" aria-labelledby="memberships-heading">
      <header class="page-head">
        <div>
          <p class="eyebrow muted">Your circles</p>
          <h1 id="memberships-heading" tabindex="-1">Memberships</h1>
          <p class="page-sub">The creators you belong to. Memberships are free during early access; prices show what each tier will cost once payments launch.</p>
        </div>
      </header>
      ${items.length === 0
        ? emptyState({ icon: 'members', title: 'A circle starts with one connection', text: 'Join a creator’s circle to read their members’ posts and take part. It is free during early access.', action: { label: 'Discover creators', href: paths.discover() } })
        : html`<div class="membership-summary" role="group" aria-label="Summary">
            <div><p class="eyebrow muted">Circles</p><p class="membership-figure" data-summary="count">${plural(items.length, 'circle')}</p></div>
            <div><p class="eyebrow muted">Monthly total once payments launch</p><p class="membership-figure" data-summary="total">${monthlyTotal(items)} <span class="muted">/ month</span></p><p class="muted membership-free">Nothing is charged during early access.</p></div>
          </div>
          <ul class="membership-list" aria-label="Your memberships">${visible.map(rowOf)}</ul>
          ${left > 0 && html`<div class="membership-more">${button(`Show more (${left})`, { variant: 'secondary', attrs: { id: 'memberships-more', 'data-action': 'more' } })}</div>`}`}
    </section>`;
  },

  mount(el, ctx, data) {
    const { store } = ctx;

    async function leave(control) {
      const membership = data.items.find(item => item.creatorId === control.dataset.leave);
      if (!membership) return;
      const name = membership.creator?.name || 'this atelier';
      const confirmed = await confirmDialog({
        title: `Leave ${name}’s circle?`,
        text: 'You will lose access to posts that are for members. You can rejoin whenever you like; it is free during early access.',
        confirmLabel: 'Leave circle',
        tone: 'danger'
      });
      if (!confirmed) return;
      setBusy(control, true);
      try {
        await store.leave(membership.creatorId);
      } catch (error) {
        setBusy(control, false);
        toast(messageOf(error, 'We could not update your membership. Try again.'), { tone: 'error' });
        return;
      }
      toast(`You have left ${name}’s circle.`, { tone: 'success' });
      ctx.rerender({ ...data, items: data.items.filter(item => item !== membership) });
      el.querySelector('#memberships-heading')?.focus();
    }

    const removers = [
      delegate(el, 'click', '[data-leave]', (event, control) => { event.preventDefault(); leave(control); }),
      delegate(el, 'click', '[data-action="more"]', () => {
        const before = Math.min(data.shown, data.items.length);
        ctx.rerender({ ...data, shown: data.shown + PAGE });
        el.querySelectorAll('.membership-row')[before]?.querySelector('h2 a')?.focus();
      })
    ];
    return () => { for (const remove of removers) remove(); };
  }
};
