import { escapeHTML as esc, canRead, validateEntry, validateAtelier, membershipTotal, csvCell, categories, covers, kinds, formats, textFormats, defaultFormat } from './store.js';
import { icon } from './icons.js';
import * as mediaModule from './media.js';

// The platform view layer. All data comes from the injected api (Supabase in the
// browser, a fake in tests); the server enforces access with row level security.
// `media` prepares uploads in the browser (src/media.js); tests inject a fake.
export function mount(api, {storage = safeStorage(), media = mediaModule} = {}) {
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
let user = null, data = null, authReady = false, recovering = false, loadError = '', authMode = 'signin', authNotice = '';
let activeFilter = 'All entries', query = '', category = 'All', contact = '';
let studioTab = 'published', membershipCreator = '', selectedTier = 'essential', circleMembers = null;
let readerId = '', editorId = '', editorDirty = false, busy = false, saving = false, toastTimer;
let kindFilter = 'all', editorKind = 'text', editorMedia = [], editorRemoved = [], itemKey = 0;
let uploadAbort = null;             // cancels the save in progress (the upload, then everything after it)
let openTicket = 0;                 // the newest request to open a reader or the editor: an older one that finishes later is dropped
const UPLOADS_AT_ONCE = 2, UPDATES_AT_ONCE = 4;   // files in flight at the same time while saving, and media rows updated at the same time
let epoch = 0;                      // bumped when the account changes; answers that arrive for an older one are dropped
let mediaNote = '', kindLockShown = false, thumbJobs = Promise.resolve(), cleanup = Promise.resolve();
const editorUploaded = new Set();   // ids of media this editing session uploaded itself
const bodies = new Map(), mediaCache = new Map(), thumbs = new Map();
const badCovers = new Set();        // card thumbnails (object paths) that could not be signed or loaded: their cards show the image file instead
const clearAccessCaches = () => { bodies.clear(); mediaCache.clear(); thumbs.clear(); badCovers.clear(); };
const state = () => data;
const role = () => (storage.getItem('refluenz.role') === 'creator' ? 'creator' : 'member');
const setRole = r => { try { storage.setItem('refluenz.role', r); } catch {} };
const blank = {id:'', name:'REFLUENZ', initials:'R', category:'Culture', descriptor:'', location:'', image:'atelier', bio:''};
const creator = id => state().creators.find(c => c.id === id) || blank;
const mine = () => state().myCreator;
const entry = id => state().entries.find(e => e.id === id);
const tier = id => state().tiers.find(t => t.id === id);
// The editorial presets are 800 px JPEGs (60-140 KB) in a versioned folder that vercel.json caches for a year: when the files change,
// make a v2 folder and point this at it. The 2.5 MB originals in /editorial stay for the landing page.
const image = name => `/editorial/v1/${covers.includes(name) ? name : 'atelier'}.jpg`;
const avatar = c => `<span class="avatar" aria-hidden="true">${esc(c.initials || String(c.name||'').split(' ').map(n => n[0]).slice(0,2).join(''))}</span>`;
const money = n => `€${n}`;
const date = value => new Date(value).toLocaleDateString('en-GB', {day:'numeric',month:'short'});
const action = (name, id = '') => `data-action="${name}" data-id="${esc(id)}"`;
const btn = (label, name, id='', classes='button secondary small') => `<button class="${classes}" ${action(name,id)}>${label}</button>`;
const published = () => state().entries.filter(e => e.status === 'published').sort((a,b) => new Date(b.date)-new Date(a.date));
const CANCELLED = 'Upload cancelled.';   // the message api.uploadMedia raises when its signal is aborted
const noun = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const route = () => location.hash.slice(1).split('/')[0] || 'atelier';
const pages = {atelier:'The atelier',discover:'Discover',archive:'Private archive',circle:'Your circle',memberships:'Memberships',studio:'Creator studio',settings:'Settings'};
const accessLabel = a => a === 'public' ? 'Open entry' : esc(tier(a)?.name || a);

// --- Post formats: kind helpers, thumbnails and badges ---------------------
const kindOf = p => p?.kind === 'image' || p?.kind === 'video' ? p.kind : 'text';
// A duration of 0 means "unknown" (a recording whose length the browser could not read), so it reads as no length at all.
const lengthOf = p => p.duration > 0 ? media.formatDuration(p.duration) : '';
const count = p => Math.max(0, Math.trunc(Number(p.mediaCount)) || 0);
const size = (p, long = false) => { const k = kindOf(p); return k === 'image' ? noun(count(p), 'image') : k === 'video' ? lengthOf(p) || 'Video' : `${p.minutes} min${long ? ' read' : ''}`; };
// A signed URL lasts an hour and the api reuses one until five minutes before it expires, so a URL can already be 55 minutes old when it
// arrives here. Four minutes keeps the cover well inside that last stretch; a stale one is signed again on the next render.
const thumbUrl = id => { const t = thumbs.get(id); return t && Date.now() - t.at < 4 * 60 * 1000 ? t.url : ''; };
const dim = n => Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : 0;
// Decorative: the same facts are in the card text ("Gallery · 3 images", "Film · 1:32"), and the cover button has its own label.
function kindBadge(p) {
  const k = kindOf(p); if (k === 'text') return '';
  const label = k === 'image' ? (count(p) > 1 ? count(p) : '') : lengthOf(p);
  return `<span class="kind-badge" aria-hidden="true">${icon(k === 'image' ? 'image' : 'play', 11)}${label ? `<span>${esc(label)}</span>` : ''}</span>`;
}
// The cover of an entry. Text uses the editorial preset. Media entries the viewer can read use the first
// image or poster (signed, filled in by hydrateMedia). Locked media entries only ever get the public blurred preview.
function thumb(p, alt, lazy = true) {
  const lz = `${lazy ? ' loading="lazy"' : ''} decoding="async"`;
  const preset = `<img src="${image(p.image)}" alt="${alt}"${lz}>`;
  if (kindOf(p) === 'text') return {cls: '', img: preset};
  if (!canRead(p, state())) return p.previewUrl ? {cls: ' is-preview', img: `<img src="${esc(p.previewUrl)}" alt=""${lz}>`} : {cls: '', img: preset};
  const url = thumbUrl(p.id), mark = `data-media-thumb="${esc(p.id)}"`;
  if (url) return {cls: '', img: `<img src="${esc(url)}" alt=""${lz} ${mark} data-media-ready="1">`};
  return p.previewUrl ? {cls: ' is-preview', img: `<img src="${esc(p.previewUrl)}" alt=""${lz} ${mark}>`} : {cls: '', img: `<img src="${image(p.image)}" alt=""${lz} ${mark}>`};
}
// The cover of an entry is the first file of its own kind (a save that failed half way can leave files of another kind behind). An image
// carries a small card thumbnail in poster_path (older uploads, and pictures that were already small, have none: they use the file itself),
// a film its poster frame. Cards never download the full-size original while a thumbnail is usable; the reader shows originals.
const coverPath = m => !m ? '' : m.kind === 'video' ? m.posterPath || '' : m.posterPath && !badCovers.has(m.posterPath) ? m.posterPath : m.path;
const coverMedia = id => mediaCache.get(id)?.find(x => x.kind === kindOf(entry(id)));
// Thumbnails load after render: one batched media lookup, one signing call, then the images are swapped in.
async function hydrateRun() {
  if (!data) return;
  const session = epoch;
  const wanted = [...new Set([...app.querySelectorAll('img[data-media-thumb]')].map(i => i.dataset.mediaThumb))].filter(id => { const p = entry(id); return p && kindOf(p) !== 'text' && canRead(p, state()) && !thumbUrl(id); });
  if (!wanted.length) return paintThumbs();   // covers that are already signed still need their listeners
  try {
    const missing = wanted.filter(id => !mediaCache.has(id));
    if (missing.length) { const found = await api.media(missing); if (epoch !== session) return; for (const id of missing) mediaCache.set(id, found?.[id] || []); }
    const paths = new Map(wanted.map(id => [id, coverPath(coverMedia(id))]).filter(([, path]) => path));
    if (paths.size) {
      let urls = (await api.signedUrls([...new Set(paths.values())])) || {}; if (epoch !== session) return;
      // A thumbnail that cannot be signed (its object is gone) must not leave a blank card while the image itself is there: sign that
      // instead. The thumbnail is only written off once the file signed, so a failure of the whole lookup does not cost every card its thumbnail.
      const lost = [...paths].filter(([id, path]) => !urls[path] && coverMedia(id)?.kind === 'image' && path === coverMedia(id).posterPath);
      if (lost.length) {
        const originals = lost.map(([id]) => coverMedia(id).path), more = (await api.signedUrls(originals)) || {}; if (epoch !== session) return;
        urls = {...urls, ...more};
        for (const [id, path] of lost) if (more[coverMedia(id).path]) { badCovers.add(path); paths.set(id, coverMedia(id).path); }
      }
      for (const [id, path] of paths) { if (urls[path]) thumbs.set(id, {url: urls[path], at: Date.now()}); else mediaCache.delete(id); }   // no cover at all: read the file list again next time
    }
    paintThumbs();
  } catch { /* Thumbnails are decoration: the placeholder stays and the next render tries again. */ }
}
// The <img> is already lazy, so it simply gets its signed source: only covers near the screen are fetched. The blur of a locked-style
// preview goes once the real picture has loaded. Every cover gets its listeners once, including those drawn with a cached link.
function paintThumbs() {
  for (const img of app.querySelectorAll('img[data-media-thumb]')) {
    const id = img.dataset.mediaThumb;
    if (!img.dataset.mediaBound) {
      img.dataset.mediaBound = '1';
      img.addEventListener('load', () => { if (!img.dataset.mediaReady) return; delete img.dataset.mediaFailed; img.closest('.is-preview')?.classList.remove('is-preview'); });   // not the blurred preview itself loading
      img.addEventListener('error', () => coverFailed(img, id));
    }
    const url = thumbUrl(id);
    if (!url || img.dataset.mediaReady) continue;
    img.dataset.mediaReady = '1'; img.src = url;
  }
}
// A signed cover that fails to load. Its link has most likely expired (a card scrolled into view long after it was drawn), so it is signed
// again once. If that fails as well and the cover was a card thumbnail, the image file itself takes its place. After that it is left alone,
// so a cover that keeps failing cannot loop.
function coverFailed(img, id) {
  if (!img.dataset.mediaReady) return;   // the blurred preview or the editorial preset failed, not a signed cover
  thumbs.delete(id); delete img.dataset.mediaReady;
  const failures = Number(img.dataset.mediaFailed) || 0; img.dataset.mediaFailed = String(failures + 1);
  if (failures > 1) return;
  if (failures === 1) { const m = coverMedia(id); if (m?.kind === 'image' && m.posterPath && coverPath(m) === m.posterPath) badCovers.add(m.posterPath); else return; }
  hydrateMedia();
}
let hydration = Promise.resolve();
const hydrateMedia = () => (hydration = hydration.then(hydrateRun).catch(() => {}));

function toast(message) {
  clearTimeout(toastTimer);
  const el = document.querySelector('#toast');
  el.textContent = message; el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}
// Loads the member's data. Resolves false, and keeps what is shown, when the account changed while the request was out: its answer belongs to
// somebody else and must never replace the new account's data.
async function refresh() {
  const session = epoch, next = await api.load();
  if (epoch !== session) return false;
  data = next; if (contact && role() === 'member' && !state().creators.some(c => c.id === contact)) contact = '';
  return true;
}
// Runs a server write, reloads the member's data (unless `reload` is false) and redraws. Returns true on success. When the account changes
// meanwhile, everything was reset: nothing is reloaded or shown for the previous one.
async function run(fn, message, redraw = true, reload = true) {
  if (busy) return false;
  const session = epoch;
  busy = true; document.body.classList.add('busy');
  try {
    await fn(); if (epoch !== session) return false;
    if (reload) { await refresh(); if (epoch !== session) return false; }
    if (redraw) render(); if (message) toast(message); return true;
  }
  catch (error) { toast(error.message); return false; }
  finally { busy = false; document.body.classList.remove('busy'); }
}
function go(view) { if(!closeModal()) return; if(location.hash === `#${view}`) render(); else location.hash = view; }
function openModal(title, body, className='') {
  stopMedia();   // a film playing in the reader must not play on behind the dialog that replaces it
  modal.className = className;
  modal.innerHTML = `<div class="dialog-head"><h2 id="modal-title">${title}</h2><button class="icon-button" ${action('close')} aria-label="Close dialog">${icon('close')}</button></div>${body}`;
  if(!modal.open) modal.showModal();
  document.body.style.overflow = 'hidden';
}
// A <video> in a closed dialog keeps playing (and downloading) unless it is stopped.
function stopMedia() {
  for (const v of modal.querySelectorAll('video')) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* already gone */ } }
}
// What a discarded editing session leaves attached to the entry: the files it uploaded itself. A kind with no file from before the session is
// left alone, so a published entry never loses its last file (the database would send it back to draft).
function sessionUploads() {
  if (!editorId || !editorUploaded.size) return [];
  const attached = [...editorMedia.map(it => it.media).filter(Boolean), ...editorRemoved];
  const before = attached.filter(m => !editorUploaded.has(m.id));
  return attached.filter(m => editorUploaded.has(m.id) && before.some(o => o.kind === m.kind));
}
// Best effort, one at a time per entry, and the editor waits for it before it reads the entry's files again.
function undoUploads(id, list) {
  const session = epoch;
  cleanup = cleanup.then(async () => {
    try { await api.removeMedia(list); } catch { /* the creator can still remove them from the editor next time */ }
    if (epoch !== session) return;
    mediaCache.delete(id); thumbs.delete(id);
    try { if (await refresh()) render(); } catch { /* the lists catch up with the next load */ }
  });
}
function closeModal(force=false) {
  if(saving && !force) { toast('Still uploading. Use Cancel upload to stop.'); return false; }
  const undo = sessionUploads();
  if(editorDirty && !force) {
    if(!window.confirm(undo.length ? 'Discard the unsaved changes to this entry? Files uploaded during this edit are removed again.' : 'Discard the unsaved changes to this entry?')) return false;
  }
  const entryId = editorId;
  openTicket++;   // a reader or editor still being fetched is not wanted any more
  editorDirty = false; readerId = ''; editorId = ''; releaseEditor();
  stopMedia();
  if(modal.open) modal.close(); document.body.style.overflow = '';
  modal.innerHTML = '';   // no reader text, signed media or draft stays in the page once the dialog is closed
  if(undo.length) undoUploads(entryId, undo);
  return true;
}
modal.addEventListener('cancel', e => { e.preventDefault(); closeModal(); });
modal.addEventListener('close', () => {
  // The browser lets a script cancel only one Esc per user gesture: a second one closes the dialog for good. Programmatic closes reset
  // these flags first, so what is left is an editor that must not vanish while a save runs or edits are unsaved.
  if((saving || editorDirty) && !modal.open) { modal.showModal(); document.body.style.overflow = 'hidden'; return; }
  if(!modal.open) stopMedia();
  document.body.style.overflow = '';
});
modal.addEventListener('click', e => {
  if(e.target !== modal) return;
  const r = modal.getBoundingClientRect();
  if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) closeModal();
});
window.addEventListener('beforeunload', e => { if(editorDirty || saving) { e.preventDefault(); e.returnValue=''; } });

// --- Authentication ------------------------------------------------------
function authView() {
  const forms = {
    signin:`<form class="auth-form" data-form="signin"><div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" required maxlength="254"></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="72"></div><button class="button">Sign in ${icon('arrow',14)}</button><div class="auth-links"><button type="button" class="text-link bare" ${action('auth-mode','signup')}>Create a free account</button><button type="button" class="text-link bare" ${action('auth-mode','forgot')}>Forgot your password?</button></div></form>`,
    signup:`<form class="auth-form" data-form="signup"><div class="field"><label for="auth-name">Display name</label><input id="auth-name" name="name" autocomplete="name" required maxlength="60"></div><div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" required maxlength="254"></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="72"><p class="field-help">At least 8 characters.</p></div><button class="button">Create free account ${icon('arrow',14)}</button><div class="auth-links"><button type="button" class="text-link bare" ${action('auth-mode','signin')}>I already have an account</button></div></form>`,
    forgot:`<form class="auth-form" data-form="forgot"><div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" required maxlength="254"></div><button class="button">Send reset link ${icon('send',14)}</button><div class="auth-links"><button type="button" class="text-link bare" ${action('auth-mode','signin')}>Back to sign in</button></div></form>`,
    recover:`<form class="auth-form" data-form="recover"><div class="field"><label for="auth-password">New password</label><input id="auth-password" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="72"></div><button class="button">Save new password ${icon('check',14)}</button></form>`
  };
  const titles = {signin:['Welcome back','Step inside.','Your atelier, exactly as you left it.'],signup:['Free to join','Find your circle.','Create an account to follow creators, keep an archive and join the conversation.'],forgot:['Account recovery','Reset your password.','We will email you a secure link.'],recover:['Account recovery','Choose a new password.','Then continue to your atelier.']};
  const [kicker,title,text] = titles[authMode];
  return `<main id="main" class="auth-screen" tabindex="-1"><section class="auth-panel"><a class="wordmark" href="/index.html">REFLUENZ</a><div class="eyebrow bronze">${kicker}</div><h1>${title}</h1><p>${text}</p>${authNotice?`<div class="notice" role="status">${esc(authNotice)}</div>`:''}${forms[authMode]}</section><aside class="auth-picture"><img src="${image('atelier')}" alt="A monochrome study of an atelier" loading="lazy" decoding="async"><span class="eyebrow">The digital atelier / Edition 001</span></aside></main>`;
}

// --- Shell and views -----------------------------------------------------
function navLink(id, label, name, mobile=false) {
  const active = route() === id;
  return `<a href="#${id}" class="${mobile?'':'nav-link '}${active?'active':''}" ${active?'aria-current="page"':''}>${icon(name)}<span>${label}</span>${!mobile&&id==='archive'&&state().saved.length?`<span class="nav-count">${state().saved.length}</span>`:''}</a>`;
}
function shell(content) {
  const s = state(), r = role(), c = r === 'creator' && mine() ? mine() : s.profile;
  return `<aside class="app-sidebar"><a class="wordmark" href="/index.html">REFLUENZ</a><div class="eyebrow sidebar-caption">The digital atelier</div><div class="nav-section">Your private space</div><nav class="side-nav" aria-label="Platform navigation">
  ${navLink('atelier','The atelier','grid')}${navLink('discover','Discover','compass')}${navLink('archive','Private archive','bookmark')}${navLink('circle','Your circle','message')}${navLink('memberships','Memberships','members')}${r==='creator'?navLink('studio','Creator studio','studio'):''}</nav>
  <div class="sidebar-bottom"><div class="sidebar-studio"><span class="eyebrow bronze">${r==='creator'?'The other side':'Made for your work'}</span><p>${r==='creator'?'See your work through the eyes of your circle.':'Your point of view deserves a place of its own.'}</p><button class="text-link bare" ${action('role',r==='creator'?'member':'creator')}>${r==='creator'?'View as a member':mine()?'Open your studio':'Open your atelier'} ${icon('arrow',14)}</button></div><div class="sidebar-footer-links"><a href="/index.html">About REFLUENZ ${icon('arrow',12)}</a><a href="#settings" aria-label="Settings">${icon('settings',16)}</a></div><button class="profile-button" ${action('settings')}>${avatar(c)}<span><strong>${esc(c.name)}</strong><small>${r==='creator'&&mine()?'Your atelier':'Member'}</small></span></button></div></aside>
  <div class="app-layout"><header class="app-topbar"><a class="wordmark mobile-wordmark" href="/index.html">REFLUENZ</a><div class="breadcrumb">Your space <span>/</span> <strong>${pages[route()]||pages.atelier}</strong></div><div class="topbar-right"><form class="search-box" data-form="search">${icon('search',16)}<input name="query" aria-label="Search creators and entries" placeholder="Search the atelier" maxlength="100" value="${esc(query)}"></form><div class="role-switch" aria-label="Perspective"><button ${action('role','member')} class="${r==='member'?'active':''}" aria-pressed="${r==='member'}">Member</button><button ${action('role','creator')} class="${r==='creator'?'active':''}" aria-pressed="${r==='creator'}">Creator</button></div></div></header>
  <div class="demo-strip"><span><strong>EARLY ACCESS</strong> <span>— Joining a circle is free while payments are being set up.</span></span><button ${action('about')}>How it works</button></div>${loadError?`<div class="error-banner" role="alert">${esc(loadError)}</div>`:''}
  <main id="main" class="workspace ${s.preferences.compact?'compact':''}" tabindex="-1">${content}<footer class="view-footer"><span>REFLUENZ · Independent by design</span><span>Early access / 001</span></footer></main></div>
  <nav class="mobile-bar" aria-label="Mobile navigation">${navLink('atelier','Atelier','grid',true)}${navLink('discover','Discover','compass',true)}${navLink('archive','Archive','bookmark',true)}${navLink('circle','Circle','message',true)}${navLink(r==='creator'?'studio':'settings',r==='creator'?'Studio':'You',r==='creator'?'studio':'user',true)}</nav>`;
}
function heading(kicker,title,description,extra='') {
  return `<div class="page-heading"><div><div class="eyebrow bronze">${kicker}</div><h1>${title}</h1><p>${description}</p></div>${extra}</div>`;
}
function saveButton(p) {
  const saved = state().saved.includes(p.id);
  return `<button class="icon-button ${saved?'saved':''}" ${action('save',p.id)} aria-label="${saved?'Remove from':'Save to'} archive: ${esc(p.title)}" aria-pressed="${saved}">${icon('bookmark',17)}</button>`;
}
function card(p) {
  const c = creator(p.creatorId), locked=!canRead(p,state()), t=thumb(p,`${esc(p.category)} editorial cover`);
  return `<article class="entry-card"><button class="entry-cover${t.cls}" ${action('read',p.id)} aria-label="Read ${esc(p.title)}">${t.img}${kindBadge(p)}<span class="access-badge">${locked?icon('lock',10):''}${accessLabel(p.access)}</span></button><div class="entry-details"><div class="eyebrow">${esc(c.name)} / ${esc(p.category)}</div><h3><button class="entry-title" ${action('read',p.id)}>${esc(p.title)}</button></h3><p>${esc(p.subtitle)}</p><div class="entry-card-footer"><span>${esc(p.format)} · ${size(p)}</span>${saveButton(p)}</div></div></article>`;
}
function empty(title,text,link='discover',label='Explore the atelier') {
  return `<div class="empty">${icon('bookmark',26)}<h3>${title}</h3><p>${text}</p><a class="button secondary" href="#${link}">${label} ${icon('arrow')}</a></div>`;
}
function feature(p) {
  const c = creator(p.creatorId), t = thumb(p, `A study in ${esc(p.category.toLowerCase())}`, false);
  return `<article class="feature-entry"><button class="feature-picture${t.cls}" ${action('read',p.id)} aria-label="Read ${esc(p.title)}">${t.img}${kindBadge(p)}<span class="cover-label">The considered edit / 001</span></button><div class="feature-info"><div class="entry-author">${avatar(c)}<span>${esc(c.name)}<small>${esc(c.descriptor)}</small></span></div><h2><button ${action('read',p.id)}>${esc(p.title)}</button></h2><p>${esc(p.subtitle)}</p><button class="text-link" ${action('read',p.id)}>Read the entry ${icon('arrow',15)}</button><div class="feature-meta"><span class="eyebrow">${esc(p.format)} · ${size(p,true)}</span>${saveButton(p)}</div></div></article>`;
}
function rail() {
  const list = state().creators.filter(c=>state().following.includes(c.id));
  const note = [...state().notes].reverse().find(n => state().following.includes(n.creatorId));
  return `<aside class="right-rail"><div class="rail-section"><h2 class="rail-title">Your circle <span>${String(list.length).padStart(2,'0')}</span></h2>${list.length?list.map(c=>`<div class="rail-person">${avatar(c)}<div class="rail-person-name">${esc(c.name)}<small>${esc(c.descriptor)}</small></div><button class="icon-button" ${action('profile',c.id)} aria-label="View ${esc(c.name)}">${icon('arrow',14)}</button></div>`).join(''):'<p class="field-help">Follow a creator to start your circle.</p>'}<a href="#discover" class="text-link">Discover a new voice ${icon('plus',12)}</a></div>${note?`<div class="rail-note"><span class="eyebrow">A note from the studio</span><blockquote>“${esc(note.text.length>120?note.text.slice(0,117)+'…':note.text)}”</blockquote><p>${esc(creator(note.creatorId).name)} · ${date(note.date)}</p><button class="text-link bare" ${action('open-contact',note.creatorId)}>Open the conversation ${icon('arrow',13)}</button></div>`:''}<div class="rail-footer">No ads. No algorithm.<br>Just the people you choose.<br><a href="/index.html">The REFLUENZ manifesto ↗</a></div></aside>`;
}
function atelierView() {
  let posts=published();
  if(activeFilter==='Following')posts=posts.filter(p=>state().following.includes(p.creatorId));
  else if(activeFilter!=='All entries')posts=posts.filter(p=>p.category===activeFilter);
  const first=posts[0];
  return heading('Selected for a slower scroll','Your daily edit.','Good work, from people with a point of view.','<div class="date-stamp">A considered collection<br>Edition 001</div>')+
  `<div class="content-columns"><div><div class="edition-tabs" role="group" aria-label="Filter entries">${['All entries','Following',...categories].map(f=>`<button ${action('filter',f)} class="${activeFilter===f?'active':''}" aria-pressed="${activeFilter===f}">${f}</button>`).join('')}</div>${first?feature(first):empty('A little room for discovery.','Follow a creator or choose another category to find your next read.')}${posts.length>1?`<div class="subhead"><h2>From the atelier</h2><span>${posts.length-1} entries to explore</span></div><div class="entry-grid">${posts.slice(1).map(card).join('')}</div>`:''}${!state().welcomeDismissed?`<div class="welcome-card"><p>A space that feels like you.<small>Complete your profile, then find your first circle.</small></p><a class="text-link" href="#settings">Make it yours ${icon('arrow',14)}</a><button class="icon-button" ${action('dismiss-welcome')} aria-label="Dismiss welcome">${icon('close',14)}</button></div>`:''}</div>${rail()}</div>`;
}
const kindFilters = {all:'All types', text:'Text', image:'Images', video:'Video'};
function discoverView() {
  // Sorted once, then looked up by creator: nothing in here sorts or scans the entry list once per creator or per entry.
  const q=query.toLowerCase(), names=new Map(state().creators.map(c=>[c.id,c.name])), pub=published().filter(p=>kindFilter==='all'||kindOf(p)===kindFilter), authors=new Set(pub.map(p=>p.creatorId));
  const cs=state().creators.filter(c=>(category==='All'||c.category===category)&&`${c.name} ${c.descriptor} ${c.bio}`.toLowerCase().includes(q)&&(kindFilter==='all'||authors.has(c.id)));
  const ps=pub.filter(p=>(category==='All'||p.category===category)&&`${p.title} ${p.subtitle} ${names.get(p.creatorId)??blank.name}`.toLowerCase().includes(q));
  return heading('Independent voices','Find your people.','Follow a point of view. Stay for the conversation.')+`<div class="filter-row"><form class="search-box" data-form="search">${icon('search',16)}<input name="query" aria-label="Search discovery" value="${esc(query)}" maxlength="100" placeholder="A name, an idea, a point of view…"></form><div class="filter-selects"><select id="category" aria-label="Filter by category">${['All',...categories].map(c=>`<option ${c===category?'selected':''}>${c}</option>`).join('')}</select><select id="format-filter" aria-label="Filter by type">${Object.entries(kindFilters).map(([k,l])=>`<option value="${k}" ${k===kindFilter?'selected':''}>${l}</option>`).join('')}</select></div></div><p class="results-label">${query?`Results for “${esc(query)}” · `:''}${cs.length} creators · ${ps.length} entries</p><div class="creator-grid">${cs.map(c=>`<article class="creator-card"><div class="creator-cover"><img src="${image(c.image)}" alt="${esc(c.descriptor||c.category)}" loading="lazy"><span class="eyebrow">${esc(c.location)}</span></div><div class="creator-details"><div class="creator-name"><h2>${esc(c.name)}</h2><span class="eyebrow bronze">${esc(c.category)}</span></div><p>${esc(c.bio)}</p><div class="creator-actions"><button class="text-link bare" ${action('profile',c.id)}>Visit atelier ${icon('arrow',14)}</button>${c.id===mine()?.id?'':followButton(c.id)}</div></div></article>`).join('')}</div>${ps.length?`<div class="subhead section-space"><h2>Entries to spend time with</h2><span>${ps.length} entries</span></div><div class="entry-grid full-grid">${ps.map(card).join('')}</div>`:''}${!cs.length&&!ps.length?`<div class="empty"><h3>No matches this time.</h3><p>Try a creator’s name, “style”, or a shorter search.</p>${btn('Clear search','clear-search')}</div>`:''}`;
}
function followButton(id) {const on=state().following.includes(id);return `<button class="button secondary small" ${action('follow',id)} aria-pressed="${on}">${icon(on?'check':'plus',13)} ${on?'Following':'Follow'}</button>`;}
function archiveView() {
  const ps=published().filter(p=>state().saved.includes(p.id));
  return heading('Collected, not consumed','Your private archive.','The ideas you want to keep close.',ps.length?btn(`${icon('export',15)} Export list`,'export-archive'):'')+(ps.length?`<div class="entry-grid full-grid">${ps.map(card).join('')}</div>`:empty('Keep something worth returning to.','Use the bookmark on any entry to start your personal collection.','atelier','Find your first entry'));
}
function bubble(m, mineSide, who) {
  return `<div class="chat-message ${mineSide?'mine':''}"><div class="bubble">${esc(m.text)}</div><small>${esc(who)} · ${date(m.date)}</small></div>`;
}
function circleView() {
  const s=state();
  if(role()==='creator'&&mine()) {
    const me=mine(), threads=[...new Map(s.messages.filter(m=>m.creatorId===me.id).map(m=>[m.memberId,m.memberName])).entries()];
    if(!contact||!threads.some(([id])=>id===contact))contact=threads[0]?.[0]||'';
    const thread=s.messages.filter(m=>m.creatorId===me.id&&m.memberId===contact), name=threads.find(([id])=>id===contact)?.[1]||'';
    return heading('A direct line','Your circle.','Conversations members have started with your atelier.')+`<div class="conversation-layout"><aside class="conversation-list"><h2>Conversations</h2>${threads.length?threads.map(([id,n])=>`<button class="conversation-person ${contact===id?'active':''}" ${action('contact',id)} aria-pressed="${contact===id}">${avatar({name:n})}<span><strong>${esc(n)}</strong><small>Member</small></span></button>`).join(''):'<p class="field-help">No conversations yet.</p>'}</aside><section class="conversation-main">${contact?`<header class="conversation-header"><div><h2>${esc(name)}</h2><p>Member of your circle</p></div></header><div class="conversation-history" aria-label="Conversation history">${thread.map(m=>bubble(m,m.from==='creator',m.from==='creator'?'You':name)).join('')}</div><form class="conversation-form" data-form="message"><label class="visually-hidden" for="message-text">Your reply</label><textarea id="message-text" name="text" required maxlength="2000" placeholder="Write a reply…"></textarea><button class="button" type="submit">${icon('send',16)}<span>Reply</span></button></form>`:`<div class="empty"><h3>A quiet inbox.</h3><p>When a member writes to your atelier, the conversation appears here. Share a circle note to start one.</p>${btn(`${icon('message',15)} Write a circle note`,'broadcast','','button secondary')}</div>`}</section></div>`;
  }
  const people=s.creators.filter(c=>c.id!==mine()?.id);
  if(!contact||!people.some(c=>c.id===contact))contact=(people.find(c=>s.following.includes(c.id))||people[0])?.id||'';
  const c=creator(contact);
  const thread=[...s.notes.filter(n=>n.creatorId===c.id).map(n=>({...n,from:'note'})),...s.messages.filter(m=>m.creatorId===c.id&&m.memberId===user.id)].sort((a,b)=>new Date(a.date)-new Date(b.date));
  return heading('A direct line','Your circle.','A quieter place for the conversation to continue.')+`<div class="conversation-layout"><aside class="conversation-list"><h2>Conversations</h2>${people.map(p=>`<button class="conversation-person ${contact===p.id?'active':''}" ${action('contact',p.id)} aria-pressed="${contact===p.id}">${avatar(p)}<span><strong>${esc(p.name)}</strong><small>${esc(p.category)}${s.following.includes(p.id)?' / Following':''}</small></span></button>`).join('')}</aside><section class="conversation-main">${contact?`<header class="conversation-header"><div><h2>${esc(c.name)}</h2><p>${esc(c.descriptor)}</p></div><button class="icon-button" ${action('profile',c.id)} aria-label="View creator">${icon('arrow')}</button></header><div class="conversation-history" aria-label="Conversation history">${thread.length?thread.map(m=>bubble(m,m.from==='member',m.from==='member'?'You':m.from==='note'?`${c.name} · Circle note`:c.name)).join(''):'<div class="empty"><h3>Start a conversation.</h3><p>Ask a question about an entry. Only you and the creator can read this thread.</p></div>'}</div><form class="conversation-form" data-form="message"><label class="visually-hidden" for="message-text">Your message</label><textarea id="message-text" name="text" required maxlength="2000" placeholder="Something on your mind?"></textarea><button class="button" type="submit">${icon('send',16)}<span>Send</span></button></form><div class="conversation-note">Private between you and ${esc(c.name)}.</div>`:'<div class="empty"><h3>No creators yet.</h3></div>'}</section></div>`;
}
function membershipsView() {
  const memberships=Object.entries(state().memberships);
  return heading('Choose your level of connection','Your memberships.','A home for the creators you choose to support.')+`<div class="membership-summary"><div><div class="eyebrow bronze">Monthly total once payments launch</div><p class="field-help">${memberships.length} memberships · free during early access</p></div><strong>${money(membershipTotal(state()))}<small> / month</small></strong></div>${memberships.length?memberships.map(([id,tierId])=>{const c=creator(id),t=tier(tierId);return `<div class="membership-row">${avatar(c)}<div><h3>${esc(c.name)}</h3><p>${esc(t?.name)} · ${money(t?.price)} / month · Free in early access</p></div>${btn('Manage','membership',id)}${btn('Cancel','cancel-membership',id)}</div>`}).join(''):empty('A circle starts with one connection.','Visit a creator’s atelier to explore their memberships.','discover','Discover creators')}`;
}
function settingsView() {
  const s=state();
  return heading('A few personal details','Make yourself at home.','Your profile, shaped around you.')+`<div class="settings-layout"><div><section class="settings-section"><h2>Your profile</h2><p>Your display name is visible to creators you write to or join.</p><form data-form="profile"><div class="field"><label for="profile-name">Display name</label><input id="profile-name" name="name" value="${esc(s.profile.name)}" required maxlength="60"></div><div class="field"><label for="profile-bio">A line about you</label><textarea id="profile-bio" name="bio" maxlength="240">${esc(s.profile.bio)}</textarea></div><label class="check-label"><input name="compact" type="checkbox" ${s.preferences.compact?'checked':''}> Use compact entry cards</label><button class="button">Save profile ${icon('check',16)}</button></form></section></div><div><section class="settings-section"><h2>Your account</h2><p>Signed in as <strong>${esc(user?.email||'')}</strong>.</p>${btn('Sign out','sign-out')}</section><section class="settings-section"><h2>Your memberships</h2><p>${Object.keys(s.memberships).length} active memberships. Change or cancel them at any time.</p><a class="button secondary" href="#memberships">Manage memberships ${icon('arrow',15)}</a></section><section class="settings-section"><h2>Your data belongs with you.</h2><p>Export your profile, follows, saved entries, memberships and conversations as JSON.</p>${btn(`${icon('export',15)} Export my data`,'export-data')}</section><section class="settings-section"><h2>Early access</h2><p>REFLUENZ is free to join. Paid memberships will be enabled once payments launch; until then, joining a circle costs nothing.</p><a class="text-link" href="/index.html">Back to the introduction ${icon('arrow',14)}</a></section></div></div>`;
}
function atelierForm(c) {
  const v=c||{name:state().profile.name,category:'Style',descriptor:'',location:'',bio:'',image:'atelier'};
  return `<form class="dialog-body" data-form="atelier"><div class="field"><label for="atelier-name">Atelier name</label><input id="atelier-name" name="name" required minlength="2" maxlength="60" value="${esc(v.name)}"></div><div class="field"><label for="atelier-descriptor">What you make</label><input id="atelier-descriptor" name="descriptor" maxlength="60" placeholder="e.g. Architecture & spaces" value="${esc(v.descriptor)}"></div><div class="field"><label for="atelier-location">Location</label><input id="atelier-location" name="location" maxlength="60" placeholder="City, Country" value="${esc(v.location)}"></div><div class="field"><label for="atelier-category">Category</label><select id="atelier-category" name="category">${categories.map(x=>`<option ${v.category===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label for="atelier-image">Cover study</label><select id="atelier-image" name="image">${covers.map(i=>`<option value="${i}" ${v.image===i?'selected':''}>${i[0].toUpperCase()+i.slice(1)}</option>`).join('')}</select></div><div class="field"><label for="atelier-bio">Your point of view</label><textarea id="atelier-bio" name="bio" maxlength="400" placeholder="A few lines for the people who find you">${esc(v.bio)}</textarea></div><div id="atelier-error" class="form-error" role="alert"></div><div class="dialog-actions"><button class="button">${c?'Save atelier':'Open my atelier'} ${icon('arrow',14)}</button></div></form>`;
}
function studioView() {
  if(role()!=='creator'||!mine())return heading('The other side of the circle','Your work deserves a home.','Open an atelier to publish entries and build a circle of members.')+`<div class="empty">${icon('studio',30)}<h3>Open your atelier.</h3><p>It takes a minute. You can keep reading as a member at any time.</p>${btn('Open my atelier','open-atelier','','button')}</div>`;
  const me=mine(),own=state().entries.filter(p=>p.creatorId===me.id),visible=own.filter(p=>p.status===studioTab).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const members=circleMembers||[], total=members.reduce((n,m)=>n+(tier(m.tier)?.price||0),0);
  return heading(`${esc(me.name)} / Creator workspace`,'Inside your studio.','Give your next idea a place to become something.',btn(`${icon('plus',16)} New entry`,'new-entry','','button'))+
  `<div class="studio-grid"><div><div class="metric-grid"><div class="metric"><span class="eyebrow">Published entries</span><strong>${own.filter(p=>p.status==='published').length}</strong><small>In your atelier</small></div><div class="metric"><span class="eyebrow">Members</span><strong>${circleMembers?members.length:'—'}</strong><small>Across all tiers</small></div><div class="metric"><span class="eyebrow">Monthly value</span><strong>${circleMembers?money(total):'—'}</strong><small>Once payments launch</small></div></div><div class="edition-tabs" role="group" aria-label="Studio view">${['published','draft','members'].map(t=>`<button class="${studioTab===t?'active':''}" ${action('studio-tab',t)} aria-pressed="${studioTab===t}">${t==='draft'?'Drafts':t==='members'?'Members':'Published'}</button>`).join('')}</div>${studioTab==='members'?`<div class="subhead"><h2>Your circle</h2>${members.length?btn(`${icon('export',14)} Export CSV`,'export-members'):''}</div>${members.length?`<div class="table-wrap"><table class="member-table"><thead><tr><th>Member</th><th>Membership</th><th>Joined</th></tr></thead><tbody>${members.map(m=>`<tr><td>${esc(m.name)}</td><td>${esc(tier(m.tier)?.name)}</td><td>${date(m.joined)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><h3>Your circle is forming.</h3><p>Members who join any of your tiers appear here.</p></div>`}`:visible.length?visible.map(p=>`<article class="studio-entry">${thumb(p,'Entry cover').img}<div><h3>${esc(p.title)}</h3><p>${kindBadge(p)}${esc(p.format)} · ${size(p,true)} · ${date(p.date)}</p><span class="status-label">${p.status==='draft'?'Draft · Only in your studio':p.access==='public'?'Open to everyone':`${esc(tier(p.access)?.name)} members`}</span></div><div class="actions"><button class="icon-button" ${action('read',p.id)} aria-label="Preview ${esc(p.title)}">${icon('play',16)}</button><button class="icon-button" ${action('edit',p.id)} aria-label="Edit ${esc(p.title)}">${icon('studio',16)}</button><button class="icon-button" ${action('delete-entry',p.id)} aria-label="Delete ${esc(p.title)}">${icon('trash',16)}</button></div></article>`).join(''):`<div class="empty"><h3>A clean page.</h3><p>Your next entry starts with an observation.</p>${btn('Write an entry','new-entry','','button')}</div>`}</div><aside class="studio-aside"><span class="eyebrow bronze">A note to your circle</span><h2>Keep the conversation close.</h2><p>A small update, a question, a new direction. Notes appear in every member’s conversation with you.</p>${btn(`${icon('message',15)} Write a note`,'broadcast','','button secondary')}<div class="divider"></div><span class="eyebrow muted">Your atelier</span><p class="field-help">${esc(me.descriptor||me.category)}<br>${esc(me.location)}<br>${esc(me.name)}</p>${btn('Edit atelier','edit-atelier','','text-link bare')}${btn('View as a member','role','member','text-link bare')}</aside></div><div class="studio-mobile-note">${btn(`${icon('message',15)} Write a circle note`,'broadcast')}</div>`;
}
function render() {
  const draft=document.querySelector('#message-text')?.value;
  if(authReady&&(!user||recovering)){app.innerHTML=authView();document.title='Sign in — REFLUENZ';return;}
  if(!data){app.innerHTML=`<main id="main" class="auth-screen loading-screen" tabindex="-1"><div class="auth-panel"><a class="wordmark" href="/index.html">REFLUENZ</a>${loadError?`<div class="error-banner" role="alert">${esc(loadError)}</div>${btn('Try again','retry','','button')}`:'<p class="eyebrow">Opening your atelier…</p>'}</div></main>`;return;}
  const view=route(), views={atelier:atelierView,discover:discoverView,archive:archiveView,circle:circleView,memberships:membershipsView,settings:settingsView,studio:studioView};
  const focused=document.activeElement;
  const focusAction=focused?.dataset?.action, focusId=focused?.dataset?.id, focusSelect=['category','format-filter'].includes(focused?.id)?focused.id:'';
  app.innerHTML=shell((views[view]||atelierView)());
  if(draft&&document.querySelector('#message-text'))document.querySelector('#message-text').value=draft;
  document.querySelector('.conversation-history')?.scrollTo(0,100000);
  if(focusAction && globalThis.CSS) document.querySelector(`[data-action="${CSS.escape(focusAction)}"][data-id="${CSS.escape(focusId||'')}"]`)?.focus({preventScroll:true});
  if(focusSelect)document.querySelector(`#${focusSelect}`)?.focus({preventScroll:true});
  document.title=`${pages[view]||'The atelier'} — REFLUENZ`;
  if(view==='studio'&&mine()&&!circleMembers)loadMembers();
  hydrateMedia();
}
async function loadMembers(){const session=epoch;try{const list=await api.circleMembers(mine().id);if(epoch!==session)return;circleMembers=list;if(route()==='studio')render()}catch(e){if(epoch===session)toast(e.message)}}

// Reader, profile and membership dialogs use escaped text throughout.
const paragraphs = text => text.trim() ? text.split('\n\n').map(t => `<p>${esc(t)}</p>`).join('') : '';
const figures = (list, title) => list.map((m, i) => `<figure class="reader-figure"><img src="${esc(m.url)}" alt="${esc(m.alt || `${title}, image ${i + 1}`)}" loading="lazy"${dim(m.width) && dim(m.height) ? ` width="${dim(m.width)}" height="${dim(m.height)}"` : ''}></figure>`).join('');
const player = (m, title) => `<video class="reader-video" controls preload="metadata" playsinline aria-label="${esc(title)}, video" src="${esc(m.url)}"${m.poster ? ` poster="${esc(m.poster)}"` : ''}></video>`;
// The media of one kind that the reader shows, with signed URLs: every image, or the first video. Only called for entries the
// viewer can read; locked entries never reach this. `missing` counts the files that could not be signed. Throws when the media
// lookup or the signing call fails as a whole; the caller shows the text without the media instead of giving up.
// The rows are always read again (one cheap query): the creator may have changed the files since a card cached them. The reader shows the
// originals; a film's poster is only signed for the player.
async function readerMedia(id, kind) {
  const session = epoch, before = (mediaCache.get(id) || []).map(m => m.id).join();
  const found = await api.media([id]), list = found?.[id] || [];
  if (epoch !== session) return {items: [], missing: 0};
  mediaCache.set(id, list);
  if (list.map(m => m.id).join() !== before) thumbs.delete(id);   // the card cover may belong to a file that is gone
  const rows = list.filter(m => m.kind === kind), wanted = kind === 'video' ? rows.slice(0, 1) : rows;
  const paths = [...new Set(wanted.flatMap(m => [m.path, kind === 'video' ? m.posterPath : null]).filter(Boolean))];
  const urls = paths.length ? (await api.signedUrls(paths)) || {} : {};
  if (epoch !== session) return {items: [], missing: 0};
  const items = wanted.filter(m => urls[m.path]).map(m => ({...m, url: urls[m.path], poster: urls[m.posterPath] || ''}));
  if (items.length < wanted.length) thumbs.delete(id);
  return {items, missing: wanted.length - items.length};
}
const readerActions = (p, c) => `${p.status==='published'?saveButton(p)+`<button class="icon-button ${state().liked.includes(p.id)?'liked':''}" ${action('like',p.id)} aria-label="Appreciate this entry" aria-pressed="${state().liked.includes(p.id)}">${icon('heart',18)}</button><button class="icon-button" ${action('share',p.id)} aria-label="Copy entry link">${icon('export',18)}</button>`:''}${btn('Visit atelier','profile',c.id,'button secondary small')}`;
// Appreciating or saving only changes the buttons: the dialog is not rebuilt, so a film keeps playing and the gallery is not decoded again.
function syncReaderActions(id) {
  const p=entry(id), box=modal.querySelector('.reader-actions'); if(!p||!box)return;
  const had=box.contains?.(document.activeElement)?document.activeElement:null;
  box.innerHTML=readerActions(p,creator(p.creatorId));
  if(had&&globalThis.CSS)box.querySelector(`[data-action="${CSS.escape(had.dataset.action||'')}"][data-id="${CSS.escape(had.dataset.id||'')}"]`)?.focus({preventScroll:true});
}
async function readEntry(id) {
  const p=entry(id); if(!p)return toast('That entry is no longer available.');
  const c=creator(p.creatorId),own=mine()?.id===p.creatorId,kind=kindOf(p),session=epoch;
  if(p.status==='draft'&&!own)return toast('This entry is still in the studio.');
  const ticket=++openTicket, stale=()=>epoch!==session||ticket!==openTicket;
  // The caption and the media are fetched at the same time. The media may fail without taking the words with it.
  const early=kind!=='text'&&canRead(p,state())?readerMedia(id,kind):null;
  early?.catch(()=>{});
  if(!bodies.has(id)){let b;try{b=await api.body(id)}catch(e){return stale()?undefined:toast(e.message)}if(stale())return;bodies.set(id,b)}
  if(stale())return;
  const body=bodies.get(id), allowed=body!=null||(kind!=='text'&&canRead(p,state()));
  let shown=[], unavailable=false;
  if(kind!=='text'&&allowed){try{const found=await(early??readerMedia(id,kind));shown=found.items;unavailable=found.missing>0}catch{unavailable=true}}
  if(stale())return;
  readerId=id;
  const cover=kind==='text'||(!allowed&&!p.previewUrl)?`<img class="reader-cover" src="${image(p.image)}" alt="${esc(p.category)} editorial cover">`:allowed?'':`<div class="reader-preview is-preview"><img src="${esc(p.previewUrl)}" alt=""></div>`;
  // The words are the entry; the media is fetched separately and may fail, so the reader opens either way and says so.
  const retry=unavailable?`<div class="media-retry" role="status"><p class="field-help">Some media could not be loaded just now.</p>${btn('Try again','read',id)}</div>`:'';
  const gallery=!allowed||kind==='text'?'':`<div class="reader-media">${shown.length?(kind==='image'?figures(shown,p.title):player(shown[0],p.title))+retry:retry||`<p class="field-help">No ${kind==='image'?'images have':'video has'} been added yet.</p>`}</div>`;
  const paras=paragraphs(allowed?body??'':p.excerpt??'');
  openModal(`<span class="eyebrow">${esc(c.name)} / ${esc(p.format)}${p.status==='draft'?' / Draft preview':''}</span>`,
   `${cover}<article class="reader-content"><div class="eyebrow bronze">${esc(p.category)} · ${p.access==='public'?'Open entry':esc(tier(p.access)?.name||p.access)+' circle'}</div><h2>${esc(p.title)}</h2><p class="reader-deck">${esc(p.subtitle)}</p><div class="reader-byline">By ${esc(c.name)} · ${date(p.date)} · ${size(p,true)}${own?' · Your entry':''}</div>${gallery}${paras||kind==='text'?`<div class="reader-body">${paras}</div>`:''}${!allowed?`<div class="reader-lock">${icon('lock',24)}<h3>There’s more inside the circle.</h3><p>This entry is part of ${esc(c.name)}’s ${esc(tier(p.access)?.name||p.access)} membership. Join the circle to keep reading — free during early access.</p>${btn('Explore memberships','membership',c.id,'button')}</div>`:''}<div class="reader-actions">${readerActions(p,c)}</div></article>`,'reader');
}
function profile(id) {
  const c=creator(id),ps=published().filter(p=>p.creatorId===id),own=mine()?.id===id;
  openModal('The creator’s atelier',`<div class="dialog-body"><div class="creator-profile-head">${avatar(c)}<div><h3>${esc(c.name)}</h3><p>${esc(c.descriptor)}${c.location?' · '+esc(c.location):''}</p></div></div><p>${esc(c.bio)}</p><div class="dialog-actions">${own?btn('Open your studio','role','creator','button'):followButton(c.id)+btn('Explore memberships','membership',c.id,'button')+btn('Conversation','open-contact',c.id)}</div><div class="subhead section-space"><h2>From this atelier</h2><span>${ps.length} entries</span></div>${ps.map(p=>`<div class="profile-entry-row"><button class="entry-title" ${action('read',p.id)}>${esc(p.title)} ${icon('arrow',14)}</button><span class="eyebrow muted">${accessLabel(p.access)} · ${size(p)}</span></div>`).join('')}</div>`);
}
function membership(id,chosen) {
  if(mine()?.id===id)return toast('This is your own atelier.');
  membershipCreator=id;selectedTier=chosen||state().memberships[id]||'essential';
  const c=creator(id),current=state().memberships[id];
  openModal(`Join ${esc(c.name.split(' ')[0])}’s circle.`,`<div class="dialog-body"><p>A little closer to the work. Choose the level of connection that suits you.</p><div class="membership-grid">${state().tiers.map(t=>`<button class="tier-option ${selectedTier===t.id?'selected':''}" ${action('select-tier',t.id)} aria-pressed="${selectedTier===t.id}"><strong>${esc(t.name)}</strong><div class="price">${money(t.price)}<small> / mo</small></div><p>${esc(t.description)}</p><ul>${t.features.map(f=>`<li>${icon('check',11)} ${esc(f)}</li>`).join('')}</ul></button>`).join('')}</div><div class="notice section-space">Early access: joining is free. Prices shown will apply once payments launch, and you will be asked before anything is charged.</div><div class="dialog-actions">${btn(current===selectedTier?'Your current plan':current?'Change membership':'Join the circle','activate-membership',id,'button')}${current?btn('Cancel membership','cancel-membership',id):''}</div></div>`,'membership-dialog');
}
// --- Editor: text, image and video entries ---------------------------------
const formatsFor = k => k === 'text' ? textFormats : formats;
const formatOptions = (k, current) => formatsFor(k).map(f => `<option ${f === current ? 'selected' : ''}>${f}</option>`).join('');
const kindNames = {text: 'Text', image: 'Image', video: 'Video'};
const bodyLabel = k => k === 'text' ? 'Your entry' : 'Caption (optional)';
const bodyHint = k => k === 'text' ? 'What have you been noticing?' : 'Say a little about this work, or leave it empty.';
const bodyHelp = k => k === 'text' ? 'Plain text. Separate paragraphs with a blank line. The first paragraph is the free preview of member entries.' : 'Optional. Plain text; separate paragraphs with a blank line. The first paragraph is the free preview of member entries.';
// Media posts show their own picture on cards, so the big preset preview goes; the preset stays as the fallback while that loads or if it cannot.
const coverNote = k => `Cards show your ${k === 'video' ? 'video’s poster frame' : 'first image'}. The editorial cover stays as the fallback card image.`;
const maxItems = k => k === 'video' ? 1 : media.LIMITS?.maxImages || 10;
const fileSize = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const blobUrl = file => { try { return URL.createObjectURL(file); } catch { return ''; } };
const itemName = (it, n) => it.name || it.file?.name || String(it.media?.path || '').split('/').pop() || `Item ${n}`;
// Errors about the files (wrong type, too many, a format that cannot change yet) appear in the media section, right next to the controls
// that caused them; errors about saving stay at the bottom. Either one is brought into view, because the dialog scrolls.
const showError = (el, text) => { if (el) { el.textContent = text; if (text) el.scrollIntoView?.({block: 'nearest'}); } };
function setEditorError(text) {
  if (!text) { mediaNote = ''; showError(modal.querySelector('#media-error'), ''); }
  showError(modal.querySelector('#entry-error'), text);
}
function setMediaError(text) {
  mediaNote = text;
  const el = modal.querySelector('#media-error');
  if (el && editorKind !== 'text') return showError(el, text);
  showError(modal.querySelector('#entry-error'), text);
}
// The status line is read aloud by screen readers. Saying the same words twice would not be announced again, so a repeat is cleared first.
let sayTimer;
function say(text) {
  const el = modal.querySelector('#editor-status'); if (!el) return;
  clearTimeout(sayTimer);
  if (text && el.textContent === text) { el.textContent = ''; sayTimer = setTimeout(() => { el.textContent = text; }, 50); } else el.textContent = text;
}
function revoke(it) { for (const u of new Set([it.url, it.src, it.thumb])) if (String(u || '').startsWith('blob:')) try { URL.revokeObjectURL(u); } catch {} }
function releaseEditor() { editorMedia.forEach(revoke); editorMedia = []; editorRemoved = []; editorUploaded.clear(); editorKind = 'text'; mediaNote = ''; kindLockShown = false; }
// Once files are attached the other post types are off limits until they are removed: say so instead of failing after the tap.
const kindSwitch = () => kinds.map(k => `<button type="button" class="${editorKind === k ? 'active' : ''}" ${action('kind', k)} aria-pressed="${editorKind === k}"${editorMedia.length && editorKind !== k ? ` aria-disabled="true" title="Remove the ${editorKind === 'video' ? 'video' : 'images'} to change the post type"` : ''}>${icon(k, 15)}<span>${kindNames[k]}</span></button>`).join('');
function syncKindSwitch() {
  const sw = modal.querySelector('#editor-kind'), lock = editorMedia.length > 0;
  if (!sw || lock === kindLockShown) return;
  kindLockShown = lock;
  if (!sw.contains?.(document.activeElement)) sw.innerHTML = kindSwitch();
}
const progressBar = (it, n) => it.progress == null ? '' : `<div class="progress" data-progress="${it.key}" role="progressbar" aria-label="Upload progress, ${esc(itemName(it, n))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(it.progress * 100)}"><span data-progress-fill="${it.key}" style="width:${Math.round(it.progress * 100)}%"></span></div>`;
// Each file that failed says why, next to itself (the summary above the buttons names the first one); a cancelled one has no reason to give.
const sentence = text => /[.!?…]$/.test(text) ? text : `${text}.`;
const failedNote = it => it.failed ? `<p class="upload-status">Not uploaded${it.error ? `: ${esc(sentence(it.error))}` : '.'} It will be sent again when you save.</p>` : '';
// The grid shows a small copy of each new picture (made once, see makeThumbs), never the full-size file; until it exists a placeholder stands in.
const itemPic = it => { const src = it.thumb || (it.file && media.thumbnail && !it.noThumb ? '' : it.url); return src ? `<img src="${esc(src)}" alt="" decoding="async">` : icon('image', 22); };
function imageItem(it, i) {
  const n = i + 1, off = saving ? ' disabled' : '', name = esc(itemName(it, n));
  return `<li class="upload-item${it.failed ? ' is-failed' : ''}"><div class="upload-thumb" data-thumb="${it.key}"><span class="upload-pic">${itemPic(it)}</span><span class="upload-index">${n}</span></div><div class="upload-body"><label class="visually-hidden" for="alt-${it.key}">Alt text for image ${n}</label><input id="alt-${it.key}" class="upload-alt" data-alt="${it.key}" maxlength="200" placeholder="Alt text" value="${esc(it.alt)}"${off}>${failedNote(it)}<div class="upload-actions"><span class="upload-name" title="${name}">${name}</span><button type="button" class="icon-button" ${action('media-earlier', it.key)} aria-label="Move image ${n} earlier"${off || i === 0 ? ' disabled' : ''}>${icon('back', 15)}</button><button type="button" class="icon-button" ${action('media-later', it.key)} aria-label="Move image ${n} later"${off || i === editorMedia.length - 1 ? ' disabled' : ''}>${icon('arrow', 15)}</button><button type="button" class="icon-button" ${action('media-remove', it.key)} aria-label="Remove image ${n}"${off}>${icon('trash', 15)}</button></div>${progressBar(it, n)}</div></li>`;
}
function videoItem(it) {
  if (!it) return '';
  const detail = [it.file ? fileSize(it.file.size) : '', it.media?.duration > 0 ? media.formatDuration(it.media.duration) : ''].filter(Boolean).join(' · '), name = esc(`${itemName(it, 1)}${detail ? ` · ${detail}` : ''}`);
  return `<div class="video-field${it.failed ? ' is-failed' : ''}"><video class="video-preview" controls preload="metadata" playsinline aria-label="Selected video preview"${it.src ? ` src="${esc(it.src)}"` : ''}${it.poster ? ` poster="${esc(it.poster)}"` : ''}></video>${progressBar(it, 1)}${failedNote(it)}<div class="upload-actions"><span class="upload-name" title="${name}">${name}</span><button type="button" class="icon-button" ${action('media-remove', it.key)} aria-label="Remove video"${saving ? ' disabled' : ''}>${icon('trash', 15)}</button></div></div>`;
}
function mediaSection() {
  const k = editorKind; if (k === 'text') return '';
  const n = editorMedia.length, max = maxItems(k);
  const hint = k === 'image' ? `JPEG, PNG, WebP or GIF. Up to ${max} images; large photos are resized for you and their location and camera details are removed.` : `MP4, WebM or MOV, up to ${Math.round((media.LIMITS?.maxVideoBytes || 52428800) / 1048576)} MB. Videos are uploaded as they are: location and device information stored in the file is not removed.`;
  const zone = n >= max ? '' : `<button type="button" class="dropzone" ${action('pick-files')}${saving ? ' disabled' : ''}>${icon('upload', 22)}<strong>${k === 'image' ? 'Add images' : 'Add a video'}</strong><span id="dropzone-hint"><span class="drop-only">Drop ${k === 'image' ? 'images' : 'a video'} here, or browse. </span><span class="pick-only">Choose ${k === 'image' ? 'images' : 'a video'} from your device. </span>${hint}</span></button>`;
  return `<div class="media-field" role="group" aria-labelledby="media-label"><div class="media-head" tabindex="-1"><span class="eyebrow" id="media-label">${k === 'image' ? `Images <span>${n} of ${max}</span>` : 'Video'}</span></div><div id="media-error" class="form-error" role="alert">${esc(mediaNote)}</div>${zone}${k === 'image' ? (n ? `<ul class="upload-grid">${editorMedia.map(imageItem).join('')}</ul>` : '') : editorMedia.map(it => videoItem(it)).join('')}</div>`;
}
// Only the media section is redrawn, so typed text is never lost. Keyboard focus follows the control that was used: after a removal it goes
// to the item that took its place (index `after`), after a file was added to the section heading when the drop zone is gone.
function renderMedia(after = -1) {
  const host = modal.querySelector('#editor-media'); if (!host) return;
  const had = host.contains?.(document.activeElement) ? document.activeElement : null;
  host.innerHTML = mediaSection();
  syncKindSwitch();
  if (!had || !globalThis.CSS) return;
  const focus = el => el?.focus({preventScroll: true}), fallback = () => host.querySelector('.dropzone:not(:disabled)') || host.querySelector('.media-head');
  const name = had.dataset?.action, id = had.dataset?.id || '';
  if (had.dataset?.alt) return focus(host.querySelector(`[data-alt="${CSS.escape(had.dataset.alt)}"]`) || fallback());
  const find = a => host.querySelector(`[data-action="${CSS.escape(a)}"][data-id="${CSS.escape(id)}"]:not(:disabled)`);
  if (name === 'media-remove' && after >= 0) { const left = Array.from(host.querySelectorAll('[data-action="media-remove"]:not(:disabled)')); return focus(left[Math.min(after, left.length - 1)] || fallback()); }
  const flip = {'media-earlier': 'media-later', 'media-later': 'media-earlier'}[name];
  focus((name && find(name)) || (flip && find(flip)) || fallback());
}
function paintProgress(it) {
  const pct = Math.round((it.progress ?? 0) * 100);
  const fill = modal.querySelector(`[data-progress-fill="${it.key}"]`); if (fill) fill.style.width = `${pct}%`;
  modal.querySelector(`[data-progress="${it.key}"]`)?.setAttribute('aria-valuenow', pct);
}
function setKind(next) {
  if (!kinds.includes(next) || next === editorKind) return;
  if (editorMedia.length) return setMediaError(`This entry already has ${editorKind === 'video' ? 'a video' : 'images'}. Remove ${editorKind === 'video' ? 'it' : 'them'} before switching to ${kindNames[next]}.`);
  const prev = editorKind, text = next === 'text'; editorKind = next; editorDirty = true; setEditorError('');
  const sw = modal.querySelector('#editor-kind'), form = modal.querySelector('.editor-form'), picker = modal.querySelector('#entry-files'), field = modal.querySelector('#entry-body'), format = modal.querySelector('#entry-format'), label = modal.querySelector('#entry-body-label'), help = modal.querySelector('#entry-body-help'), cover = modal.querySelector('#editor-cover-field');
  if (sw) { const focused = sw.contains?.(document.activeElement); kindLockShown = false; sw.innerHTML = kindSwitch(); if (focused) sw.querySelector(`[data-id="${next}"]`)?.focus({preventScroll: true}); }
  if (form) form.dataset.kind = next;
  if (picker) { picker.accept = next === 'video' ? 'video/*' : 'image/*'; picker.multiple = next === 'image'; }
  if (field) { field.required = text; field.minLength = text ? 30 : 0; field.placeholder = bodyHint(next); }
  if (label) label.textContent = bodyLabel(next);
  if (help) help.textContent = bodyHelp(next);
  if (cover) cover.hidden = !text;   // media posts show their own picture; the preset cover is only a fallback
  const note = modal.querySelector('#editor-cover-note'); if (note) { note.hidden = text; note.textContent = coverNote(next); }
  if (format) { const cur = format.value; format.innerHTML = formatOptions(next, cur !== defaultFormat[prev] && formatsFor(next).includes(cur) ? cur : defaultFormat[next]); }
  renderMedia();
}
// Small copies of newly picked images for the grid, made one at a time (each decodes the picture once), and dropped when the item is gone.
function makeThumbs(items) {
  if (editorKind !== 'image' || !media.thumbnail) return;
  for (const it of items) thumbJobs = thumbJobs.then(async () => {
    if (!editorMedia.includes(it) || !it.file) return;
    let blob = null; try { blob = await media.thumbnail(it.file); } catch { /* the file itself is shown instead */ }
    if (!editorMedia.includes(it)) return;
    if (blob) it.thumb = blobUrl(blob); else it.noThumb = true;
    const pic = modal.querySelector(`[data-thumb="${it.key}"] .upload-pic`); if (pic) pic.innerHTML = itemPic(it);
  }).catch(() => {});
}
function addFiles(files) {
  if (!files.length || saving) return;
  if (editorKind === 'text') { const k = media.classify(files[0]); if (!k) return setMediaError('Choose Image or Video to attach files.'); setKind(k); if (editorKind !== k) return; }
  try { media.validateFiles(editorKind, files, editorMedia.length); } catch (error) { return setMediaError(error.message); }
  setEditorError('');
  const fresh = [];
  for (const file of files) { const url = blobUrl(file), it = {key: `m${++itemKey}`, file, name: file.name, alt: '', url, src: url, progress: null}; editorMedia.push(it); fresh.push(it); }
  editorDirty = true; renderMedia(); makeThumbs(fresh);
  say(`${noun(files.length, 'file')} added. ${editorMedia.length} of ${maxItems(editorKind)}.`);
}
function moveMedia(key, by) {
  const i = editorMedia.findIndex(it => it.key === key), j = i + by;
  if (i < 0 || j < 0 || j >= editorMedia.length) return;
  [editorMedia[i], editorMedia[j]] = [editorMedia[j], editorMedia[i]];
  editorDirty = true; setEditorError(''); renderMedia(); say(`Moved to position ${j + 1} of ${editorMedia.length}.`);
}
function removeItem(key) {
  const i = editorMedia.findIndex(it => it.key === key); if (i < 0) return;
  const [it] = editorMedia.splice(i, 1), name = itemName(it, i + 1); revoke(it);
  if (it.media) editorRemoved.push(it.media);
  editorDirty = true; setEditorError(''); renderMedia(i); say(`Removed ${name}. ${noun(editorMedia.length, 'file')} left.`);
}
async function openEditor(id = '') {
  if (role() !== 'creator' || !mine()) return;
  const p = id && entry(id); if (id && (!p || p.creatorId !== mine().id)) return;
  const ticket = ++openTicket, session = epoch, stale = () => epoch !== session || ticket !== openTicket;
  await cleanup;   // files a discarded edit is still removing must be gone before the entry's files are read
  let items = [], strays = [];
  if (id) {
    // The caption and the file list are read together. Text entries have no media, so a failed lookup is not worth stopping for. For image
    // and video entries it is: saving without knowing the files could not clean up after itself.
    const bodyJob = bodies.has(id) ? Promise.resolve(bodies.get(id)) : api.body(id);
    const listJob = api.media([id]).then(found => found?.[id] || [], error => { if (kindOf(p) !== 'text') throw error; return []; });
    const [text, list] = await Promise.all([bodyJob, listJob]);
    if (stale()) return;   // the account changed, the dialog was closed or another entry was opened meanwhile
    if (!bodies.has(id)) bodies.set(id, text);
    mediaCache.set(id, list);
    // Files of another kind than the entry (a save that failed half way can leave some, for example the new video of a switch from
    // images) can never be published with it and the server refuses to. They are queued for removal and the next save clears them.
    const own = list.filter(m => m.kind === kindOf(p)); strays = list.filter(m => m.kind !== kindOf(p));
    const paths = own.flatMap(m => [m.path, m.posterPath]).filter(Boolean);
    let urls = {}; if (paths.length) { try { urls = (await api.signedUrls(paths)) || {}; } catch { /* Thumbnails are optional here. */ } }
    if (stale()) return;
    // The grid shows the small card thumbnail of an image (or a film's poster); `src` is the file itself, for previews.
    items = own.map(m => ({key: `m${++itemKey}`, media: m, alt: m.alt || '', url: urls[m.posterPath] || (m.kind === 'video' ? '' : urls[m.path]) || '', src: urls[m.path] || '', poster: urls[m.posterPath] || '', progress: null}));
  }
  if (stale()) return;
  editor(id, items, strays);
}
function editor(id='', items=[], strays=[]) {
  if(role()!=='creator'||!mine())return;
  const p=id?entry(id):{title:'',subtitle:'',category:mine().category,access:'public',image:mine().image,format:'Essay',kind:'text'};
  if(!p||id&&p.creatorId!==mine().id)return;
  releaseEditor();
  const body=id?bodies.get(id)??'':'', k=kindOf(p), format=formatsFor(k).includes(p.format)?p.format:defaultFormat[k];
  editorId=id;editorDirty=false;editorKind=k;editorMedia=items;editorRemoved=strays;kindLockShown=items.length>0;
  openModal(id?'Edit your entry.':'Start with a point of view.',`<form class="editor-form" data-form="entry" data-kind="${k}"><button type="submit" hidden disabled tabindex="-1" aria-hidden="true" data-guard></button><fieldset class="editor-fields" id="editor-fields"><div class="kind-switch" id="editor-kind" role="group" aria-label="Post type">${kindSwitch()}</div><div class="editor-columns"><div><div class="field"><label for="entry-title">Title</label><input id="entry-title" name="title" required minlength="3" maxlength="100" placeholder="Give your idea a name" value="${esc(p.title)}"></div><div class="field"><label for="entry-subtitle">Introduction</label><input id="entry-subtitle" name="subtitle" maxlength="180" placeholder="A line that invites someone in" value="${esc(p.subtitle)}"></div><div id="editor-media">${mediaSection()}</div><div class="field"><label for="entry-body" id="entry-body-label">${bodyLabel(k)}</label><textarea id="entry-body" name="body" ${k==='text'?'required minlength="30" ':''}maxlength="20000" placeholder="${bodyHint(k)}">${esc(body)}</textarea><p class="field-help" id="entry-body-help">${bodyHelp(k)}</p></div></div><aside><div id="editor-cover-field"${k==='text'?'':' hidden'}><label for="entry-image">Cover study</label><select id="entry-image" name="image">${covers.map(i=>`<option value="${i}" ${p.image===i?'selected':''}>${i[0].toUpperCase()+i.slice(1)}</option>`).join('')}</select><img id="editor-cover" class="editor-cover-preview" src="${image(p.image)}" alt="Selected cover"></div><p class="field-help" id="editor-cover-note"${k==='text'?' hidden':''}>${coverNote(k)}</p><div class="field"><label for="entry-category">Category</label><select id="entry-category" name="category">${categories.map(c=>`<option ${p.category===c?'selected':''}>${c}</option>`).join('')}</select></div><div class="field"><label for="entry-format">Editorial format</label><select id="entry-format" name="format">${formatOptions(k,format)}</select></div><div class="field"><label for="entry-access">Who can read</label><select id="entry-access" name="access">${['public',...state().tiers.map(t=>t.id)].map(a=>`<option value="${a}" ${p.access===a?'selected':''}>${a==='public'?'Everyone':esc(tier(a).name)+' circle'}</option>`).join('')}</select></div></aside></div><div id="entry-error" class="form-error" role="alert"></div><div id="editor-status" class="editor-status" role="status" aria-live="polite" tabindex="-1"></div><div class="editor-footer"><span>Drafts are only visible in your studio.</span><div><button type="button" class="button secondary" ${action('preview-entry')}>Preview</button><button class="button secondary" name="intent" value="draft">Save draft</button><button class="button" name="intent" value="published">${id&&p.status==='published'?'Update entry':'Publish'} ${icon('arrow',14)}</button></div></div><input id="entry-files" type="file" hidden accept="${k==='video'?'video/*':'image/*'}"${k==='image'?' multiple':''}><div id="editor-preview"></div></fieldset><div class="editor-cancel" id="editor-cancel" hidden><button type="button" class="button secondary small" ${action('cancel-upload')}>Cancel upload</button></div></form>`,'editor-dialog');
}
function getEditorValues(){return validateEntry({...Object.fromEntries(new FormData(modal.querySelector('form'))),kind:editorKind},state().tiers);}
// Media rules the form cannot express. The server enforces the same ones when publishing.
function checkMedia(v,status){
  const n=editorMedia.length;
  if(v.kind==='image'&&n>maxItems('image'))throw Error(`Use up to ${maxItems('image')} images.`);
  if(status==='published'&&v.kind==='image'&&!n)throw Error('Add at least one image before publishing.');
  if(v.kind==='video'&&n>1)throw Error('A post holds exactly one video. Remove the extra one.');
  if(status==='published'&&v.kind==='video'&&!n)throw Error('Add a video before publishing.');
}
// Removes media rows (and their files) from the entry in one request. The items leave the list only once they are gone, so a retry continues.
async function dropRemoved(only=()=>true){
  const batch=editorRemoved.filter(only);
  if(!batch.length)return;
  await api.removeMedia(batch);
  for(const m of batch)editorRemoved.splice(editorRemoved.indexOf(m),1);
}
// Frees insert headroom when a retry would otherwise run into the database's transient cap (20 images or 2 videos per entry).
// The only files that may go before the uploads are ones this very session stored and the creator then discarded again after a
// failed save: they were never part of the entry. Only as many as the cap needs are removed, so at least one file of the kind
// (the other originals, or the newest upload) stays and a published entry is never left empty. Everything else waits.
async function makeRoom(kind,incoming){
  const cap=kind==='video'?2:20;
  const held=editorRemoved.filter(m=>m.kind===kind).length+editorMedia.filter(it=>it.media?.kind===kind).length;
  const batch=editorRemoved.filter(m=>m.kind===kind&&editorUploaded.has(m.id)).slice(0,Math.max(0,held+incoming-cap));
  if(!batch.length)return;
  await api.removeMedia(batch);
  for(const m of batch)editorRemoved.splice(editorRemoved.indexOf(m),1);
}
// Save flow (docs/POST_FORMATS.md). The order never varies, so a failed step cannot leave a published entry without its media:
//   1. a draft, when a new entry needs an id for its files   2. upload the new files, two at a time (all of them, before anything goes)
//   3. remove the media the creator deleted, together with   4. order and alt text
//   5. the final save with the real status (the server re-checks the final shape).
// The database tolerates the transient surplus this needs: up to 20 images or 2 videos per entry while a save is running.
// Progress lives on the items, in editorId and in editorRemoved, so a retry resumes instead of repeating. `signal` is the creator's
// Cancel button: it stops the uploads in flight and every step after them; what was stored so far is kept and a retry continues.
async function persistEntry(v,status,signal){
  const stopped=()=>{if(signal?.aborted)throw Error(CANCELLED)};
  const creatorId=mine()?.id, pending=editorMedia.filter(it=>it.file), total=pending.length;
  if(total&&!editorId){say('Saving draft…');editorId=await api.saveEntry(null,v,'draft')}
  if(total)await makeRoom(v.kind,total);
  // Two files at a time: while one is prepared (decoded and re-encoded) the other uploads, so neither the processor nor the network sits idle.
  // Once a file has failed nothing new starts, but the one still running is allowed to finish, so its upload is not thrown away.
  let started=0;
  const failed=await pool(pending,UPLOADS_AT_ONCE,async(it,i)=>{
    it.progress=0;it.failed=false;it.error='';paintProgress(it);
    try{
      stopped();say(v.kind==='video'?'Preparing video…':`Preparing image ${i+1} of ${total}…`);
      const prepared=await(v.kind==='video'?media.prepareVideo(it.file):media.prepareImage(it.file));
      stopped();say(`Uploading ${++started} of ${total}…`);
      it.media=await api.uploadMedia(editorId,creatorId,prepared,{position:editorMedia.indexOf(it),alt:it.alt,signal,onProgress:f=>{it.progress=f;paintProgress(it)}});
      editorUploaded.add(it.media.id);it.file=null;it.progress=1;paintProgress(it);
    }catch(error){
      const cancelled=signal?.aborted;it.progress=null;it.failed=true;it.error=cancelled?'':error.message;
      throw cancelled?error:new Error(`${itemName(it,i+1)}: ${error.message}`,{cause:error});
    }
  },()=>signal?.aborted);
  if(failed.length){
    const [first,...others]=failed;   // each file that failed also says why next to itself; the summary names the first
    throw signal?.aborted||!others.length?first:new Error(`${first.message} ${noun(others.length,'other file')} also failed.`,{cause:first});
  }
  stopped();
  // Removing what the creator deleted and saving the order and descriptions do not depend on each other, so both go out together.
  const changed=editorMedia.map((it,index)=>({it,index})).filter(({it,index})=>it.media&&(it.media.position!==index||(it.media.alt||'')!==it.alt));
  const tidy=editorRemoved.length&&changed.length?'Removing old files and saving the order…':editorRemoved.length?'Removing the old files…':changed.length?'Saving the order and descriptions…':'';
  if(tidy)say(tidy);
  const [removal,updates]=await Promise.all([
    dropRemoved().then(()=>[],error=>[error]),
    pool(changed,UPDATES_AT_ONCE,async({it,index})=>{await api.updateMedia(it.media.id,{alt:it.alt,position:index});it.media={...it.media,alt:it.alt,position:index}})
  ]);
  if(removal.length||updates.length)throw [...removal,...updates][0];
  say(status==='published'?'Publishing…':'Saving…');
  editorId=await api.saveEntry(editorId||null,v,status);
}
// What the creator is told after a failed save: the draft and the finished uploads are still there, and which button continues.
function recoveryNote(){
  if(!editorId)return 'Press Save draft or Publish to try again.';
  const n=editorMedia.filter(it=>it.media&&editorUploaded.has(it.media.id)).length, next=`Press Save draft or ${entry(editorId)?.status==='published'?'Update entry':'Publish'} to continue.`;
  return n?`Your draft and ${noun(n,'uploaded file')} are kept. ${next}`:`Your draft is kept. ${next}`;
}
// While saving, the fields are disabled and the creator gets the Cancel button (outside the disabled fieldset). Keyboard focus moves to the
// status line instead of being stranded on the Publish button that just became disabled.
function lockEditor(on){
  const f=modal.querySelector('#editor-fields');if(f){f.disabled=on;f.setAttribute?.('aria-busy',String(on))}
  const c=modal.querySelector('#editor-cancel');if(c)c.hidden=!on;
  say('');if(on)modal.querySelector('#editor-status')?.focus({preventScroll:true});
}
function download(name, content, type='application/json') {
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const flip=(list,id)=>!list.includes(id);
// Opening a reader or the editor takes a round trip or two. The control that was tapped says so meanwhile (see [aria-busy] in the css)
// and a second tap on it does nothing, instead of the tap feeling dead.
async function whileLoading(target,job){
  if(target?.getAttribute?.('aria-busy')==='true')return;
  target?.setAttribute?.('aria-busy','true');
  try{await job()}finally{target?.removeAttribute?.('aria-busy')}
}

async function handleAction(name,id,target) {
  switch(name) {
    case 'close':closeModal();break;
    case 'retry':loadError='';render();await start();break;
    case 'auth-mode':authMode=id;authNotice='';render();document.querySelector('#auth-email,#auth-name')?.focus();break;
    case 'settings':go('settings');break;
    case 'about':openModal('A quick way in.',`<div class="dialog-body"><p><strong>01 / Discover.</strong> Read an open entry, save it to your archive, and follow a creator whose work speaks to you.</p><p><strong>02 / Connect.</strong> Join a creator’s circle to read member entries, and write to them privately in Your circle.</p><p><strong>03 / Create.</strong> Switch to Creator, open your own atelier, and publish entries for everyone or for a membership tier.</p><div class="notice">Early access: memberships are free until payments launch.</div><div class="dialog-actions">${btn('Make it yours','settings','','button')}${btn('Start exploring','close')}</div></div>`);break;
    case 'role':if(!closeModal())return;setRole(id);circleMembers=null;contact='';go(id==='creator'?'studio':'atelier');break;
    case 'filter':activeFilter=id;render();break;
    case 'save':{const on=flip(state().saved,id);if(await run(()=>api.setBookmark(id,on),on?'Saved to your private archive.':'Removed from your archive.')&&readerId===id)syncReaderActions(id);break;}
    case 'like':{const on=flip(state().liked,id);if(await run(()=>api.setLike(id,on),'',false,false)){state().liked=on?[...state().liked,id]:state().liked.filter(x=>x!==id);if(readerId===id)syncReaderActions(id)}break;}
    case 'read':await whileLoading(target,()=>readEntry(id));break;
    case 'profile':readerId='';profile(id);break;
    case 'follow':{const on=flip(state().following,id);if(await run(()=>api.setFollow(id,on),on?`You’re following ${creator(id).name}.`:'Removed from your following list.')&&modal.open)profile(id);break;}
    case 'dismiss-welcome':await run(()=>api.dismissWelcome());break;
    case 'clear-search':query='';category='All';kindFilter='all';render();break;
    case 'contact':contact=id;render();break;
    case 'open-contact':if(role()==='creator'){setRole('member');}contact=id;go('circle');break;
    case 'membership':readerId='';membership(id);break;
    case 'select-tier':membership(membershipCreator,id);break;
    case 'activate-membership':{
      if(state().memberships[id]===selectedTier){toast('This is already your plan.');break;}
      const tierId=selectedTier;
      if(await run(async()=>{await api.joinCircle(id,tierId);if(!state().following.includes(id))await api.setFollow(id,true)},`Welcome to ${creator(id).name}’s circle.`,false)){clearAccessCaches();closeModal();go('memberships')}
      break;
    }
    case 'cancel-membership':openModal('Leave this circle?',`<div class="dialog-body"><p>Your saved entries will stay in your archive. Member entries will return to preview access.</p><div class="dialog-actions">${btn('Keep membership','membership',id,'button secondary')}${btn('Cancel membership','confirm-cancel',id,'button')}</div></div>`);break;
    case 'confirm-cancel':if(await run(()=>api.leaveCircle(id),'Membership cancelled.')){clearAccessCaches();closeModal()}break;
    case 'share':{
      const url=new URL('/app.html',location.origin);url.hash=`entry/${encodeURIComponent(id)}`;
      try{await navigator.clipboard.writeText(url.href);toast('Entry link copied.')}catch{openModal('Copy this entry link.',`<div class="dialog-body"><label for="share-url">Entry link</label><input id="share-url" readonly value="${esc(url.href)}"></div>`);modal.querySelector('input').select()}break;
    }
    case 'export-data':{const s=state();download('refluenz-my-data.json',JSON.stringify({account:user?.email,profile:s.profile,preferences:s.preferences,following:s.following.map(id=>creator(id).name),saved:published().filter(p=>s.saved.includes(p.id)).map(p=>p.title),memberships:Object.entries(s.memberships).map(([id,t])=>({creator:creator(id).name,tier:t})),messages:s.messages.filter(m=>m.memberId===user?.id).map(m=>({creator:creator(m.creatorId).name,from:m.from,text:m.text,date:m.date})),atelier:mine()},null,2));toast('Your data is exported.');break;}
    case 'export-archive':download('refluenz-reading-list.json',JSON.stringify(published().filter(p=>state().saved.includes(p.id)).map(p=>({title:p.title,creator:creator(p.creatorId).name,access:p.access,url:`${location.origin}/app.html#entry/${p.id}`})),null,2));break;
    case 'sign-out':if(!closeModal())return;try{await api.signOut()}catch(e){toast(e.message)}break;
    case 'studio-tab':studioTab=id;render();break;
    case 'open-atelier':openModal('Open your atelier.',atelierForm(null));break;
    case 'edit-atelier':openModal('Your atelier.',atelierForm(mine()));break;
    case 'new-entry':editor();break;
    case 'edit':await whileLoading(target,async()=>{try{await openEditor(id)}catch(e){toast(e.message)}});break;
    case 'kind':setKind(id);break;
    case 'pick-files':modal.querySelector('#entry-files')?.click();break;
    case 'cancel-upload':if(saving&&uploadAbort){uploadAbort.abort();say('Cancelling…')}break;
    case 'media-earlier':moveMedia(id,-1);break;
    case 'media-later':moveMedia(id,1);break;
    case 'media-remove':removeItem(id);break;
    case 'delete-entry':if(entry(id)?.creatorId===mine()?.id)openModal('Remove this entry?',`<div class="dialog-body"><p>“${esc(entry(id).title)}” will be permanently removed from your atelier and from members’ archives.</p><div class="dialog-actions">${btn('Keep entry','close')}${btn('Delete entry','confirm-delete',id,'button')}</div></div>`);break;
    case 'confirm-delete':if(entry(id)?.creatorId===mine()?.id&&await run(()=>api.deleteEntry(id),'Entry removed.')){bodies.delete(id);mediaCache.delete(id);thumbs.delete(id);closeModal()}break;
    case 'preview-entry':try{const p=getEditorValues();setEditorError('');const first=editorMedia[0],shown=p.kind==='image'?figures(editorMedia.filter(it=>it.src||it.url).map(it=>({url:it.src||it.url,alt:it.alt})),p.title):p.kind==='video'&&first?.src?player({url:first.src,poster:first.poster},p.title):'';modal.querySelector('#editor-preview').innerHTML=`<section class="editor-preview"><div class="eyebrow bronze">Reader preview / ${esc(p.access)}</div><h3>${esc(p.title)}</h3>${shown}${paragraphs(p.body)}</section>`;modal.querySelector('#editor-preview').scrollIntoView({block:'nearest'});say('Preview shown below the buttons.');}catch(e){setEditorError(e.message)}break;
    case 'broadcast':if(role()==='creator'&&mine())openModal('A note to your circle.',`<form class="dialog-body" data-form="broadcast"><p>Your note appears in the conversation of everyone who visits your atelier’s circle.</p><label for="broadcast-text">Your note</label><textarea id="broadcast-text" name="text" required maxlength="2000" placeholder="A small update, a thought, a question…"></textarea><div class="dialog-actions"><button class="button" type="submit">Publish note ${icon('send',15)}</button></div></form>`);break;
    case 'export-members':download('refluenz-members.csv',[['Name','Tier','Joined'],...(circleMembers||[]).map(m=>[m.name,tier(m.tier)?.name||m.tier,m.joined.slice(0,10)])].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('Member list exported.');break;
  }
}
document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(el){e.preventDefault();handleAction(el.dataset.action,el.dataset.id,el)}});
document.addEventListener('change',e=>{
  if(e.target.id==='category'){category=e.target.value;render()}
  if(e.target.id==='format-filter'){kindFilter=Object.hasOwn(kindFilters,e.target.value)?e.target.value:'all';render()}
  if(e.target.id==='entry-image')modal.querySelector('#editor-cover').src=image(e.target.value);
  if(e.target.id==='entry-files'){const files=[...(e.target.files||[])];e.target.value='';addFiles(files)}
});
// Enter in a single-line field of the editor (title, introduction, alt text) must not submit it: the browser would press the form's default
// button, the first submit button, which would be Save draft: that sends a published entry back to draft and uploads every pending file.
// Two guards: this handler, and a hidden, disabled submit button first in the form (a disabled default button blocks implicit submission
// everywhere, including the Go key of a phone keyboard). Save draft and Publish are only ever pressed on purpose.
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.closest?.('[data-form="entry"]'))e.preventDefault()});
document.addEventListener('input',e=>{const it=e.target.dataset?.alt&&editorMedia.find(i=>i.key===e.target.dataset.alt);if(it){it.alt=e.target.value;editorDirty=true}});
// Drop files on the editor. Any file drag over the dialog is claimed so the browser never navigates away to the file.
const fileDrag=e=>Boolean(modal.querySelector('#editor-media'))&&[...(e.dataTransfer?.types||[])].includes('Files');
modal.addEventListener('dragover',e=>{if(!fileDrag(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';e.target.closest?.('.dropzone')?.classList.add('is-over')});
modal.addEventListener('dragleave',e=>e.target.closest?.('.dropzone')?.classList.remove('is-over'));
modal.addEventListener('drop',e=>{if(!fileDrag(e))return;e.preventDefault();modal.querySelector('.dropzone')?.classList.remove('is-over');addFiles([...e.dataTransfer.files])});
modal.addEventListener('input',e=>{if(e.target.closest('[data-form="entry"]'))editorDirty=true});
async function authSubmit(fn){
  if(busy)return;busy=true;const button=document.querySelector('.auth-form .button');if(button)button.disabled=true;
  try{await fn()}catch(error){authNotice=error.message;render()}finally{busy=false;if(button?.isConnected)button.disabled=false}
}
document.addEventListener('submit',async e=>{
  const form=e.target.closest('[data-form]');if(!form)return;e.preventDefault();const values=Object.fromEntries(new FormData(form));
  const email=String(values.email||'').trim(), password=String(values.password||'');
  switch(form.dataset.form){
    case 'signin':await authSubmit(()=>api.signIn(email,password));break;
    case 'signup':{const name=String(values.name||'').trim();if(!name){authNotice='Please enter a display name.';return render()}await authSubmit(async()=>{const {confirmed}=await api.signUp(email,password,name);if(!confirmed){authMode='signin';authNotice=`Almost there. We sent a confirmation link to ${email}. Open it, then sign in.`;render()}});break;}
    case 'forgot':await authSubmit(async()=>{await api.resetPassword(email);authMode='signin';authNotice='If an account exists for that email, a reset link is on its way.';render()});break;
    case 'recover':await authSubmit(async()=>{await api.updatePassword(password);recovering=false;authMode='signin';authNotice='';toast('Your password is updated.');await start()});break;
    case 'search':query=String(values.query||'').trim();go('discover');break;
    case 'profile':{const name=String(values.name||'').trim();if(!name)return toast('Please enter a display name.');await run(()=>api.saveProfile({name:name.slice(0,60),bio:String(values.bio||'').trim().slice(0,240),compact:values.compact==='on'}),'Your profile is saved.');break;}
    case 'message':{
      const text=String(values.text||'').trim().slice(0,2000);if(!text)return toast('Write a message first.');
      const asCreator=role()==='creator'&&mine();
      if(await run(()=>asCreator?api.sendMessage(mine().id,contact,'creator',text):api.sendMessage(contact,user.id,'member',text),'',false)){const box=document.querySelector('#message-text');if(box)box.value='';render()}
      break;
    }
    case 'atelier':{
      let v;try{v=validateAtelier(values)}catch(err){modal.querySelector('#atelier-error').textContent=err.message;return}
      const existing=mine();
      if(await run(()=>api.saveAtelier(v,existing?.id),existing?'Your atelier is updated.':'Your atelier is open. Write your first entry.',false)){closeModal(true);setRole('creator');go('studio')}
      else if(modal.querySelector('#atelier-error'))modal.querySelector('#atelier-error').textContent='That did not save. Check the details and try again.';
      break;
    }
    case 'entry':{
      if(saving)return;
      // Only Save draft or Publish saves. A submit that did not come from one of them (an implicit one from a keyboard, say) does nothing:
      // guessing would either publish a draft or send a published entry back to draft.
      const submitter=e.submitter, intent=submitter?.value;
      if(intent!=='draft'&&intent!=='published')return;
      const status=intent;
      let v;try{v=getEditorValues();checkMedia(v,status)}catch(error){setEditorError(error.message);return}
      setEditorError('');for(const it of editorMedia)if(it.file){it.progress=0;it.failed=false}
      const aborter=uploadAbort=new AbortController(), session=epoch;
      saving=true;lockEditor(true);renderMedia();
      let saved=false,failure=null;
      const ok=await run(async()=>{try{await persistEntry(v,status,aborter.signal);saved=true}catch(error){failure=error}},'',false);
      if(epoch!==session)break;   // the account changed meanwhile: the editor was closed and everything reset
      saving=false;uploadAbort=null;
      // Whether the save finished or stopped half way, files were stored or removed: look them up again next time.
      if(editorId){mediaCache.delete(editorId);thumbs.delete(editorId)}
      if(saved){
        // The save worked even when the reload after it did not. Try the reload once more before telling the creator the list may be stale.
        let stale=!ok;if(stale){try{stale=!await refresh()}catch{ /* the studio shows the older list until the next load */ }if(epoch!==session)break}
        bodies.set(editorId,v.body);editorDirty=false;editorUploaded.clear();closeModal(true);studioTab=status;go('studio');
        toast(stale?'Saved, but your studio could not be refreshed. Reload the page to see the latest.':status==='draft'?'Draft saved in your studio.':'Entry published to your atelier.');
      }else{
        // The entry keeps its id and what was stored, so Save or Publish again continues where this stopped.
        lockEditor(false);for(const it of editorMedia)if(it.file)it.progress=null;renderMedia();
        if(failure)setEditorError(`${aborter.signal.aborted?CANCELLED:failure.message} ${recoveryNote()}`);else toast('Please wait a moment and try again.');
        // Focus returns to the button that started the save, not to the top of the dialog.
        (submitter?.isConnected?submitter:modal.querySelector('button[name="intent"]'))?.focus({preventScroll:true});
      }
      break;
    }
    case 'broadcast':{const text=String(values.text||'').trim();if(!text)return toast('Write a note first.');if(!mine())return;if(await run(()=>api.postNote(mine().id,text),'Your note is shared with your circle.'))closeModal();break;}
  }
});
window.addEventListener('hashchange',()=>{if(!closeModal())return;render();window.scrollTo(0,0);document.querySelector('#main')?.focus({preventScroll:true});if(route()==='entry')readSharedEntry()});
function readSharedEntry(){if(!data)return;try{readEntry(decodeURIComponent(location.hash.slice(7)))}catch{toast('This entry link is not valid.')}}

async function start() {
  const session=epoch;
  try { if(!await refresh())return; loadError=''; }
  catch (error) { if(epoch!==session)return; data=null; loadError=error.message; }
  render();
  if(data&&route()==='entry')readSharedEntry();
}
let live=false;
// Supabase emits INITIAL_SESSION on subscribe, so this is the single entry point.
api.onAuthChange(async(event,session)=>{
  authReady=true;
  const next=session?.user||null;
  if(event==='PASSWORD_RECOVERY'){user=next;recovering=true;authMode='recover';authNotice='';render();return;}
  // No account, or a different one: the open dialog (reader text, signed media, an editor with its draft and local files) and everything
  // cached for the previous user go before anything else is shown. Answers still in flight for them are dropped (see epoch).
  if(!next||(user&&user.id!==next.id)){
    uploadAbort?.abort();uploadAbort=null;saving=false;editorDirty=false;editorUploaded.clear();
    closeModal(true);clearAccessCaches();epoch++;circleMembers=null;contact='';studioTab='published';membershipCreator='';
    query='';category='All';activeFilter='All entries';kindFilter='all';   // the next person does not inherit this one's searches and filters
  }
  if(!next){user=null;data=null;render();return;}
  if(user?.id===next.id&&data)return;
  user=next;data=null;render();await start();
  if(!live){live=true;api.subscribe(async()=>{if(!user||busy)return;try{if(await refresh()&&!modal.open)render()}catch{}})}
});
const params=new URLSearchParams(location.search);
if(params.get('role')==='creator'){setRole('creator');history.replaceState(null,'',`${location.pathname}#studio`);}
render();
return {handleAction, render, hydrateMedia};
}

function safeStorage() {
  try { return window.localStorage; } catch { return {getItem:()=>null, setItem(){}}; }
}
// Runs job(item, index) over the list with at most `limit` jobs in flight. Nothing new starts once a job has failed or `stop()` says so, but
// the jobs already running are awaited, so none is left running behind the caller. Resolves with the errors, in the order they happened.
async function pool(list, limit, job, stop = () => false) {
  const errors = []; let next = 0;
  const worker = async () => {
    while (next < list.length && !errors.length && !stop()) {
      const i = next++;
      try { await job(list[i], i); } catch (error) { errors.push(error); }
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, list.length)}, worker));
  return errors;
}
