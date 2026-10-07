// The behaviour of the editor page: one editing session from the moment the page is drawn until the person leaves it.
//
// Everything here works on the markup of markup.js and on the state of model.js (`s`). Only the part of the page that changed is redrawn
// (the media section, the cover study, the kind switch), so typed text, the caret and the keyboard focus are never lost. The save itself
// (uploads, removals, the final save) lives in save.js.

import { CANCELLED } from '../../api/util.js';
import { DEFAULT_FORMAT, KINDS, presetUrl } from '../../core/constants.js';
import { delegate, setBusy, toast } from '../../core/ui.js';
import { formatDate, plural } from '../../core/format.js';
import { paths } from '../../core/paths.js';
import { deps } from './deps.js';
import {
  KIND_LABEL, PRESET_LABEL, accessIds, bodyHelp, bodyHint, bodyLabel, coverNote, coverProblem, formatsFor, initialValues, itemName, maxItems, messageOf, nextKey,
  paragraphs, readingMinutes, validate
} from './model.js';
import { accessHelp, accessLabel, formatOptions, itemPic, mediaSection, previewMarkup, sizeText } from './markup.js';
import { createSaver, sessionUploads, undoUploads } from './save.js';

const MEDIA_ACTIONS = new Set(['pick-files', 'media-earlier', 'media-later', 'media-remove', 'kind', 'cover-pick', 'cover-remove']);
const FIELDS = { 'entry-title': 'title', 'entry-subtitle': 'subtitle', 'entry-body': 'body', 'entry-access': 'access' };
const FIELD_NODE = { title: '#entry-title', subtitle: '#entry-subtitle', body: '#entry-body', access: '#entry-access' };

const blobUrl = file => { try { return URL.createObjectURL(file); } catch { return ''; } };
function revoke(...urls) {
  for (const url of new Set(urls)) if (String(url || '').startsWith('blob:')) try { URL.revokeObjectURL(url); } catch { /* already gone */ }
}
const escapeId = value => (globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&'));

export function mountEditor(el, ctx, data, s) {
  const { api } = ctx;
  const { creator, tiers } = data;
  const root = el.querySelector('.ed');
  const form = el.querySelector('#editor-form');
  const $ = selector => el.querySelector(selector);
  const stops = [];
  let alive = true;
  let sayTimer = null;
  let thumbJobs = Promise.resolve();
  const saver = createSaver({ api, s, creatorId: creator.id, say, progress: paintProgress });
  const media = () => deps.media;

  // The markup marks the right option of each select with `selected`; setting the value as well keeps the choice when an engine reads
  // the attribute differently (an option list parsed from a string) and costs nothing elsewhere.
  const start = initialValues(data);
  for (const [selector, value] of [['#entry-category', start.category], ['#entry-format', start.format], ['#entry-image', start.image], ['#entry-access', start.access]]) {
    const node = el.querySelector(selector);
    if (node && value) node.value = value;
  }

  // --- Small helpers -------------------------------------------------------------

  // Anything the creator changes: the post is no longer what was saved, and an identical retry no longer applies.
  function touch() {
    s.dirty = true;
    s.savedKey = '';
  }

  // The status line is read aloud by screen readers. Saying the same words twice would not be announced again, so a repeat is cleared first.
  function say(text) {
    const node = $('#editor-status');
    if (!node) return;
    clearTimeout(sayTimer);
    if (text && node.textContent === text) {
      node.textContent = '';
      sayTimer = setTimeout(() => { if (alive) node.textContent = text; }, 50);
      sayTimer.unref?.();
    } else node.textContent = text;
  }

  const show = (node, text) => {
    if (!node) return;
    node.textContent = text;
    if (text) node.scrollIntoView?.({ block: 'nearest' });
  };
  const setEntryError = text => show($('#entry-error'), text);
  // Errors about the files appear in the media section, next to the controls that caused them; errors about saving stay above the buttons.
  function setMediaNote(text) {
    s.note = text;
    const node = $('#media-error');
    if (node && s.kind !== 'text') show(node, text);
    else setEntryError(text);
  }
  function clearNotes() {
    s.note = '';
    show($('#media-error'), '');
    setEntryError('');
  }
  function clearFieldErrors() {
    for (const node of el.querySelectorAll('.field-error')) node.textContent = '';
    for (const node of el.querySelectorAll('[aria-invalid]')) node.removeAttribute('aria-invalid');
  }

  const field = selector => $(selector)?.value ?? '';
  // The values of the form, trimmed the way the server keeps them.
  function readValues() {
    const kind = s.kind;
    const format = field('#entry-format');
    return {
      kind,
      title: field('#entry-title').trim(),
      subtitle: field('#entry-subtitle').trim(),
      body: field('#entry-body').trim(),
      category: field('#entry-category'),
      format: formatsFor(kind, format).includes(format) ? format : DEFAULT_FORMAT[kind],
      image: field('#entry-image'),
      access: field('#entry-access')
    };
  }

  function reportProblem(problem) {
    const target = FIELD_NODE[problem.field];
    if (target) {
      const input = $(target);
      const note = $(`#err-${problem.field}`);
      if (note) note.textContent = problem.message;
      input?.setAttribute('aria-invalid', 'true');
      input?.focus?.();
      input?.scrollIntoView?.({ block: 'center' });
    } else if (problem.field === 'media') {
      setMediaNote(problem.message);
      $('.ed-media-head')?.focus?.({ preventScroll: true });
    } else setEntryError(problem.message);
  }

  function updateCount(input) {
    const count = el.querySelector(`[data-count="${input.id}"]`);
    if (!count) return;
    const max = Number(count.dataset.max);
    count.textContent = `${input.value.length.toLocaleString('en')} / ${max.toLocaleString('en')}`;
    count.classList.toggle('is-near', input.value.length >= max * 0.9);
  }

  // --- Leaving -------------------------------------------------------------------

  const block = () => {
    if (s.finished) return null;
    if (s.saving) return 'Your post is still saving. Leave this page and stop the upload?';
    if (!s.dirty) return null;
    return sessionUploads(s).length
      ? 'Discard the unsaved changes to this post? Files uploaded during this edit are removed again.'
      : 'You have unsaved changes to this post. Leave without saving?';
  };
  ctx.router.block = block;

  // --- The post type -----------------------------------------------------------------

  function paintKindSwitch() {
    const locked = s.items.length > 0;
    const why = `Remove the ${s.kind === 'video' ? 'video' : 'images'} to change the post type`;
    for (const button of el.querySelectorAll('.ed-kind')) {
      const on = button.dataset.id === s.kind;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
      if (locked && !on) {
        button.setAttribute('aria-disabled', 'true');
        button.setAttribute('title', why);
      } else {
        button.removeAttribute('aria-disabled');
        button.removeAttribute('title');
      }
    }
  }

  function setKind(next) {
    if (!KINDS.includes(next) || next === s.kind || s.saving) return;
    if (s.items.length) {
      setMediaNote(`This post already has ${s.kind === 'video' ? 'a video' : 'images'}. Remove ${s.kind === 'video' ? 'it' : 'them'} before switching to ${KIND_LABEL[next]}.`);
      return;
    }
    const previous = s.kind;
    s.kind = next;
    touch();
    clearNotes();
    const text = next === 'text';
    root.dataset.kind = next;
    form.dataset.kind = next;
    const picker = $('#entry-files');
    if (picker) {
      picker.accept = next === 'video' ? 'video/*' : 'image/*';
      picker.multiple = next === 'image';
    }
    const label = $('#entry-body-label');
    if (label) label.textContent = bodyLabel(next);
    const help = $('#entry-body-help');
    if (help) help.textContent = bodyHelp(next);
    const body = $('#entry-body');
    if (body) body.placeholder = bodyHint(next);
    const cover = $('#editor-cover-field');
    if (cover) cover.hidden = !text;
    const note = $('#editor-cover-note');
    if (note) {
      note.hidden = text;
      note.textContent = coverNote(next);
    }
    const format = $('#entry-format');
    if (format) {
      const current = format.value;
      const keep = current !== DEFAULT_FORMAT[previous] && formatsFor(next, current).includes(current) ? current : DEFAULT_FORMAT[next];
      format.innerHTML = String(formatOptions(next, keep));
      format.value = keep;
    }
    paintKindSwitch();
    renderMedia();
    if (s.mode === 'preview') paintPreview();
  }

  // --- The media section -----------------------------------------------------------------

  // Only the media section is redrawn, so typed text is never lost. Keyboard focus follows the control that was used: after a removal it goes
  // to the item that took its place (index `after`), after a file was added to the section heading when the drop zone is gone.
  function renderMedia(after = -1) {
    const host = $('#editor-media');
    if (!host) return;
    const had = host.contains(document.activeElement) ? document.activeElement : null;
    host.innerHTML = String(mediaSection(s, media()));
    paintKindSwitch();
    if (!had) return;
    const focus = node => node?.focus?.({ preventScroll: true });
    const fallback = () => host.querySelector('.ed-dropzone:not(:disabled)') || host.querySelector('.ed-media-head');
    const name = had.dataset?.action;
    const id = had.dataset?.id || '';
    if (had.dataset?.alt) return focus(host.querySelector(`[data-alt="${escapeId(had.dataset.alt)}"]`) || fallback());
    const find = action => host.querySelector(`[data-action="${escapeId(action)}"][data-id="${escapeId(id)}"]:not(:disabled)`);
    if (name === 'media-remove' && after >= 0) {
      const left = [...host.querySelectorAll('[data-action="media-remove"]:not(:disabled)')];
      return focus(left[Math.min(after, left.length - 1)] || fallback());
    }
    const flip = { 'media-earlier': 'media-later', 'media-later': 'media-earlier' }[name];
    return focus((name && find(name)) || (flip && find(flip)) || fallback());
  }

  function paintProgress(item) {
    const bar = $(`[data-progress="${item.key}"]`);
    if (bar) bar.value = Math.round((item.progress ?? 0) * 100);
  }

  // Small copies of newly picked images for the grid, made one at a time (each decodes the picture once), and dropped when the item is gone.
  function makeThumbs(items) {
    if (s.kind !== 'image' || !media().thumbnail) return;
    for (const item of items) {
      thumbJobs = thumbJobs.then(async () => {
        if (!alive || !s.items.includes(item) || !item.file) return;
        let blob = null;
        try { blob = await media().thumbnail(item.file); } catch { /* the file itself is shown instead */ }
        if (!alive || !s.items.includes(item)) return;
        if (blob) item.thumb = blobUrl(blob);
        else item.noThumb = true;
        const pic = $(`[data-thumb="${item.key}"] .ed-pic`);
        if (pic) pic.innerHTML = String(itemPic(item, media()));
      }).catch(() => {});
    }
  }

  function addFiles(files) {
    if (!files.length || s.saving) return;
    if (s.kind === 'text') {
      const kind = media().classify(files[0]);
      if (!kind) return setMediaNote('Choose Image or Video to attach files.');
      setKind(kind);
      if (s.kind !== kind) return;
    }
    try { media().validateFiles(s.kind, files, s.items.length); } catch (error) { return setMediaNote(error.message); }
    clearNotes();
    const fresh = files.map(file => {
      const url = blobUrl(file);
      return { key: nextKey(), file, name: file.name, alt: '', url, src: url, progress: null };
    });
    s.items.push(...fresh);
    touch();
    renderMedia();
    makeThumbs(fresh);
    say(`${plural(files.length, 'file')} added. ${s.items.length} of ${maxItems(media(), s.kind)}.`);
  }

  function moveItem(key, by) {
    const from = s.items.findIndex(item => item.key === key);
    const to = from + by;
    if (from < 0 || to < 0 || to >= s.items.length) return;
    [s.items[from], s.items[to]] = [s.items[to], s.items[from]];
    touch();
    clearNotes();
    renderMedia();
    say(`Moved to position ${to + 1} of ${s.items.length}.`);
  }

  function removeItem(key) {
    const index = s.items.findIndex(item => item.key === key);
    if (index < 0) return;
    const [item] = s.items.splice(index, 1);
    const name = itemName(item, index + 1);
    revoke(item.url, item.src, item.thumb);
    if (item.media) s.removed.push(item.media);
    touch();
    clearNotes();
    renderMedia(index);
    say(`Removed ${name}. ${plural(s.items.length, 'file')} left.`);
  }

  // --- The cover of a text post ---------------------------------------------------------------

  function paintCover() {
    const own = s.cover.pendingUrl || (!s.cover.removed && s.cover.url) || '';
    const preset = field('#entry-image') || 'atelier';
    const image = $('#editor-cover');
    if (image) {
      image.src = own || presetUrl(preset);
      image.alt = own ? 'Your cover picture' : `${PRESET_LABEL(preset)} cover study`;
    }
    const pick = $('#cover-pick span');
    if (pick) pick.textContent = own ? 'Replace your cover' : 'Upload your own cover';
    const remove = $('#cover-remove');
    if (remove) remove.hidden = !own;
  }

  function chooseCover(file) {
    if (!file || s.saving) return;
    const problem = coverProblem(file, media());
    const note = $('#cover-error');
    if (problem) {
      if (note) note.textContent = problem;
      return;
    }
    if (note) note.textContent = '';
    revoke(s.cover.pendingUrl);
    s.cover.file = file;
    s.cover.pendingUrl = blobUrl(file);
    s.cover.uploadedPath = null;
    s.cover.removed = false;
    touch();
    paintCover();
    say('Cover picture chosen. It is uploaded when you save.');
  }

  function removeCover() {
    if (s.saving) return;
    revoke(s.cover.pendingUrl);
    s.cover.file = null;
    s.cover.pendingUrl = '';
    s.cover.uploadedPath = null;
    s.cover.removed = Boolean(s.cover.path);
    const note = $('#cover-error');
    if (note) note.textContent = '';
    touch();
    paintCover();
    say('Cover picture removed. The editorial cover is used instead.');
    $('#cover-pick')?.focus?.({ preventScroll: true });
  }

  // --- Preview --------------------------------------------------------------------------------

  // A plain description of the post as the reader's page will show it, made from what is in the form right now.
  function previewModel() {
    const values = readValues();
    const kind = s.kind;
    const first = s.items[0];
    const picture = item => item.src || item.url;
    const images = kind === 'image' ? s.items.filter(picture).map((item, index) => ({ src: picture(item), alt: item.alt || `${values.title || 'Post'}, image ${index + 1}` })) : [];
    const video = kind === 'video' && first?.src ? { src: first.src, poster: first.poster || '' } : null;
    const shown = kind === 'image' ? images.length : video ? 1 : 0;
    const own = s.cover.pendingUrl || (!s.cover.removed && s.cover.url) || '';
    let mediaNote = '';
    if (kind !== 'text') {
      if (!s.items.length) mediaNote = kind === 'image' ? 'No images added yet.' : 'No video added yet.';
      else if (shown < s.items.length) mediaNote = 'Some files cannot be shown in this preview, but they are part of the post.';
    }
    const tierName = tiers.find(tier => tier.id === values.access)?.name;
    const live = s.live && data.entry?.publishedAt;
    return {
      kind,
      category: values.category,
      accessLabel: accessLabel(values.access, tiers),
      title: values.title,
      subtitle: values.subtitle,
      creatorName: creator.name,
      dateText: formatDate(live || new Date(), { year: true }),
      size: sizeText({ kind, imageCount: s.items.length, videoSeconds: first?.media?.duration || 0, body: values.body, minutes: readingMinutes(values.body) }),
      cover: kind === 'text' ? { src: own || presetUrl(values.image), alt: own ? 'Your cover picture' : `${PRESET_LABEL(values.image)} cover study` } : null,
      images,
      video,
      mediaNote,
      paragraphs: paragraphs(values.body),
      lockNote: values.access === 'public' ? '' : `Members of your ${tierName ?? 'circle'} circle and above read the rest. Everyone else sees the opening paragraph, a blurred preview and an invitation to join.`
    };
  }

  function paintPreview() {
    const pane = $('#editor-preview');
    if (pane) pane.innerHTML = String(previewMarkup(previewModel()));
  }

  function showMode(mode) {
    if (mode === s.mode || (mode !== 'write' && mode !== 'preview')) return;
    s.mode = mode;
    for (const button of el.querySelectorAll('[data-action="mode"]')) {
      const on = button.dataset.id === mode;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    }
    const write = $('#editor-write');
    const pane = $('#editor-preview');
    if (write) write.hidden = mode !== 'write';
    if (pane) {
      pane.hidden = mode !== 'preview';
      if (mode === 'preview') paintPreview();
      else pane.innerHTML = '';   // a film in the preview stops playing
    }
    say(mode === 'preview' ? 'Preview shown.' : 'Back to writing.');
  }

  // --- Saving -----------------------------------------------------------------------------------

  // While saving, the fields are disabled and the creator gets the Cancel button (outside the disabled fieldset). Keyboard focus moves to the
  // status line instead of being stranded on the button that just became disabled.
  function lock(on, submitter) {
    const fields = $('#editor-fields');
    if (fields) {
      fields.disabled = on;
      if (on) fields.setAttribute('aria-busy', 'true');
      else fields.removeAttribute('aria-busy');
    }
    const cancel = $('#editor-cancel');
    if (cancel) cancel.hidden = !on;
    if (submitter) setBusy(submitter, on);
    say('');
    if (on) $('#editor-status')?.focus?.({ preventScroll: true });
  }

  const doneMessage = status => (status === 'draft' ? (s.live ? 'Moved to your drafts.' : 'Draft saved in your studio.') : s.live ? 'Post updated.' : 'Post published.');

  async function save(event) {
    event.preventDefault();
    if (s.saving) return;
    // Only Save draft or Publish saves. A submit that did not come from one of them (an implicit one from a keyboard, say) does nothing:
    // guessing would either publish a draft or send a published post back to draft.
    const submitter = event.submitter;
    const status = submitter?.value;
    if (status !== 'draft' && status !== 'published') return;

    const values = readValues();
    clearNotes();
    clearFieldErrors();
    const problem = validate(values, { status, mediaCount: s.items.length, access: accessIds(tiers), maxImages: maxItems(media(), 'image') });
    if (problem) {
      showMode('write');
      reportProblem(problem);
      return;
    }

    for (const item of s.items) {
      if (item.file) { item.progress = 0; item.failed = false; item.error = ''; }
    }
    const controller = new AbortController();
    s.controller = controller;
    s.saving = true;
    lock(true, submitter);
    renderMedia();

    let id = '';
    let failure = null;
    try { id = await saver.persist(values, status, controller.signal); } catch (error) { failure = error; }
    if (!alive) return;   // the person left meanwhile: nothing is reported
    s.saving = false;
    s.controller = null;

    if (!failure) {
      s.finished = true;
      s.dirty = false;
      s.uploaded.clear();
      say(status === 'published' ? 'Saved. Opening your post…' : 'Saved. Opening your studio…');
      toast(doneMessage(status), { tone: 'success' });
      const target = status === 'draft' ? paths.studio({ tab: 'drafts' }) : paths.entry(id);
      Promise.resolve(ctx.navigate(target, { force: true })).then(went => {
        if (went === false && alive) { s.finished = false; lock(false, submitter); }
      }, () => { if (alive) { s.finished = false; lock(false, submitter); } });
      return;
    }

    // The post keeps its id and what was stored, so Save draft or Publish again continues where this stopped.
    const cancelled = controller.signal.aborted;
    lock(false, submitter);
    for (const item of s.items) {
      if (item.file) item.progress = null;
    }
    renderMedia();
    setEntryError(`${cancelled ? CANCELLED : messageOf(failure)} ${saver.recoveryNote()}`);
    if (!cancelled) toast('Your post was not saved. What you wrote is still here.', { tone: 'error' });
    // Focus returns to the button that started the save, not to the top of the page.
    (submitter?.isConnected ? submitter : $('button[name="intent"]'))?.focus?.({ preventScroll: true });
  }

  // --- Events -------------------------------------------------------------------------------------

  const hasFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');

  stops.push(
    delegate(el, 'click', '[data-action]', (event, target) => {
      if (target.disabled) return;
      const action = target.dataset.action;
      const id = target.dataset.id || '';
      if (s.saving && MEDIA_ACTIONS.has(action)) return;
      switch (action) {
        case 'mode': showMode(id); break;
        case 'kind': setKind(id); break;
        case 'pick-files': $('#entry-files')?.click(); break;
        case 'media-earlier': moveItem(id, -1); break;
        case 'media-later': moveItem(id, 1); break;
        case 'media-remove': removeItem(id); break;
        case 'cover-pick': $('#entry-cover-file')?.click(); break;
        case 'cover-remove': removeCover(); break;
        case 'cancel-upload':
          if (s.saving && s.controller) {
            s.controller.abort();
            say('Cancelling…');
          }
          break;
        default:
      }
    }),
    delegate(el, 'change', '#entry-files', (event, input) => {
      const files = [...(input.files || [])];
      try { input.value = ''; } catch { /* some engines refuse to reset a file input */ }
      addFiles(files);
    }),
    delegate(el, 'change', '#entry-cover-file', (event, input) => {
      const file = [...(input.files || [])][0];
      try { input.value = ''; } catch { /* some engines refuse to reset a file input */ }
      chooseCover(file);
    }),
    delegate(el, 'submit', '#editor-form', save),
    // Enter in a single-line field must not submit the form: the browser would press its default button. Two guards: this handler, and the
    // hidden, disabled submit button that comes first in the form (a disabled default button blocks implicit submission everywhere, phone
    // "Go" keys included). Save draft and Publish are only ever pressed on purpose.
    delegate(el, 'keydown', '#editor-form input', (event, input) => {
      if (event.key === 'Enter' && input.type !== 'file') event.preventDefault();
    }),
    delegate(el, 'input', '#editor-form', event => {
      const target = event.target;
      if (target.dataset?.alt) {
        const item = s.items.find(candidate => candidate.key === target.dataset.alt);
        if (item) { item.alt = target.value; touch(); }
        return;
      }
      if (target.type === 'file') return;
      touch();
      if (target.id in FIELDS) {
        const note = $(`#err-${FIELDS[target.id]}`);
        if (note) note.textContent = '';
        target.removeAttribute('aria-invalid');
      }
      updateCount(target);
    }),
    delegate(el, 'change', '#editor-form', event => {
      const target = event.target;
      if (target.type === 'file' || target.dataset?.alt) return;
      touch();
      if (target.id === 'entry-image') paintCover();
      if (target.id === 'entry-access') {
        const help = $('#entry-access-help');
        if (help) help.textContent = accessHelp(target.value, tiers);
        const note = $('#err-access');
        if (note) note.textContent = '';
      }
    })
  );

  // Dropping files on the editor: any file drag is claimed, so the browser never navigates away to the file.
  const onDragOver = event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    event.target?.closest?.('.ed-dropzone, .ed-cover-field')?.classList.add('is-over');
  };
  const onDragLeave = event => event.target?.closest?.('.ed-dropzone, .ed-cover-field')?.classList.remove('is-over');
  const onDrop = event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    for (const zone of el.querySelectorAll('.is-over')) zone.classList.remove('is-over');
    if (s.saving) return;
    const files = [...(event.dataTransfer.files || [])];
    // A picture dropped on the cover study of a text post is its cover; anywhere else files are attachments.
    if (s.kind === 'text' && event.target?.closest?.('#editor-cover-field') && files.length === 1 && media().classify(files[0]) === 'image') chooseCover(files[0]);
    else addFiles(files);
  };
  el.addEventListener('dragover', onDragOver);
  el.addEventListener('dragleave', onDragLeave);
  el.addEventListener('drop', onDrop);
  stops.push(() => { el.removeEventListener('dragover', onDragOver); el.removeEventListener('dragleave', onDragLeave); el.removeEventListener('drop', onDrop); });

  // --- Cleanup --------------------------------------------------------------------------------------

  return () => {
    alive = false;
    clearTimeout(sayTimer);
    for (const stop of stops) stop();
    s.controller?.abort();
    // Files this session stored itself and the creator then discarded (a failed save, then Leave) must not stay on a live post.
    if (!s.finished) {
      const undo = sessionUploads(s);
      if (undo.length) undoUploads(api, undo);
    }
    for (const item of s.items) revoke(item.url, item.src, item.thumb);
    revoke(s.cover.pendingUrl);
    if (ctx.router.block === block) ctx.router.block = null;
  };
}
