// The creator studio (docs/ARCHITECTURE.md section 3, /app/studio).
//
// A member without an atelier sees the "Open your atelier" flow (views/studio/open.js). The owner of an atelier sees the
// dashboard: header, new post chooser, numbers, and four tabs (Published, Drafts, Members, Notes).
//
// The page itself loads at once; the numbers and each tab's list load after it, each with its own skeleton, error state and
// retry, so one slow or failing request never blocks the rest. Tabs switch in place (the URL follows through
// history.replaceState, so a reload or a shared link opens the same tab). The state lives in the object `load` returns and
// every async continuation checks that the page is still the one on screen.

import { avatar, button, confirmDialog, delegate, html, icon, setBusy, toast } from '../core/ui.js';
import { hydrateCovers } from '../core/covers.js';
import { plural } from '../core/format.js';
import { paths } from '../core/paths.js';
import { KINDS } from '../core/constants.js';
import { csvFilename, downloadCsv, membersCsv } from './studio/csv.js';
import { mountOpen, renderOpen } from './studio/open.js';
import { accessLabel, renderEntries } from './studio/entries.js';
import { MEMBER_PAGE, NOTE_MAX, NOTE_PAGE, memberStatus, renderMemberTools, renderMembers, renderNoteForm, renderNotes, tierOptions } from './studio/people.js';
import { KIND_LABEL, paintBars, renderStats } from './studio/stats.js';

const TABS = ['published', 'drafts', 'members', 'notes'];
const TAB_LABEL = { published: 'Published', drafts: 'Drafts', members: 'Members', notes: 'Notes' };
const PAGE = 12; // posts per request
const REFRESH_MS = 600; // a live update asks for fresh numbers once things have settled
const WATCHED = new Set(['membership', 'follow', 'like', 'comment']); // notifications that change what the studio shows
const NEW_HINT = { text: 'An essay, a guide or a note', image: 'A gallery of up to ten images', video: 'A single film with its poster' };
const KIND_ICON = { text: 'text', image: 'image', video: 'video' };

const tabOf = value => {
  const tab = value === 'draft' ? 'drafts' : value;
  return TABS.includes(tab) ? tab : 'published';
};

const emptyList = () => ({ status: 'idle', items: [], cursor: null, error: null, loadingMore: false, moreError: '' });

// --- Markup -----------------------------------------------------------------

function newPostChooser() {
  return html`<section class="studio-new" aria-labelledby="studio-new-title">
    <h2 id="studio-new-title" class="eyebrow">New post</h2>
    <ul class="studio-new-list">${KINDS.map(kind => html`<li><a class="studio-new-link" href="${paths.studioNew({ kind })}">${icon(KIND_ICON[kind], 22)}<span class="studio-new-text"><strong>${KIND_LABEL[kind]}</strong><small>${NEW_HINT[kind]}</small></span>${icon('plus', 16)}</a></li>`)}</ul>
  </section>`;
}

function tabs(st) {
  return html`<div class="tabs studio-tabs" role="tablist" aria-label="Studio sections">${TABS.map(tab => html`<button type="button" role="tab" class="tab" id="studio-tab-${tab}" data-tab="${tab}" aria-selected="${String(tab === st.tab)}" aria-controls="studio-panel" tabindex="${tab === st.tab ? '0' : '-1'}">${TAB_LABEL[tab]}<span class="studio-tab-count" data-tab-count="${tab}"></span></button>`)}</div>`;
}

const statsValue = st => (st.stats.status === 'ready' ? st.stats.value : null);

// What a panel holds. The results region is the part that is redrawn as data arrives; the tools above it are not.
function resultsMarkup(st, tab, ctx, handlers = {}) {
  if (tab === 'members') return renderMembers(st.members, { creator: st.creator, retry: handlers.members });
  if (tab === 'notes') return renderNotes(st.notes, { retry: handlers.notes });
  return renderEntries(tab, st.lists[tab], { stats: statsValue(st), store: ctx.store, retry: handlers[tab] });
}

function panelMarkup(st, tab, ctx, handlers) {
  const tools = tab === 'members' ? renderMemberTools(st.members) : tab === 'notes' ? renderNoteForm(st.notes) : '';
  return html`${tools}<p class="visually-hidden" role="status" data-region="announce"></p><div class="studio-results" data-region="results">${resultsMarkup(st, tab, ctx, handlers)}</div>`;
}

function renderStudio(ctx, st) {
  const creator = st.creator;
  const line = [creator.descriptor, creator.category, creator.location].filter(Boolean).join(' · ');
  return html`<section class="page studio" aria-labelledby="studio-title">
    <header class="page-head studio-head">
      <div class="studio-identity">${avatar(creator, { size: 64 })}<div><p class="eyebrow muted">Creator studio</p><h1 id="studio-title">${creator.name}</h1>${line && html`<p class="studio-line muted">${line}</p>`}</div></div>
      <div class="studio-head-actions">${button('View public page', { variant: 'secondary', size: 'small', href: paths.creator(creator.slug), icon: 'eye' })}${button('Edit atelier', { variant: 'secondary', size: 'small', href: paths.studioSettings(), icon: 'edit' })}</div>
    </header>
    ${newPostChooser()}
    <section class="section studio-overview" aria-labelledby="studio-overview-title">
      <div class="section-head"><h2 id="studio-overview-title">Overview</h2></div>
      <div data-region="stats" aria-live="polite">${renderStats(st.stats)}</div>
    </section>
    <section class="section studio-content" aria-labelledby="studio-content-title">
      <h2 id="studio-content-title" class="visually-hidden">Your posts, circle and notes</h2>
      ${tabs(st)}
      <div id="studio-panel" class="studio-panel" role="tabpanel" aria-labelledby="studio-tab-${st.tab}" tabindex="-1" data-region="panel">${panelMarkup(st, st.tab, ctx)}</div>
    </section>
  </section>`;
}

// --- Behaviour ----------------------------------------------------------------

function mountStudio(el, ctx, st) {
  const { api, store } = ctx;
  const creatorId = st.creator.id;
  let alive = true;
  let refreshTimer = null;
  let refreshMembers = false;
  const tickets = { stats: 0, published: 0, drafts: 0, members: 0, notes: 0 };
  const region = name => el.querySelector(`[data-region="${name}"]`);
  const announce = text => { const node = region('announce'); if (node) node.textContent = text; };
  const handlers = { published: () => loadList('published'), drafts: () => loadList('drafts'), members: () => loadMembers(), notes: () => loadNotes() };

  // Typed text must survive leaving by accident.
  ctx.router.block = () => (st.notes.draft.trim() ? 'You have a note that is not posted yet. Leave without posting it?' : null);

  // --- Painting: only the part that changed, so focus and typing stay where they are ---
  function syncCounts() {
    const stats = statsValue(st);
    const counts = {
      published: stats ? stats.entries : '',
      drafts: stats ? stats.drafts : '',
      members: st.members.status === 'ready' ? st.members.items.length : stats ? stats.members : '',
      notes: ''
    };
    for (const node of el.querySelectorAll('[data-tab-count]')) node.textContent = counts[node.dataset.tabCount] === '' ? '' : String(counts[node.dataset.tabCount] ?? '');
  }

  // Tier names are the creator's own once the numbers are known: rename them in place.
  function syncAccess() {
    const stats = statsValue(st);
    for (const node of el.querySelectorAll('[data-access]')) node.textContent = accessLabel(node.dataset.access, stats);
  }

  function syncMemberTools() {
    const select = el.querySelector('[data-member-tier]');
    if (select) select.innerHTML = tierOptions(st.members).value;
    const exporter = el.querySelector('[data-export-members]');
    if (exporter) exporter.disabled = st.members.status !== 'ready' || st.members.items.length === 0;
  }

  function hydrate(root) {
    hydrateCovers(root, [...st.lists.published.items, ...st.lists.drafts.items], api, store);
  }

  function paintStats() {
    const box = region('stats');
    if (!box) return;
    box.innerHTML = renderStats(st.stats, { retry: () => loadStats() }).value;
    box.setAttribute('aria-busy', String(st.stats.status === 'loading'));
    paintBars(box);
    syncCounts();
    syncAccess();
  }

  function paintResults(tab = st.tab) {
    if (tab !== st.tab) return;
    const box = region('results');
    if (!box) return;
    box.innerHTML = resultsMarkup(st, tab, ctx, handlers).value;
    if (tab === 'published' || tab === 'drafts') hydrate(box);
  }

  // --- Loading ---------------------------------------------------------------------
  async function loadStats({ quiet = false } = {}) {
    const mine = ++tickets.stats;
    if (!quiet) {
      st.stats = { status: 'loading', value: null, error: null };
      paintStats();
    }
    try {
      const value = await api.creatorStats(creatorId);
      if (!alive || mine !== tickets.stats) return;
      st.stats = { status: 'ready', value, error: null };
    } catch (error) {
      if (!alive || mine !== tickets.stats) return;
      if (quiet && st.stats.status === 'ready') return; // keep the numbers that are on screen
      st.stats = { status: 'error', value: null, error };
    }
    paintStats();
  }

  async function loadList(kind, { more = false } = {}) {
    const list = st.lists[kind];
    if (more) {
      if (!list.cursor || list.loadingMore) return;
      list.loadingMore = true;
      list.moreError = '';
    } else {
      Object.assign(list, { status: 'loading', error: null, cursor: null, loadingMore: false, moreError: '' });
    }
    const mine = ++tickets[kind];
    paintResults(kind);
    try {
      const page = await api.creatorEntries(creatorId, { status: kind === 'drafts' ? 'draft' : 'published', cursor: more ? list.cursor : undefined, limit: PAGE });
      if (!alive || mine !== tickets[kind]) return;
      const known = new Set(more ? list.items.map(item => item.id) : []);
      const fresh = page.items.filter(item => !known.has(item.id));
      list.items = more ? [...list.items, ...fresh] : fresh;
      list.cursor = page.nextCursor ?? null;
      list.status = 'ready';
      if (more) announce(`${plural(fresh.length, 'more post')} loaded.`);
    } catch (error) {
      if (!alive || mine !== tickets[kind]) return;
      if (more) list.moreError = error?.message || 'We could not load more posts. Try again.';
      else Object.assign(list, { status: 'error', error });
    }
    list.loadingMore = false;
    paintResults(kind);
  }

  async function loadMembers({ quiet = false } = {}) {
    const members = st.members;
    const mine = ++tickets.members;
    if (!quiet) {
      Object.assign(members, { status: 'loading', error: null });
      paintResults('members');
    }
    try {
      const items = await api.circleMembers(creatorId);
      if (!alive || mine !== tickets.members) return;
      Object.assign(members, { items, status: 'ready', error: null });
    } catch (error) {
      if (!alive || mine !== tickets.members) return;
      if (quiet) return;
      Object.assign(members, { status: 'error', error });
    }
    syncMemberTools();
    paintResults('members');
    syncCounts();
  }

  async function loadNotes() {
    const notes = st.notes;
    const mine = ++tickets.notes;
    Object.assign(notes, { status: 'loading', error: null });
    paintResults('notes');
    try {
      const items = await api.listNotes(creatorId);
      if (!alive || mine !== tickets.notes) return;
      // A note posted or deleted while the list was on its way is not undone by the answer.
      const extra = notes.extra.filter(note => !notes.gone.has(note.id));
      notes.items = [...extra, ...items.filter(note => !extra.some(other => other.id === note.id) && !notes.gone.has(note.id))];
      notes.extra = [];
      notes.status = 'ready';
    } catch (error) {
      if (!alive || mine !== tickets.notes) return;
      Object.assign(notes, { status: 'error', error });
    }
    paintResults('notes');
  }

  function ensureLoaded(tab) {
    if (tab === 'members' && st.members.status === 'idle') loadMembers();
    else if (tab === 'notes' && st.notes.status === 'idle') loadNotes();
    else if ((tab === 'published' || tab === 'drafts') && st.lists[tab].status === 'idle') loadList(tab);
  }

  // --- Tabs ---------------------------------------------------------------------------
  function selectTab(tab) {
    if (!TABS.includes(tab) || tab === st.tab) return;
    st.tab = tab;
    for (const button of el.querySelectorAll('[role="tab"][data-tab]')) {
      const on = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
    }
    const panel = region('panel');
    panel.setAttribute('aria-labelledby', `studio-tab-${tab}`);
    panel.innerHTML = panelMarkup(st, tab, ctx, handlers).value;
    if (tab === 'published' || tab === 'drafts') hydrate(panel);
    try { history.replaceState({ ...(history.state || {}) }, '', paths.studio({ tab: tab === 'published' ? '' : tab })); } catch { /* the address is a convenience */ }
    ensureLoaded(tab);
  }

  // --- Posts ---------------------------------------------------------------------------
  async function deleteEntry(control) {
    const kind = st.tab;
    const list = st.lists[kind];
    const entry = list?.items.find(item => item.id === control.dataset.deleteEntry);
    if (!entry) return;
    const draft = entry.status === 'draft';
    const confirmed = await confirmDialog({
      title: draft ? 'Delete this draft?' : 'Delete this post?',
      text: `“${entry.title}” and its media will be removed for good.${draft ? '' : ' Members will no longer be able to read it.'} This cannot be undone.`,
      confirmLabel: draft ? 'Delete draft' : 'Delete post',
      tone: 'danger'
    });
    if (!confirmed || !alive) return;
    setBusy(control, true);
    try {
      await api.deleteEntry(entry.id);
    } catch (error) {
      setBusy(control, false);
      toast(error?.message || 'We could not delete this post. Try again.', { tone: 'error' });
      return;
    }
    toast(draft ? 'Draft deleted.' : 'Post deleted.', { tone: 'success' });
    const mine = store.state.myCreator;
    if (!draft && mine?.id === creatorId) store.update({ myCreator: { ...mine, entryCount: Math.max(0, (mine.entryCount | 0) - 1) } });
    if (!alive) return;
    list.items = list.items.filter(item => item.id !== entry.id);
    const stats = statsValue(st);
    if (stats) stats[draft ? 'drafts' : 'entries'] = Math.max(0, stats[draft ? 'drafts' : 'entries'] - 1);
    paintResults(kind);
    syncCounts();
    announce(draft ? 'Draft deleted.' : 'Post deleted.');
    region('panel')?.focus();
    if (list.items.length === 0 && list.cursor) loadList(kind, { more: true });
    loadStats({ quiet: true });
  }

  // --- Members -------------------------------------------------------------------------
  function filterChanged() {
    st.members.shown = MEMBER_PAGE;
    paintResults('members');
    announce(memberStatus(st.members));
  }

  function exportMembers() {
    const items = st.members.items;
    if (items.length === 0) return;
    try {
      downloadCsv(csvFilename(st.creator.slug), membersCsv(items));
      toast(`Exported ${plural(items.length, 'member')}.`, { tone: 'success' });
    } catch {
      toast('We could not create the file. Try again.', { tone: 'error' });
    }
  }

  // --- Notes ---------------------------------------------------------------------------
  const noteField = () => el.querySelector('[data-note-text]');
  function setNoteError(message) {
    st.notes.formError = message;
    const box = el.querySelector('[data-note-error]');
    if (box) box.textContent = message;
    const area = noteField();
    if (area) {
      if (message) area.setAttribute('aria-invalid', 'true');
      else area.removeAttribute('aria-invalid');
    }
  }
  const showNoteCount = text => {
    const node = el.querySelector('[data-note-count]');
    if (node) node.textContent = `${text.length.toLocaleString('en')} / ${NOTE_MAX.toLocaleString('en')}`;
  };

  async function postNote() {
    const notes = st.notes;
    const area = noteField();
    if (!area || notes.posting) return;
    notes.draft = area.value; // the field is the truth: a paste or an autofill may not have fired an input event
    const text = notes.draft.trim();
    if (!text) return setNoteError('The note cannot be empty.');
    if (text.length > NOTE_MAX) return setNoteError(`The note can be at most ${NOTE_MAX.toLocaleString('en')} characters.`);
    setNoteError('');
    const submit = el.querySelector('[data-note-submit]');
    notes.posting = true;
    setBusy(submit, true);
    try {
      const note = await api.postNote(creatorId, text);
      toast('Note posted. Your circle has been told.', { tone: 'success' });
      if (!alive) return;
      notes.items = [note, ...notes.items.filter(other => other.id !== note.id)];
      if (notes.status !== 'ready') notes.extra.push(note);
      notes.draft = '';
      const field = noteField();
      if (field) field.value = '';
      showNoteCount('');
      paintResults('notes');
      announce('Note posted.');
    } catch (error) {
      const message = error?.message || 'We could not post your note. Try again.';
      toast(message, { tone: 'error' });
      if (alive) setNoteError(message); // what was typed stays in the field
    } finally {
      notes.posting = false;
      setBusy(submit, false);
    }
  }

  async function deleteNote(control) {
    const notes = st.notes;
    const note = notes.items.find(item => item.id === control.dataset.deleteNote);
    if (!note) return;
    const confirmed = await confirmDialog({ title: 'Delete this note?', text: 'It is removed for everyone in your circle. This cannot be undone.', confirmLabel: 'Delete note', tone: 'danger' });
    if (!confirmed || !alive) return;
    setBusy(control, true);
    try {
      await api.deleteNote(note.id);
    } catch (error) {
      setBusy(control, false);
      toast(error?.message || 'We could not delete this note. Try again.', { tone: 'error' });
      return;
    }
    toast('Note deleted.', { tone: 'success' });
    if (!alive) return;
    notes.gone.add(note.id);
    notes.items = notes.items.filter(item => item.id !== note.id);
    paintResults('notes');
    announce('Note deleted.');
    region('panel')?.focus();
  }

  // --- Live updates ----------------------------------------------------------------------
  function refreshSoon(type) {
    if (type === 'membership') refreshMembers = true;
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (!alive) return;
      loadStats({ quiet: true });
      if (refreshMembers && st.members.status === 'ready') loadMembers({ quiet: true });
      refreshMembers = false;
    }, REFRESH_MS);
    refreshTimer.unref?.();
  }

  // --- Wiring -------------------------------------------------------------------------------
  const off = [
    delegate(el, 'click', '[role="tab"][data-tab]', (event, tab) => selectTab(tab.dataset.tab)),
    delegate(el, 'keydown', '[role="tab"][data-tab]', (event, tab) => {
      const at = TABS.indexOf(tab.dataset.tab);
      const next = { ArrowRight: (at + 1) % TABS.length, ArrowLeft: (at + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      selectTab(TABS[next]);
      el.querySelector(`[data-tab="${TABS[next]}"]`)?.focus();
    }),
    // Retry buttons are routed by the studio itself (the document-wide listener of ui.errorState is not relied on), and the
    // click stops here so that a request is never made twice.
    delegate(el, 'click', '[data-retry]', (event, control) => {
      event.preventDefault();
      event.stopPropagation();
      if (control.closest('[data-region="stats"]')) loadStats();
      else if (control.closest('[data-region="results"]')) handlers[st.tab]?.();
    }),
    delegate(el, 'click', '[data-more-entries]',(event, control) => loadList(control.dataset.moreEntries, { more: true })),
    delegate(el, 'click', '[data-delete-entry]', (event, control) => deleteEntry(control)),
    delegate(el, 'input', '[data-member-search]', (event, input) => { st.members.query = input.value; filterChanged(); }),
    delegate(el, 'change', '[data-member-tier]', (event, select) => { st.members.tier = select.value; filterChanged(); }),
    delegate(el, 'click', '[data-more-members]', () => { st.members.shown += MEMBER_PAGE; paintResults('members'); }),
    delegate(el, 'click', '[data-export-members]', () => exportMembers()),
    delegate(el, 'input', '[data-note-text]', (event, area) => {
      st.notes.draft = area.value;
      showNoteCount(area.value);
      if (st.notes.formError) setNoteError('');
    }),
    delegate(el, 'submit', '[data-note-form]', event => { event.preventDefault(); postNote(); }),
    delegate(el, 'click', '[data-more-notes]', () => { st.notes.shown += NOTE_PAGE; paintResults('notes'); }),
    delegate(el, 'click', '[data-delete-note]', (event, control) => deleteNote(control)),
    store.onRealtime(event => {
      const note = event.payload;
      if (event.type === 'notification' && note?.creator?.id === creatorId && WATCHED.has(note.type)) refreshSoon(note.type);
    })
  ];

  loadStats();
  ensureLoaded(st.tab);

  return () => {
    alive = false;
    clearTimeout(refreshTimer);
    for (const stop of off) stop();
  };
}

// --- The view ------------------------------------------------------------------------------

export default {
  title: (ctx, data) => (data?.mode === 'studio' ? 'Studio' : 'Open your atelier'),
  auth: 'required',

  async load(ctx) {
    const { store } = ctx;
    // Viewer data that failed to load must not be mistaken for "no atelier": read it again, and show the error if it fails again.
    if (!store.state.myCreator && store.state.viewerError) await store.reloadViewer();
    const creator = store.state.myCreator;
    if (!creator) return { mode: 'open' };
    return {
      mode: 'studio',
      creator,
      tab: tabOf(ctx.query.tab),
      stats: { status: 'loading', value: null, error: null },
      lists: { published: emptyList(), drafts: emptyList() },
      members: { status: 'idle', items: [], error: null, query: '', tier: '', shown: MEMBER_PAGE },
      notes: { status: 'idle', items: [], error: null, draft: '', formError: '', shown: NOTE_PAGE, posting: false, extra: [], gone: new Set() }
    };
  },

  render(ctx, data) {
    return data.mode === 'studio' ? renderStudio(ctx, data) : renderOpen();
  },

  mount(el, ctx, data) {
    return data.mode === 'studio' ? mountStudio(el, ctx, data) : mountOpen(el, ctx);
  }
};
