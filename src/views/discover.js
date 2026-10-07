// Discover (/app/discover?q=&category=&kind=&sort=): search, or browse creators and posts.
//
// With a search the page shows the closest creators and posts (api.search); without one it lists creators and posts with
// a category, a post type and a sort order. Every choice is kept in the address (replaced in place, no new history entry)
// so a link to what you see can be shared. Changes update the results without redrawing the page, so typing never loses focus.

import { button, creatorCard, debounce, delegate, emptyState, entryCard, errorState, html, icon, raw, skeleton } from '../core/ui.js';
import { paths } from '../core/paths.js';
import { KINDS } from '../core/constants.js';
import { plural } from '../core/format.js';
import { hydrateCovers } from '../core/covers.js';
import { createPager } from './feed/pager.js';
import { CATEGORIES, KIND_LABELS, PAGE_SIZE, pick, replaceUrl } from './feed/shared.js';

const SORTS = [['new', 'Newest'], ['popular', 'Most popular']];
const SEARCH_DELAY = 300;
// api.search returns at most this many of each: a full list means there are probably more matches.
const SEARCH_CREATORS = 6;
const SEARCH_ENTRIES = 8;
const MAX_QUERY = 100;

// --- State and data ------------------------------------------------------------

const cleanQuery = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);

function readState(query) {
  return {
    q: cleanQuery(query.q),
    category: pick(query.category, CATEGORIES),
    kind: pick(query.kind, KINDS),
    sort: pick(query.sort, SORTS.map(([id]) => id)) || 'new'
  };
}

const urlFor = state => paths.discover({ q: state.q, category: state.category, kind: state.kind, sort: state.sort === 'new' ? '' : state.sort });
const filtered = state => Boolean(state.category || state.kind || state.sort !== 'new');

async function creatorsPage(api, state, offset) {
  const from = offset || 0;
  const items = await api.listCreators({ category: state.category || undefined, sort: state.sort, limit: PAGE_SIZE, offset: from });
  return { items, nextCursor: items.length >= PAGE_SIZE ? from + PAGE_SIZE : null };
}

const entriesPage = (api, state, cursor) => api.feed({
  scope: 'all',
  category: state.category || undefined,
  kind: state.kind || undefined,
  sort: state.sort,
  cursor: cursor || undefined,
  limit: PAGE_SIZE
});

// --- Markup --------------------------------------------------------------------

const selectField = ({ id, name, label, value, options, hidden = false }) => html`<div class="discover-field" data-field="${name}"${hidden && raw(' hidden')}>
  <label for="${id}">${label}</label>
  <select id="${id}" name="${name}" data-discover-filter="${name}">${options.map(([option, text]) => html`<option value="${option}"${option === value ? raw(' selected') : ''}>${text}</option>`)}</select>
</div>`;

function filterBar(state) {
  return html`<div class="filters discover-filters" role="group" aria-label="Filters">
    ${selectField({ id: 'discover-category', name: 'category', label: 'Category', value: state.category, options: [['', 'All categories'], ...CATEGORIES.map(c => [c, c])] })}
    ${selectField({ id: 'discover-kind', name: 'kind', label: 'Post type', value: state.kind, options: [['', 'All types'], ...KINDS.map(k => [k, KIND_LABELS[k]])] })}
    ${selectField({ id: 'discover-sort', name: 'sort', label: 'Sort by', value: state.sort, options: SORTS, hidden: Boolean(state.q) })}
    <button type="button" class="text-button discover-clear" data-discover-clear${filtered(state) ? '' : raw(' hidden')}>Clear filters</button>
  </div>`;
}

const sectionHead = (id, title, extra = '') => html`<div class="section-head"><h2 id="${id}">${title}</h2>${extra}</div>`;

const searchEmpty = state => emptyState({
  icon: 'search',
  title: `No matches for “${state.q}”`,
  text: state.category || state.kind
    ? 'Nothing fits this search with the filters you chose. Clear them, or try a shorter search.'
    : 'Check the spelling, try a shorter search, or browse by category.',
  action: button(state.category || state.kind ? 'Clear filters' : 'Clear search', { variant: 'secondary', attrs: state.category || state.kind ? { 'data-discover-clear': true } : { 'data-discover-clear-search': true } })
});

function searchMarkup(result, state) {
  const creators = result.creators.filter(creator => !state.category || creator.category === state.category);
  const entries = result.entries.filter(entry => (!state.category || entry.category === state.category) && (!state.kind || entry.kind === state.kind));
  if (!creators.length && !entries.length) return { markup: searchEmpty(state), creators, entries };
  const capped = result.creators.length >= SEARCH_CREATORS || result.entries.length >= SEARCH_ENTRIES;
  return {
    creators,
    entries,
    markup: html`${creators.length > 0 && html`<section class="section discover-section" aria-labelledby="discover-creators-title">
      ${sectionHead('discover-creators-title', 'Creators', html`<span class="muted count">${creators.length}</span>`)}
      <div class="grid-creators">${creators.map(creatorCard)}</div>
    </section>`}
    ${entries.length > 0 && html`<section class="section discover-section" aria-labelledby="discover-posts-title">
      ${sectionHead('discover-posts-title', 'Posts', html`<span class="muted count">${entries.length}</span>`)}
      <div class="grid-cards">${entries.map(entry => entryCard(entry))}</div>
    </section>`}
    ${capped && html`<p class="discover-hint muted">These are the closest matches. Add a word or two to narrow the search.</p>`}`
  };
}

const browseMarkup = () => html`<section class="section discover-section" aria-labelledby="discover-creators-title">
  ${sectionHead('discover-creators-title', 'Creators')}
  <div class="discover-list" data-pager-host="creators"></div>
</section>
<section class="section discover-section" aria-labelledby="discover-posts-title">
  ${sectionHead('discover-posts-title', 'Posts')}
  <div class="discover-list" data-pager-host="entries"></div>
</section>`;

// --- View ----------------------------------------------------------------------

export default {
  title: 'Discover',
  auth: 'optional',

  async load(ctx) {
    const { api } = ctx;
    const state = readState(ctx.query);
    if (state.q) return { state, search: await api.search(state.q) };
    const [creators, entries] = await Promise.all([creatorsPage(api, state, 0), entriesPage(api, state, null)]);
    return { state, creators, entries };
  },

  render(ctx, data) {
    const { state } = data;
    return html`<section class="page discover-page">
      <header class="page-head">
        <div>
          <p class="eyebrow muted">Discover</p>
          <h1>Find creators and their work</h1>
          <p class="page-sub">Search by name, topic or title, or browse by category. Joining a creator’s circle is free during early access.</p>
        </div>
      </header>
      <form class="discover-search" role="search" action="${paths.discover()}" method="get" data-discover-form>
        <label class="visually-hidden" for="discover-q">Search creators and posts</label>
        ${icon('search', 18)}
        <input id="discover-q" type="search" name="q" value="${state.q}" placeholder="A name, an idea, a title" maxlength="${MAX_QUERY}" autocomplete="off" enterkeyhint="search">
        ${button('Search', { type: 'submit' })}
      </form>
      ${filterBar(state)}
      <p class="visually-hidden" role="status" data-discover-status></p>
      <div class="discover-results" data-discover-results></div>
    </section>`;
  },

  mount(el, ctx, data) {
    const { api, store } = ctx;
    const { state } = data;
    const region = el.querySelector('[data-discover-results]');
    const status = el.querySelector('[data-discover-status]');
    const input = el.querySelector('#discover-q');
    let alive = true;
    let ticket = 0;
    let pagers = {};
    let lastSearch = data.search ? { q: state.q, result: data.search } : null;

    const stopPagers = () => {
      for (const pager of Object.values(pagers)) pager.destroy();
      pagers = {};
    };

    // --- Search ----------------------------------------------------------------

    function paintSearch(result) {
      const { markup, creators, entries } = searchMarkup(result, state);
      region.innerHTML = markup.value;
      region.removeAttribute('aria-busy');
      status.textContent = creators.length || entries.length
        ? `${plural(creators.length, 'creator')} and ${plural(entries.length, 'post')} for “${state.q}”.`
        : `No matches for “${state.q}”.`;
      hydrateCovers(region, entries, api, store);
    }

    async function runSearch() {
      const mine = ++ticket;
      stopPagers();
      region.setAttribute('aria-busy', 'true');
      region.innerHTML = skeleton('cards', 4).value;
      let result;
      try {
        result = await api.search(state.q);
      } catch (error) {
        if (!alive || mine !== ticket) return;
        region.removeAttribute('aria-busy');
        region.innerHTML = errorState(error, { retry: runSearch, title: 'We could not search' }).value;
        status.textContent = 'The search could not be completed.';
        return;
      }
      if (!alive || mine !== ticket) return;
      lastSearch = { q: state.q, result };
      paintSearch(result);
    }

    // --- Browse ----------------------------------------------------------------

    const counts = {};
    const announceBrowse = ({ reason, count }, key) => {
      if (reason !== 'show') return;
      counts[key] = count;
      if (counts.creators !== undefined && counts.entries !== undefined) {
        status.textContent = `${plural(counts.creators, 'creator')} and ${plural(counts.entries, 'post')} shown.`;
      }
    };

    const creatorsEmpty = () => emptyState({
      icon: 'members',
      title: state.category ? `No ${state.category} creators yet` : 'No creators yet',
      text: state.category ? 'Try another category, or clear the filter to see every creator.' : 'Creators will appear here as they open their ateliers.',
      action: state.category ? button('Clear filters', { variant: 'secondary', attrs: { 'data-discover-clear': true } }) : undefined
    });
    const entriesEmpty = () => emptyState({
      icon: 'grid',
      title: state.category || state.kind ? 'No posts match these filters' : 'No posts yet',
      text: state.category || state.kind ? 'Try another category or post type, or clear the filters.' : 'New posts appear here as soon as they are published.',
      action: state.category || state.kind ? button('Clear filters', { variant: 'secondary', attrs: { 'data-discover-clear': true } }) : undefined
    });

    // Draws the two lists. `initial` has their first pages when they were loaded already; `only` refreshes just one list.
    function startBrowse({ initial, only } = {}) {
      if (!only) {
        stopPagers();
        counts.creators = counts.entries = undefined;
        region.removeAttribute('aria-busy');
        region.innerHTML = browseMarkup().value;
        pagers.creators = createPager({
          host: region.querySelector('[data-pager-host="creators"]'),
          api,
          store,
          hydrate: false,
          gridClass: 'grid-creators',
          fetchPage: offset => creatorsPage(api, state, offset),
          renderItem: creator => creatorCard(creator),
          renderEmpty: creatorsEmpty,
          onChange: info => announceBrowse(info, 'creators')
        });
        pagers.entries = createPager({
          host: region.querySelector('[data-pager-host="entries"]'),
          api,
          store,
          fetchPage: cursor => entriesPage(api, state, cursor),
          renderItem: entry => entryCard(entry),
          renderEmpty: entriesEmpty,
          onChange: info => announceBrowse(info, 'entries')
        });
      }
      if (initial) {
        pagers.creators.show(initial.creators);
        pagers.entries.show(initial.entries);
        return;
      }
      if (only !== 'entries') pagers.creators.reset();
      if (only !== 'creators') pagers.entries.reset();
    }

    // --- Changes -----------------------------------------------------------------

    const syncControls = () => {
      for (const select of el.querySelectorAll('[data-discover-filter]')) select.value = state[select.dataset.discoverFilter];
      el.querySelector('[data-field="sort"]').hidden = Boolean(state.q);
      el.querySelector('[data-discover-clear]').hidden = !filtered(state);
    };

    function apply(patch) {
      const before = { ...state };
      Object.assign(state, patch);
      if (Object.keys(before).every(key => before[key] === state[key])) return;
      replaceUrl(urlFor(state));
      syncControls();
      if (state.q) {
        // Only the filters changed: the answers we have are filtered again instead of asked for again.
        if (lastSearch && lastSearch.q === state.q) {
          ++ticket;
          paintSearch(lastSearch.result);
        } else runSearch();
        return;
      }
      if (before.q) {
        ++ticket;
        startBrowse();
        return;
      }
      const only = before.category === state.category && before.sort === state.sort ? 'entries' : undefined;
      startBrowse({ only });
    }

    const setQuery = value => apply({ q: cleanQuery(value) });
    const typed = debounce(() => setQuery(input.value), SEARCH_DELAY);

    if (state.q) paintSearch(data.search);
    else startBrowse({ initial: data });

    const stops = [
      delegate(el, 'input', '#discover-q', () => typed()),
      delegate(el, 'submit', '[data-discover-form]', event => {
        event.preventDefault();
        typed.cancel();
        setQuery(input.value);
      }),
      delegate(el, 'change', '[data-discover-filter]', (event, select) => {
        apply({ [select.dataset.discoverFilter]: select.value });
      }),
      delegate(el, 'click', '[data-discover-clear]', event => {
        event.preventDefault();
        apply({ category: '', kind: '', sort: 'new' });
      }),
      delegate(el, 'click', '[data-discover-clear-search]', event => {
        event.preventDefault();
        typed.cancel();
        input.value = '';
        apply({ q: '' });
        input.focus();
      })
    ];

    return () => {
      alive = false;
      typed.cancel();
      stopPagers();
      stops.forEach(stop => stop());
    };
  }
};
