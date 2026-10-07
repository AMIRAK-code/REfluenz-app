// The media of an image or video post: reading the file list, signing the files, drawing the gallery or the player,
// and keeping them in order (a lost link is signed again once, a failed load can be retried, nothing plays on unseen).
// Signing is never required for the page itself: when it fails the caption is still shown, with a way to try again.
// Locked posts never reach this module (docs/POST_FORMATS.md, "Reader").

import { delegate, html, icon, modal, setBusy } from '../../core/ui.js';
import { plural } from '../../core/format.js';

const dim = value => {
  const n = Math.round(Number(value));
  return n > 0 && n < 20000 ? n : 0;
};

// → { status: 'ok' | 'empty' | 'failed', items: [{...Media, url, poster}], missing }
//   ok      at least one file could be opened (missing counts the ones that could not)
//   empty   the post has no file of its own kind yet (a draft)
//   failed  the lookup or the signing failed as a whole
// The rows are always read again: the creator may have changed the files since a card was drawn.
export async function loadMedia(api, entry) {
  try {
    const found = await api.media([entry.id]);
    const rows = (found?.[entry.id] || []).filter(file => file.kind === entry.kind);
    const wanted = entry.kind === 'video' ? rows.slice(0, 1) : rows;
    if (!wanted.length) return { status: 'empty', items: [], missing: 0 };
    const paths = wanted.flatMap(file => [file.path, entry.kind === 'video' ? file.posterPath : null]).filter(Boolean);
    const urls = (await api.signedUrls(paths)) || {};
    const items = wanted.filter(file => urls[file.path]).map(file => ({ ...file, url: urls[file.path], poster: (file.posterPath && urls[file.posterPath]) || '' }));
    return { status: items.length ? 'ok' : 'failed', items, missing: wanted.length - items.length };
  } catch {
    return { status: 'failed', items: [], missing: 0 };
  }
}

const altOf = (file, index, title) => file.alt || `${title}, image ${index + 1}`;

const figure = (file, index, total, title) => html`<figure class="post-figure">
  <button type="button" class="post-figure-open" data-lightbox="${index}" aria-label="View image ${index + 1} of ${total} full size">
    <img src="${file.url}" alt="${altOf(file, index, title)}" loading="lazy" decoding="async" data-path="${file.path}"${dim(file.width) && dim(file.height) && html` width="${dim(file.width)}" height="${dim(file.height)}"`}>
  </button>
</figure>`;

const player = (file, title) => html`<video class="post-video" controls playsinline preload="metadata" aria-label="${title}, video" src="${file.url}" data-path="${file.path}"${file.poster && html` poster="${file.poster}"`}${file.posterPath && html` data-poster-path="${file.posterPath}"`}>
  <p>Your browser cannot play this video.</p>
</video>`;

const retryNote = text => html`<div class="post-note" role="status"><p>${text}</p><button type="button" class="button secondary small" data-media-retry>Try again</button></div>`;

export function mediaMarkup(entry, media) {
  const video = entry.kind === 'video';
  if (!media || media.status === 'empty') return html`<p class="post-note">${video ? 'No video has' : 'No images have'} been added to this post yet.</p>`;
  if (media.status === 'failed') return retryNote(`${video ? 'The video' : 'The images'} could not be loaded. Check your connection and try again.`);
  const body = video ? player(media.items[0], entry.title) : html`<div class="post-gallery">${media.items.map((file, index) => figure(file, index, media.items.length, entry.title))}</div>`;
  return html`${body}${media.missing > 0 && retryNote(`${plural(media.missing, 'file')} could not be loaded.`)}`;
}

// --- Lightbox -------------------------------------------------------------------

function openLightbox({ items, start, title }) {
  let index = start;
  let dialogElement = null;
  const step = by => { index = (index + by + items.length) % items.length; paint(); };
  const paint = () => {
    const image = dialogElement?.querySelector('[data-lightbox-image]');
    if (!image) return;
    image.src = items[index].url;
    image.alt = altOf(items[index], index, title);
    dialogElement.querySelector('[data-lightbox-count]').textContent = `Image ${index + 1} of ${items.length}`;
  };
  const onKey = event => {
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
  };
  const many = items.length > 1;
  return modal.open({
    title,
    className: 'post-lightbox',
    body: html`<div class="post-lightbox-stage">
      <img data-lightbox-image src="${items[index].url}" alt="${altOf(items[index], index, title)}">
      <div class="post-lightbox-bar">
        ${many && html`<button type="button" class="icon-button" data-lightbox-step="-1" aria-label="Previous image">${icon('chevron-left', 18)}</button>`}
        <span class="post-lightbox-count" data-lightbox-count aria-live="polite">Image ${index + 1} of ${items.length}</span>
        ${many && html`<button type="button" class="icon-button" data-lightbox-step="1" aria-label="Next image">${icon('chevron-right', 18)}</button>`}
      </div>
    </div>`,
    onMount(dialog) {
      dialogElement = dialog;
      dialog.addEventListener('keydown', onKey);
      dialog.querySelectorAll('[data-lightbox-step]').forEach(control => control.addEventListener('click', () => step(Number(control.dataset.lightboxStep))));
    },
    onClose: () => dialogElement?.removeEventListener('keydown', onKey)
  });
}

// --- Mounting ---------------------------------------------------------------------

// Pauses and unloads every video inside `root`, so nothing plays on behind a page that is gone.
export function stopVideos(root) {
  for (const video of root.querySelectorAll('video')) {
    try { video.pause?.(); } catch { /* nothing is playing */ }
    video.removeAttribute('src');
    video.removeAttribute('poster');
    try { video.load?.(); } catch { /* not a real media element */ }
  }
}

export function mountMedia(root, ctx, data) {
  const holder = root.querySelector('[data-media]');
  if (!holder) return () => {};
  const { api } = ctx;
  const { entry } = data;
  let alive = true;

  const offs = [
    delegate(holder, 'click', '[data-lightbox]', (event, control) => {
      const items = data.media?.items || [];
      openLightbox({ items, start: Number(control.dataset.lightbox) || 0, title: entry.title });
    }),
    delegate(holder, 'click', '[data-media-retry]', async (event, control) => {
      setBusy(control, true);
      const next = await loadMedia(api, entry);
      if (!alive) return;
      data.media = next;
      holder.innerHTML = mediaMarkup(entry, next).value;
    }),
    // A signed link that fails to load has most likely expired (the page was left open for a long time): sign the file again, once.
    delegate(holder, 'error', 'img[data-path], video[data-path]', async (event, node) => {
      if (node.dataset.retried) return;
      node.dataset.retried = '1';
      try {
        const urls = (await api.signedUrls([node.dataset.path])) || {};
        const url = urls[node.dataset.path];
        if (!alive || !url) return;
        node.setAttribute('src', url);
        if (node.localName === 'video') node.load?.();
      } catch { /* the retry button is there for the person */ }
    })
  ];

  return () => {
    alive = false;
    offs.forEach(off => off());
    stopVideos(root);
  };
}
