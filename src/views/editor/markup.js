// The editor's markup. Everything goes through html``, which escapes: titles, captions, alt text and file names are user data.

import { emptyState, html, icon, raw } from '../../core/ui.js';
import { paths } from '../../core/paths.js';
import { duration, fileSize, plural } from '../../core/format.js';
import { KINDS, PRESETS, presetUrl } from '../../core/constants.js';
import {
  CATEGORIES, KIND_ICON, KIND_LABEL, PRESET_LABEL, RULES, bodyHelp, bodyHint, bodyLabel, coverNote, formatsFor, initialValues, itemName, maxItems, sentence
} from './model.js';

const disabled = on => on && raw(' disabled');
const selected = on => on && raw(' selected');

// --- Small pieces -------------------------------------------------------------

export const accessLabel = (access, tiers) => (access === 'public' ? 'Everyone' : `${tiers.find(tier => tier.id === access)?.name ?? 'Members'} and above`);

export function accessHelp(access, tiers) {
  if (access === 'public') return 'Everyone can read this post, signed in or not.';
  const name = tiers.find(tier => tier.id === access)?.name ?? 'Members';
  return `Members of your ${name} circle and above can read this post. Everyone else sees the opening paragraph and a blurred preview.`;
}

// Everyone, then the atelier's open tiers. A tier that has been closed since stays on offer while a post still uses it.
function accessOptions(tiers, current) {
  const open = tiers.filter(tier => tier.enabled !== false || tier.id === current);
  return html`<option value="public"${selected(current === 'public')}>Everyone</option>${open.map(tier => html`<option value="${tier.id}"${selected(current === tier.id)}>${tier.name} and above${tier.enabled === false ? ' (closed to new members)' : ''}</option>`)}`;
}

export const formatOptions = (kind, current) => formatsFor(kind, current).map(format => html`<option${selected(format === current)}>${format}</option>`);

export function kindSwitch(s) {
  const locked = s.items.length > 0;
  const why = `Remove the ${s.kind === 'video' ? 'video' : 'images'} to change the post type`;
  return KINDS.map(kind => html`<button type="button" class="ed-kind${s.kind === kind ? ' is-active' : ''}" data-action="kind" data-id="${kind}" aria-pressed="${String(s.kind === kind)}"${locked && s.kind !== kind && html` aria-disabled="true" title="${why}"`}>${icon(KIND_ICON[kind], 15)}<span>${KIND_LABEL[kind]}</span></button>`);
}

const progressBar = (item, n) => (item.progress == null ? '' : html`<progress class="ed-progress" data-progress="${item.key}" max="100" value="${Math.round(item.progress * 100)}" aria-label="Upload progress, ${itemName(item, n)}"></progress>`);

// Each file that failed says why next to itself; a cancelled one has no reason to give.
const failedNote = item => (item.failed ? html`<p class="ed-upload-status">Not uploaded${item.error ? html`: ${sentence(item.error)}` : '.'} It will be sent again when you save.</p>` : '');

// The grid shows a small copy of each new picture (made once, see makeThumbs), never the full-size file; until it exists a placeholder stands in.
export const itemPic = (item, media) => {
  const src = item.thumb || (item.file && media?.thumbnail && !item.noThumb ? '' : item.url);
  return src ? html`<img src="${src}" alt="" decoding="async">` : icon('image', 22);
};

function imageItem(s, item, index, media) {
  const n = index + 1;
  const name = itemName(item, n);
  const off = s.saving;
  return html`<li class="ed-item${item.failed ? ' is-failed' : ''}">
    <div class="ed-thumb" data-thumb="${item.key}"><span class="ed-pic">${itemPic(item, media)}</span><span class="ed-index">${n}</span></div>
    <div class="ed-item-body">
      <label class="visually-hidden" for="alt-${item.key}">Alt text for image ${n}</label>
      <input id="alt-${item.key}" class="ed-alt" data-alt="${item.key}" maxlength="${RULES.altMax}" placeholder="Alt text: describe this image for people who cannot see it" value="${item.alt}"${disabled(off)}>
      ${failedNote(item)}
      <div class="ed-item-actions">
        <span class="ed-name" title="${name}">${name}</span>
        <button type="button" class="icon-button" data-action="media-earlier" data-id="${item.key}" aria-label="Move image ${n} earlier"${disabled(off || index === 0)}>${icon('back', 15)}</button>
        <button type="button" class="icon-button" data-action="media-later" data-id="${item.key}" aria-label="Move image ${n} later"${disabled(off || index === s.items.length - 1)}>${icon('arrow', 15)}</button>
        <button type="button" class="icon-button" data-action="media-remove" data-id="${item.key}" aria-label="Remove image ${n}"${disabled(off)}>${icon('trash', 15)}</button>
      </div>
      ${progressBar(item, n)}
    </div>
  </li>`;
}

function videoItem(s, item) {
  const detail = [item.file ? fileSize(item.file.size) : '', item.media?.duration > 0 ? duration(item.media.duration) : ''].filter(Boolean).join(' · ');
  const name = `${itemName(item, 1)}${detail ? ` · ${detail}` : ''}`;
  return html`<div class="ed-video-field${item.failed ? ' is-failed' : ''}">
    <video class="ed-video" controls preload="metadata" playsinline aria-label="Selected video preview"${item.src && html` src="${item.src}"`}${item.poster && html` poster="${item.poster}"`}></video>
    ${progressBar(item, 1)}
    ${failedNote(item)}
    <div class="ed-item-actions">
      <span class="ed-name" title="${name}">${name}</span>
      <button type="button" class="icon-button" data-action="media-remove" data-id="${item.key}" aria-label="Remove video"${disabled(s.saving)}>${icon('trash', 15)}</button>
    </div>
  </div>`;
}

// The media section of image and video posts: the drop zone, the files and the errors about them.
export function mediaSection(s, media) {
  const kind = s.kind;
  if (kind === 'text') return html``;
  const count = s.items.length;
  const max = maxItems(media, kind);
  const videoMax = Math.round((media?.LIMITS?.maxVideoBytes || 52428800) / 1048576);
  const hint = kind === 'image'
    ? `JPEG, PNG, WebP or GIF. Up to ${max} images; large photos are resized for you and their location and camera details are removed.`
    : `MP4, WebM or MOV, up to ${videoMax} MB. Videos are uploaded as they are: location and device information stored in the file is not removed.`;
  const zone = count >= max ? '' : html`<button type="button" class="ed-dropzone" data-action="pick-files"${disabled(s.saving)}>${icon('upload', 22)}<strong>${kind === 'image' ? 'Add images' : 'Add a video'}</strong><span id="dropzone-hint" class="ed-drop-hint"><span class="drop-only">Drop ${kind === 'image' ? 'images' : 'a video'} here, or browse. </span><span class="pick-only">Choose ${kind === 'image' ? 'images' : 'a video'} from your device. </span>${hint}</span></button>`;
  const files = kind === 'image'
    ? (count ? html`<ul class="ed-items">${s.items.map((item, index) => imageItem(s, item, index, media))}</ul>` : '')
    : s.items.map(item => videoItem(s, item));
  return html`<div class="ed-media" role="group" aria-labelledby="media-label"><div class="ed-media-head" tabindex="-1"><span class="eyebrow" id="media-label">${kind === 'image' ? html`Images <span>${count} of ${max}</span>` : 'Video'}</span></div><div id="media-error" class="form-error" role="alert">${s.note}</div>${zone}${files}</div>`;
}

// The cover study of a text post: the editorial presets, and an optional picture of the creator's own.
export function coverField(s, values, hidden) {
  const own = s.cover.pendingUrl || (!s.cover.removed && s.cover.url) || '';
  return html`<div class="field ed-cover-field" id="editor-cover-field"${hidden && raw(' hidden')}>
    <label for="entry-image">Editorial cover</label>
    <select id="entry-image" name="image">${PRESETS.map(name => html`<option value="${name}"${selected(values.image === name)}>${PRESET_LABEL(name)}</option>`)}</select>
    <figure class="ed-cover"><img id="editor-cover" src="${own || presetUrl(values.image)}" alt="${own ? 'Your cover picture' : `${PRESET_LABEL(values.image)} cover study`}"></figure>
    <div class="ed-cover-actions">
      <button type="button" class="button secondary small" data-action="cover-pick" id="cover-pick">${icon('upload', 14)}<span>${own ? 'Replace your cover' : 'Upload your own cover'}</span></button>
      <button type="button" class="button ghost small" data-action="cover-remove" id="cover-remove"${!own && raw(' hidden')}>${icon('trash', 14)}<span>Remove your cover</span></button>
    </div>
    <p id="cover-error" class="field-error" role="alert"></p>
    <p class="field-help">A JPG, PNG or WebP picture. Without one, cards show the editorial cover.</p>
  </div>`;
}

const counter = (id, max, value) => html`<span class="ed-count" data-count="${id}" data-max="${max}" aria-hidden="true">${value.length.toLocaleString('en')} / ${max.toLocaleString('en')}</span>`;

// --- The page -----------------------------------------------------------------

export function missingMarkup() {
  return html`<section class="page ed">
    <header class="page-head"><div><p class="eyebrow bronze">Studio</p><h1>This post is not here</h1></div></header>
    ${emptyState({ icon: 'alert', title: 'We could not find this post', text: 'It may have been deleted, or it belongs to another atelier.', action: { label: 'Back to your studio', href: paths.studio(), variant: 'secondary' } })}
  </section>`;
}

export function pageMarkup(data, s, media) {
  const values = initialValues(data);
  const kind = s.kind;
  const text = kind === 'text';
  const editing = data.mode === 'edit';
  const live = editing && s.status === 'published';
  const back = paths.studio({ tab: live ? 'published' : 'drafts' });
  return html`<section class="page ed" data-kind="${kind}">
  <header class="page-head ed-head">
    <div>
      <a class="ed-back" href="${back}">${icon('back', 14)}<span>Studio</span></a>
      <p class="eyebrow bronze ed-eyebrow">${editing ? (live ? 'Edit a live post' : 'Edit a draft') : 'New post'}</p>
      <h1>${editing ? 'Edit your post.' : 'Start with a point of view.'}</h1>
      <p class="page-sub">${live ? 'Changes go live for readers as soon as you update the post.' : 'Write it, preview it, and publish it when it is ready. Drafts are only visible in your studio.'}</p>
    </div>
    <div class="ed-view" role="group" aria-label="Editor view">
      <button type="button" class="tab is-active" data-action="mode" data-id="write" aria-pressed="true">Write</button>
      <button type="button" class="tab" data-action="mode" data-id="preview" aria-pressed="false">Preview</button>
    </div>
  </header>

  <form class="ed-form" id="editor-form" aria-label="Post editor" novalidate data-kind="${kind}">
    <button type="submit" hidden disabled tabindex="-1" aria-hidden="true" data-guard></button>
    <fieldset class="ed-fields" id="editor-fields">
      <legend class="visually-hidden">Post details</legend>
      <div class="ed-type">
        <span class="eyebrow" id="ed-type-label">Post type</span>
        <div class="ed-kinds" id="editor-kind" role="group" aria-labelledby="ed-type-label">${kindSwitch(s)}</div>
      </div>

      <div class="ed-columns">
        <div class="ed-main">
          <div id="editor-write" class="ed-write">
            <div class="field">
              <div class="ed-label-row"><label for="entry-title">Title</label>${counter('entry-title', RULES.titleMax, values.title)}</div>
              <input id="entry-title" name="title" maxlength="${RULES.titleMax}" autocomplete="off" placeholder="Give your idea a name" value="${values.title}" aria-describedby="err-title">
              <p class="field-error" id="err-title"></p>
            </div>
            <div class="field">
              <div class="ed-label-row"><label for="entry-subtitle">Introduction</label>${counter('entry-subtitle', RULES.introMax, values.subtitle)}</div>
              <input id="entry-subtitle" name="subtitle" maxlength="${RULES.introMax}" autocomplete="off" placeholder="A line that invites someone in" value="${values.subtitle}" aria-describedby="err-subtitle">
              <p class="field-error" id="err-subtitle"></p>
            </div>
            <div id="editor-media" class="ed-media-host">${mediaSection(s, media)}</div>
            <div class="field">
              <div class="ed-label-row"><label for="entry-body" id="entry-body-label">${bodyLabel(kind)}</label>${counter('entry-body', RULES.bodyMax, values.body)}</div>
              <textarea id="entry-body" name="body" class="ed-body" maxlength="${RULES.bodyMax}" placeholder="${bodyHint(kind)}" aria-describedby="entry-body-help err-body">${values.body}</textarea>
              <p class="field-error" id="err-body"></p>
              <p class="field-help" id="entry-body-help">${bodyHelp(kind)}</p>
            </div>
          </div>
          <section id="editor-preview" class="ed-preview" aria-label="Preview of your post" hidden></section>
        </div>

        <aside class="ed-side" aria-label="Post settings">
          ${coverField(s, values, !text)}
          <p class="field-help ed-cover-note" id="editor-cover-note"${text && raw(' hidden')}>${coverNote(kind)}</p>
          <div class="field">
            <label for="entry-category">Category</label>
            <select id="entry-category" name="category">${CATEGORIES.map(category => html`<option${selected(values.category === category)}>${category}</option>`)}</select>
          </div>
          <div class="field">
            <label for="entry-format">Editorial format</label>
            <select id="entry-format" name="format">${formatOptions(kind, values.format)}</select>
          </div>
          <div class="field">
            <label for="entry-access">Who can read</label>
            <select id="entry-access" name="access" aria-describedby="entry-access-help err-access">${accessOptions(data.tiers, values.access)}</select>
            <p class="field-error" id="err-access"></p>
            <p class="field-help" id="entry-access-help">${accessHelp(values.access, data.tiers)}</p>
          </div>
        </aside>
      </div>

      <div id="entry-error" class="form-error ed-error" role="alert"></div>
      <div id="editor-status" class="ed-status" role="status" aria-live="polite" tabindex="-1"></div>
      <div class="ed-footer">
        <p class="ed-footer-note">${live ? 'This post is live. Moving it to drafts hides it from readers until you publish it again.' : 'Drafts are only visible in your studio.'}</p>
        <div class="ed-actions">
          <button type="submit" class="button secondary" name="intent" value="draft"><span>${live ? 'Move to drafts' : 'Save draft'}</span></button>
          <button type="submit" class="button" name="intent" value="published"><span>${live ? 'Update post' : 'Publish'}</span>${icon('arrow', 14)}</button>
        </div>
      </div>
      <input id="entry-files" type="file" hidden tabindex="-1" aria-hidden="true" accept="${kind === 'video' ? 'video/*' : 'image/*'}"${kind === 'image' && raw(' multiple')}>
      <input id="entry-cover-file" type="file" hidden tabindex="-1" aria-hidden="true" accept="image/jpeg,image/png,image/webp">
    </fieldset>
    <div class="ed-cancel" id="editor-cancel" hidden><button type="button" class="button secondary small" data-action="cancel-upload">Cancel upload</button></div>
  </form>
</section>`;
}

// What the post looks like to a reader. `p` is a plain description made by the controller (see previewModel there).
export function previewMarkup(p) {
  return html`<p class="eyebrow muted ed-preview-label">Preview · how readers will see this post</p>
  <article class="ed-article">
    <p class="eyebrow bronze">${p.category} · ${p.accessLabel}</p>
    <h2 class="ed-article-title">${p.title || 'Untitled post'}</h2>
    ${p.subtitle && html`<p class="ed-article-deck">${p.subtitle}</p>`}
    <p class="ed-article-byline">By ${p.creatorName} · ${p.dateText}${p.size && html` · ${p.size}`}</p>
    ${p.cover && html`<figure class="ed-article-cover"><img src="${p.cover.src}" alt="${p.cover.alt}"></figure>`}
    ${p.images.length > 0 && html`<div class="ed-article-media">${p.images.map(image => html`<figure><img src="${image.src}" alt="${image.alt}"></figure>`)}</div>`}
    ${p.video && html`<div class="ed-article-media"><video controls preload="metadata" playsinline aria-label="${p.title || 'Untitled post'}, video" src="${p.video.src}"${p.video.poster && html` poster="${p.video.poster}"`}></video></div>`}
    ${p.mediaNote && html`<p class="ed-empty-note">${p.mediaNote}</p>`}
    ${p.paragraphs.length > 0
    ? html`<div class="ed-article-body">${p.paragraphs.map(paragraph => html`<p>${paragraph.split(/\r?\n/).map((line, index) => (index ? [raw('<br>'), line] : line))}</p>`)}</div>`
    : p.kind === 'text' && html`<p class="ed-empty-note">Nothing written yet.</p>`}
    ${p.lockNote && html`<p class="ed-lock-note">${icon('lock', 16)}<span>${p.lockNote}</span></p>`}
  </article>`;
}

export const sizeText = ({ kind, imageCount, videoSeconds, body, minutes }) => {
  if (kind === 'image') return imageCount ? plural(imageCount, 'image') : '';
  if (kind === 'video') return duration(videoSeconds) || 'Video';
  return body.trim() ? `${minutes} min read` : '';
};
