// Card covers (docs/POST_FORMATS.md, "Cards").
//
// Text posts show their uploaded cover or an editorial preset. Image and video posts show the blurred public
// preview (or the preset) until their real picture has been signed and has loaded:
//   - one batched `api.media()` for the file lists, one `api.signedUrls()` for the covers,
//   - an image uses its small card thumbnail (`posterPath`) or, when it has none, the file itself; a film its poster,
//   - a thumbnail that cannot be signed is replaced by the image file in a second signing call,
//   - a signed link that fails to load (expired) is signed again once, then the thumbnail gives way to the file,
//   - a link is reused for four minutes (the api hands out links until five minutes before their hour is up),
//   - locked posts only ever show the preview and are never hydrated,
//   - everything is dropped when the account changes, so one person's links never reach the next one.
// Signing is decoration: any failure leaves the placeholder in place and the next render tries again.

import { kindOf } from './format.js';
import { presetUrl } from './constants.js';

export const LINK_TTL_MS = 4 * 60 * 1000;
const MAX_LOAD_FAILURES = 2;

// One cache per store. Replaced when the account (or the api) changes: a run that finds its cache replaced stops.
const caches = new WeakMap();
const accountOf = store => store.state.user?.id ?? null;

function cacheFor(store, api) {
  const account = accountOf(store);
  let cache = caches.get(store);
  if (!cache || cache.api !== api || cache.account !== account) {
    cache = { api, account, files: new Map(), links: new Map(), rejected: new Set(), queue: Promise.resolve() };
    caches.set(store, cache);
  }
  return cache;
}
const isCurrent = (store, cache) => caches.get(store) === cache && accountOf(store) === cache.account;

export function resetCovers(store) {
  caches.delete(store);
}

const freshLink = (cache, id, now) => {
  const link = cache.links.get(id);
  return link && now - link.at < LINK_TTL_MS ? link.url : '';
};

// A cover link that was already signed for this account and is still fresh, or ''.
export function cachedCover(store, entryId, now = Date.now()) {
  const cache = caches.get(store);
  return cache && cache.account === accountOf(store) ? freshLink(cache, entryId, now) : '';
}

// What a card should draw for an entry right now.
//   state 'media'   the real picture (colour)        state 'preview' the blurred public preview
//   state 'preset'  the editorial preset (monochrome)
//   hydrate         the cover is filled in later by hydrateCovers
export function coverFor(entry, store, now = Date.now()) {
  const preset = { src: presetUrl(entry.image), state: 'preset', hydrate: false };
  if (kindOf(entry) === 'text') return entry.coverUrl ? { src: entry.coverUrl, state: 'media', hydrate: false } : preset;
  if (!store.canRead(entry)) return entry.previewUrl ? { src: entry.previewUrl, state: 'preview', hydrate: false } : preset;
  const link = cachedCover(store, entry.id, now);
  if (link) return { src: link, state: 'media', hydrate: true };
  return entry.previewUrl ? { src: entry.previewUrl, state: 'preview', hydrate: true } : { ...preset, hydrate: true };
}

// The first file of the entry's own kind: a save that failed half way can leave files of another kind behind.
const coverFile = (cache, entry) => cache.files.get(entry.id)?.find(file => file.kind === kindOf(entry));
const coverPath = (cache, entry) => {
  const file = coverFile(cache, entry);
  if (!file) return '';
  if (file.kind === 'video') return file.posterPath || '';
  return file.posterPath && !cache.rejected.has(file.posterPath) ? file.posterPath : file.path;
};

// Fills the covers inside `root` (every <img data-cover="<entry id>"> that ui.entryCard drew).
// `entries` are the entries those cards were drawn from. Resolves when this pass is finished; never rejects.
export function hydrateCovers(root, entries, api, store, { now = Date.now } = {}) {
  const cache = cacheFor(store, api);
  const retry = () => hydrateCovers(root, entries, api, store, { now });
  cache.queue = cache.queue.then(() => run({ root, entries, api, store, cache, now, retry })).catch(() => {});
  return cache.queue;
}

async function run(job) {
  const { root, entries, api, store, cache, now } = job;
  if (!isCurrent(store, cache) || !root) return;
  const byId = new Map((entries || []).map(entry => [entry.id, entry]));
  const wanted = [...new Set([...root.querySelectorAll('img[data-cover]')].map(img => img.dataset.cover))]
    .filter(id => {
      const entry = byId.get(id);
      return entry && kindOf(entry) !== 'text' && store.canRead(entry) && !freshLink(cache, id, now());
    });
  if (wanted.length) {
    try {
      await sign(job, byId, wanted);
    } catch { /* decoration: the placeholder stays and the next render tries again */ }
    if (!isCurrent(store, cache)) return;
  }
  paint(job);
}

async function sign({ api, store, cache, now }, byId, wanted) {
  const missing = wanted.filter(id => !cache.files.has(id));
  if (missing.length) {
    const found = await api.media(missing);
    if (!isCurrent(store, cache)) return;
    for (const id of missing) cache.files.set(id, found?.[id] || []);
  }
  const paths = new Map(wanted.map(id => [id, coverPath(cache, byId.get(id))]).filter(([, path]) => path));
  if (!paths.size) return;

  let urls = (await api.signedUrls([...new Set(paths.values())])) || {};
  if (!isCurrent(store, cache)) return;

  // A thumbnail that cannot be signed (its object is gone) must not leave a blank card while the image itself is there:
  // sign that instead. The thumbnail is written off only once the file signed, so a failure of the whole lookup does
  // not cost every card its thumbnail.
  const lost = [...paths].filter(([id, path]) => {
    const file = coverFile(cache, byId.get(id));
    return !urls[path] && file?.kind === 'image' && path === file.posterPath;
  });
  if (lost.length) {
    const originals = lost.map(([id]) => coverFile(cache, byId.get(id)).path);
    const more = (await api.signedUrls(originals)) || {};
    if (!isCurrent(store, cache)) return;
    urls = { ...urls, ...more };
    for (const [id, path] of lost) {
      const file = coverFile(cache, byId.get(id));
      if (more[file.path]) { cache.rejected.add(path); paths.set(id, file.path); }
    }
  }
  for (const [id, path] of paths) {
    if (urls[path]) cache.links.set(id, { url: urls[path], at: now() });
    else cache.files.delete(id); // nothing to show at all: read the file list again next time
  }
}

// The <img> is lazy already, so it simply receives its signed source and only covers near the screen are fetched.
// The blur (or the monochrome preset look) goes once the real picture has loaded. Listeners are attached once per
// cover, including covers that were drawn with a cached link.
function paint(job) {
  const { root, cache, now } = job;
  for (const img of root.querySelectorAll('img[data-cover]')) {
    const id = img.dataset.cover;
    if (!img.dataset.coverBound) {
      img.dataset.coverBound = '1';
      img.addEventListener('load', () => {
        if (!img.dataset.coverReady) return; // the blurred preview or the preset loading, not the real cover
        delete img.dataset.coverFailed;
        img.closest('.is-preview, .is-preset')?.classList.remove('is-preview', 'is-preset');
      });
      img.addEventListener('error', () => loadFailed(job, img, id));
    }
    const link = freshLink(cache, id, now());
    if (!link || img.dataset.coverReady) continue;
    img.dataset.coverReady = '1';
    img.src = link;
  }
}

// A signed cover that fails to load. Its link has most likely expired (a card scrolled into view long after it was drawn),
// so it is signed again once. If that fails as well and the cover was a card thumbnail, the image file takes its place.
// After that it is left alone, so a cover that keeps failing cannot loop.
function loadFailed(job, img, id) {
  const { cache, entries, retry } = job;
  if (!img.dataset.coverReady) return; // the preview or the preset failed, not a signed cover
  cache.links.delete(id);
  delete img.dataset.coverReady;
  const failures = Number(img.dataset.coverFailed) || 0;
  img.dataset.coverFailed = String(failures + 1);
  if (failures >= MAX_LOAD_FAILURES) return;
  if (failures === 1) {
    const entry = (entries || []).find(candidate => candidate.id === id);
    const file = entry && coverFile(cache, entry);
    if (file?.kind === 'image' && file.posterPath && coverPath(cache, entry) === file.posterPath) cache.rejected.add(file.posterPath);
    else return;
  }
  retry();
}
