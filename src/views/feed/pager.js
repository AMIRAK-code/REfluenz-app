// A paged list that lives inside one element of a view: the first page, "Load more", infinite scroll, a skeleton while
// a new first page loads, an inline error with Retry that keeps what is already on screen, and an empty state.
//
//   const pager = createPager({ host, api, store, fetchPage: cursor => api.feed({ cursor }), renderItem: entry => entryCard(entry),
//     renderEmpty: () => emptyState({ ... }), onChange: ({ reason, count, done, empty }) => {} });
//   pager.show(page)      draw a first page that was loaded already ({items, nextCursor})
//   pager.reset()         load the first page again (skeleton, then the list or an error with Retry)
//   pager.remove(id)      drop one item (the library's "Remove")
//   pager.destroy()       stop listening; call it from the view's cleanup
// Every item needs a unique `id`. `renderLead(item)` draws the first item of the list on its own, above the grid.

import { button, delegate, errorState, html, infiniteScroll, skeleton } from '../../core/ui.js';
import { hydrateCovers } from '../../core/covers.js';

const MORE_FAILED = 'We could not load more. Check your connection and try again.';

export function createPager({ host, api, store, fetchPage, renderItem, renderLead, renderEmpty, gridClass = 'grid-cards', hydrate = true, skeletonKind = 'cards', onChange }) {
  let items = [];
  let seen = new Set();
  let cursor = null;
  let pages = 0;
  let loading = false;
  let failure = '';
  let generation = 0; // bumped by reset() and destroy(): an older answer is dropped
  let stopScroll = () => {};
  let destroyed = false;

  const notify = reason => onChange?.({ reason, count: items.length, done: cursor == null, empty: items.length === 0, pages });
  const wrap = item => html`<div class="pager-item" data-pager-item="${item.id}">${renderItem(item)}</div>`;

  // Adds the items that are not on the list yet and returns them.
  function add(list) {
    const fresh = (list || []).filter(item => item && item.id !== undefined && !seen.has(item.id));
    for (const item of fresh) seen.add(item.id);
    items.push(...fresh);
    return fresh;
  }

  const draw = () => {
    const lead = renderLead && items.length ? items[0] : null;
    const rest = lead ? items.slice(1) : items;
    host.innerHTML = html`<div class="pager">
      ${lead && html`<div class="pager-lead" data-pager-lead>${renderLead(lead)}</div>`}
      <div class="${gridClass}" data-pager-items>${rest.map(wrap)}</div>
      <div class="pager-sentinel" data-pager-sentinel></div>
      <div class="pager-foot" data-pager-foot></div>
    </div>`.value;
    paintFoot();
  };

  const hydrateAll = () => {
    if (hydrate) hydrateCovers(host, items, api, store);
  };

  function paintFoot() {
    const foot = host.querySelector('[data-pager-foot]');
    if (!foot) return;
    if (failure) {
      foot.innerHTML = html`<p class="pager-error" role="alert">${failure}</p>${button('Try again', { variant: 'secondary', attrs: { 'data-pager-retry': true } })}`.value;
      return;
    }
    if (cursor != null) {
      // The same button stays in place while loading, so a keyboard user does not lose their spot.
      let more = foot.querySelector('[data-pager-more]');
      if (!more) {
        foot.innerHTML = button('Load more', { variant: 'secondary', attrs: { 'data-pager-more': true } }).value;
        more = foot.querySelector('[data-pager-more]');
      }
      more.setAttribute('aria-busy', String(loading));
      more.setAttribute('aria-disabled', String(loading));
      more.querySelector('span').textContent = loading ? 'Loading' : 'Load more';
      return;
    }
    foot.innerHTML = pages > 1 ? html`<p class="pager-end">You have reached the end.</p>`.value : '';
  }

  function arm() {
    stopScroll();
    stopScroll = () => {};
    const sentinel = host.querySelector('[data-pager-sentinel]');
    if (cursor != null && sentinel) stopScroll = infiniteScroll(sentinel, () => loadMore());
  }

  // Resolves true while more is left. A failure is shown in the list's footer and stops the scrolling (infiniteScroll stops on false).
  async function loadMore({ focus = false } = {}) {
    if (destroyed || loading || cursor == null) return cursor != null;
    const ticket = generation;
    loading = true;
    failure = '';
    paintFoot();
    let page;
    try {
      page = await fetchPage(cursor);
    } catch (error) {
      if (ticket !== generation || destroyed) return false;
      loading = false;
      failure = error?.message && !(error instanceof TypeError) ? error.message : MORE_FAILED;
      paintFoot();
      notify('error');
      return false;
    }
    if (ticket !== generation || destroyed) return false;
    loading = false;
    pages++;
    const grid = host.querySelector('[data-pager-items]');
    const before = grid ? grid.children.length : 0;
    const fresh = add(page?.items);
    cursor = page?.nextCursor ?? null;
    if (grid && fresh.length) grid.insertAdjacentHTML('beforeend', fresh.map(wrap).join(''));
    paintFoot();
    hydrateAll();
    if (focus && grid?.children[before]) grid.children[before].querySelector('a[href]')?.focus();
    if (cursor == null) stopScroll();
    notify('more');
    return cursor != null;
  }

  function show(page) {
    stopScroll();
    items = [];
    seen = new Set();
    pages = 1;
    loading = false;
    failure = '';
    add(page?.items);
    cursor = page?.nextCursor ?? null;
    host.removeAttribute('aria-busy');
    if (!items.length) {
      cursor = null;
      host.innerHTML = String(renderEmpty ? renderEmpty() : '');
      notify('show');
      return;
    }
    draw();
    arm();
    hydrateAll();
    notify('show');
  }

  async function reset() {
    const ticket = ++generation;
    stopScroll();
    host.setAttribute('aria-busy', 'true');
    host.innerHTML = skeleton(skeletonKind, 6).value;
    let page;
    try {
      page = await fetchPage(null);
    } catch (error) {
      if (ticket !== generation || destroyed) return;
      host.removeAttribute('aria-busy');
      items = [];
      seen = new Set();
      cursor = null;
      host.innerHTML = errorState(error, { retry: reset }).value;
      notify('error');
      return;
    }
    if (ticket !== generation || destroyed) return;
    show(page);
  }

  function remove(id) {
    const at = items.findIndex(item => item.id === id);
    if (at < 0) return;
    items.splice(at, 1);
    seen.delete(id);
    if (!items.length && cursor == null) {
      stopScroll();
      host.innerHTML = String(renderEmpty ? renderEmpty() : '');
    } else if (renderLead && at === 0) {
      draw(); // the next item becomes the lead
      arm();
      hydrateAll();
    } else {
      host.querySelector(`[data-pager-item="${CSS.escape(String(id))}"]`)?.remove();
    }
    notify('remove');
  }

  const removers = [
    delegate(host, 'click', '[data-pager-more]', (event, control) => {
      event.preventDefault();
      if (control.getAttribute('aria-disabled') !== 'true') loadMore({ focus: true });
    }),
    delegate(host, 'click', '[data-pager-retry]', event => {
      event.preventDefault();
      failure = '';
      arm();
      loadMore({ focus: true });
    })
  ];

  return {
    show,
    reset,
    remove,
    get items() { return items; },
    destroy() {
      destroyed = true;
      generation++;
      stopScroll();
      removers.forEach(stop => stop());
    }
  };
}
