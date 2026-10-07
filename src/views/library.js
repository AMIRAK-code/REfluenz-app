// Library (/app/library): the posts you saved, newest save first.
//
// Each post can be taken out again with "Remove" (the same optimistic save toggle as the bookmark, with its rollback and
// message), and the whole list can be downloaded as a JSON reading list. Posts that were unpublished or deleted are
// left out by the api; posts of circles you have since left stay, locked, until you remove them.

import { button, delegate, emptyState, entryCard, html, setBusy, toast } from '../core/ui.js';
import { paths } from '../core/paths.js';
import { TIER_NAMES } from '../core/constants.js';
import { plural } from '../core/format.js';
import { createPager } from './feed/pager.js';
import { PAGE_SIZE, downloadFile } from './feed/shared.js';

const EXPORT_PAGE = 50; // the largest page the api serves
const EXPORT_LIMIT = 2000; // a reading list longer than this is cut, not left running

const emptyLibrary = () => emptyState({
  icon: 'bookmark',
  title: 'Nothing saved yet',
  text: 'Use the bookmark on any post to keep it here, ready for when you have time to read it.',
  action: { label: 'Find something to read', href: paths.discover() }
});

// One saved post with its own way out. The accessible name says which post it is.
const libraryItem = entry => html`${entryCard(entry)}<div class="library-actions"><button type="button" class="text-button library-remove" data-library-remove="${entry.id}" aria-label="Remove “${entry.title}” from your library">Remove from library</button></div>`;

// The file people take away: plain, readable and with a link back to every post.
function readingList(entries, store) {
  const accessName = id => store.state.tiers.find(tier => tier.id === id)?.name || TIER_NAMES[id] || 'Members';
  const origin = globalThis.location?.origin ?? '';
  return {
    exportedAt: new Date().toISOString(),
    count: entries.length,
    entries: entries.map(entry => ({
      title: entry.title,
      creator: entry.creator?.name ?? '',
      kind: entry.kind,
      category: entry.category,
      access: entry.access === 'public' ? 'Open to everyone' : `${accessName(entry.access)} and above`,
      publishedAt: entry.publishedAt ?? null,
      url: `${origin}${paths.entry(entry.id)}`
    }))
  };
}

export default {
  title: 'Library',
  auth: 'required',

  async load(ctx) {
    return ctx.api.savedEntries({ limit: PAGE_SIZE });
  },

  render() {
    return html`<section class="page library-page">
      <header class="page-head">
        <div>
          <p class="eyebrow muted">Library</p>
          <h1 id="library-title" tabindex="-1">Your library</h1>
          <p class="page-sub">The posts you have saved, most recent first. Only you can see this list, and it stays here until you remove something.</p>
        </div>
        <div class="library-tools">${button('Export reading list', { variant: 'secondary', icon: 'export', attrs: { 'data-library-export': true, hidden: true } })}</div>
      </header>
      <div class="section-head"><h2 id="library-list-title">Saved posts</h2><span class="muted count" data-library-count></span></div>
      <p class="visually-hidden" role="status" data-library-status></p>
      <div class="library-list" data-library-list aria-labelledby="library-list-title"></div>
    </section>`;
  },

  mount(el, ctx, page) {
    const { api, store } = ctx;
    const host = el.querySelector('[data-library-list]');
    const status = el.querySelector('[data-library-status]');
    const counter = el.querySelector('[data-library-count]');
    const exporter = el.querySelector('[data-library-export]');
    let alive = true;

    const pager = createPager({
      host,
      api,
      store,
      fetchPage: cursor => api.savedEntries({ cursor, limit: PAGE_SIZE }),
      renderItem: libraryItem,
      renderEmpty: emptyLibrary,
      onChange({ reason, count, done, empty }) {
        counter.textContent = empty ? '' : `${count}${done ? '' : '+'}`;
        exporter.hidden = empty;
        if (reason === 'show' || reason === 'more') status.textContent = empty ? 'Your library is empty.' : `${plural(count, 'saved post')}${done ? '' : ', more available'}.`;
        else if (reason === 'error') status.textContent = 'More of your library could not be loaded.';
      }
    });
    pager.show(page);

    // --- Remove ------------------------------------------------------------------

    async function remove(control) {
      const id = control.dataset.libraryRemove;
      setBusy(control, true);
      // The bookmark on the card may have been switched off already: then there is nothing left to undo on the server.
      const done = store.state.saved.has(id) ? await store.toggleSave(id) : true;
      if (!alive) return;
      if (!done) {
        setBusy(control, false); // the store has said why
        return;
      }
      const items = [...host.querySelectorAll('[data-pager-item]')];
      const at = items.findIndex(item => item.dataset.pagerItem === id);
      const neighbour = items[at + 1] ?? items[at - 1];
      pager.remove(id);
      (neighbour?.isConnected ? neighbour.querySelector('[data-library-remove]') : null)?.focus();
      if (!neighbour) el.querySelector('#library-title')?.focus();
      status.textContent = pager.items.length ? `Removed. ${plural(pager.items.length, 'saved post')} left.` : 'Removed. Your library is empty.';
      toast('Removed from your library.', { tone: 'success' });
    }

    // --- Export ------------------------------------------------------------------

    async function exportList(control) {
      setBusy(control, true);
      try {
        const entries = [];
        let cursor = null;
        do {
          const result = await api.savedEntries({ ...(cursor ? { cursor } : {}), limit: EXPORT_PAGE });
          entries.push(...(result?.items ?? []));
          cursor = result?.nextCursor ?? null;
        } while (cursor && entries.length < EXPORT_LIMIT);
        if (!alive) return;
        if (!entries.length) {
          toast('There is nothing in your library to export yet.');
          return;
        }
        downloadFile('refluenz-reading-list.json', JSON.stringify(readingList(entries, store), null, 2));
        toast(`Your reading list is ready: ${plural(entries.length, 'post')}.`, { tone: 'success' });
      } catch (error) {
        if (alive) toast(error?.message || 'We could not export your library. Try again.', { tone: 'error' });
      } finally {
        setBusy(control, false);
      }
    }

    const stops = [
      delegate(el, 'click', '[data-library-remove]', (event, control) => { event.preventDefault(); remove(control); }),
      delegate(el, 'click', '[data-library-export]', (event, control) => { event.preventDefault(); exportList(control); })
    ];

    return () => {
      alive = false;
      pager.destroy();
      stops.forEach(stop => stop());
    };
  }
};
