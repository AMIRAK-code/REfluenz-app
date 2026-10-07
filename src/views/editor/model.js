// The editor's rules and small pure helpers: what a post may hold, how a form is checked, how the page state starts out.
// Nothing here touches the DOM or the network.

import { CATEGORIES, COVER_IMAGE } from '../../api/util.js';
import { DEFAULT_FORMAT, FORMATS, KINDS, PRESETS, TEXT_FORMATS } from '../../core/constants.js';
import { kindOf } from '../../core/format.js';

export { CATEGORIES };

export const RULES = Object.freeze({ titleMin: 3, titleMax: 100, bodyMin: 30, bodyMax: 20000, introMax: 180, altMax: 200 });
export const UPLOADS_AT_ONCE = 2;   // files in flight at the same time while saving
export const UPDATES_AT_ONCE = 4;   // media rows updated at the same time
export const COVER_TYPES = COVER_IMAGE.types;
export const COVER_MAX_BYTES = COVER_IMAGE.maxBytes;

export const KIND_LABEL = { text: 'Text', image: 'Image', video: 'Video' };
export const KIND_ICON = { text: 'text', image: 'image', video: 'video' };
export const PRESET_LABEL = name => `${name[0].toUpperCase()}${name.slice(1)}`;

// The formats on offer for a kind: five for text, all of them for media. `current` is kept when the database accepts it
// (a post written as an "Update") so that editing it does not silently change it.
export const formatsFor = (kind, current) => {
  const list = kind === 'text' ? [...TEXT_FORMATS] : [...FORMATS];
  if (current === 'Update' && !list.includes('Update')) list.push('Update');
  return list;
};
export const formatFor = (kind, current) => (formatsFor(kind, current).includes(current) ? current : DEFAULT_FORMAT[kind]);

export const bodyLabel = kind => (kind === 'text' ? 'Your post' : 'Caption (optional)');
export const bodyHint = kind => (kind === 'text' ? 'What have you been noticing?' : 'Say a little about this work, or leave it empty.');
export const bodyHelp = kind => (kind === 'text'
  ? 'Plain text. Separate paragraphs with a blank line. The first paragraph is the free preview of member posts.'
  : 'Optional. Plain text; separate paragraphs with a blank line. The first paragraph is the free preview of member posts.');
// Media posts show their own picture on cards, so the preset cover is only a fallback while that loads.
export const coverNote = kind => `Cards show your ${kind === 'video' ? 'video’s poster frame' : 'first image'}. The editorial cover stays as the fallback card image.`;

export const maxItems = (media, kind) => (kind === 'video' ? 1 : media?.LIMITS?.maxImages || 10);

export const sentence = text => (/[.!?…]$/.test(text) ? text : `${text}.`);
export const itemName = (item, n) => item.name || item.file?.name || String(item.media?.path || '').split('/').pop() || `Item ${n}`;

// Programming errors say nothing a person can use; the api's friendly messages are shown as they are.
const PROGRAMMING = [TypeError, ReferenceError, SyntaxError, RangeError];
export const messageOf = error => (PROGRAMMING.some(type => error instanceof type) ? 'Something went wrong. Try again in a moment.' : error?.message || 'Something went wrong. Try again in a moment.');

// Splits text into paragraphs on blank lines.
export const paragraphs = text => String(text ?? '').split(/\r?\n[ \t]*\r?\n/).map(part => part.trim()).filter(Boolean);

export const readingMinutes = text => Math.max(1, Math.ceil((String(text ?? '').trim().split(/\s+/).filter(Boolean).length || 1) / 200));

// --- Validation -----------------------------------------------------------------

// The access values a creator may pick: 'public' and the tiers of the atelier.
export const accessIds = tiers => ['public', ...tiers.map(tier => tier.id)];

// Checks the form values and the media rules the form cannot express (the server enforces the same ones).
// Returns the first problem as {field, message}, or null. `status` is the one being saved: a draft may be empty of media.
export function validate(values, { status, mediaCount = 0, access = ['public'], maxImages = 10 } = {}) {
  const { kind, title, subtitle, body } = values;
  if (!KINDS.includes(kind)) return { field: 'kind', message: 'Choose a post type.' };
  if (title.length < RULES.titleMin || title.length > RULES.titleMax) return { field: 'title', message: `Use a title between ${RULES.titleMin} and ${RULES.titleMax} characters.` };
  if (subtitle.length > RULES.introMax) return { field: 'subtitle', message: `Keep the introduction under ${RULES.introMax} characters.` };
  if (kind === 'text' && (body.length < RULES.bodyMin || body.length > RULES.bodyMax)) return { field: 'body', message: 'Write between 30 and 20,000 characters for your post.' };
  if (body.length > RULES.bodyMax) return { field: 'body', message: 'Keep the caption under 20,000 characters.' };
  if (!access.includes(values.access)) return { field: 'access', message: 'Choose who can read this post.' };
  if (!CATEGORIES.includes(values.category)) return { field: 'category', message: 'Choose a category.' };
  if (!PRESETS.includes(values.image)) return { field: 'image', message: 'Choose a cover.' };
  if (kind === 'image' && mediaCount > maxImages) return { field: 'media', message: `Use up to ${maxImages} images.` };
  if (kind === 'image' && status === 'published' && !mediaCount) return { field: 'media', message: 'Add at least one image before publishing.' };
  if (kind === 'video' && mediaCount > 1) return { field: 'media', message: 'A post holds exactly one video. Remove the extra one.' };
  if (kind === 'video' && status === 'published' && !mediaCount) return { field: 'media', message: 'Add a video before publishing.' };
  return null;
}

// A cover for a text post: a picture the browser can show (JPG, PNG or WebP, not a GIF) of a size the bucket takes.
export function coverProblem(file, media) {
  if (!file) return 'No file was selected.';
  const kind = media?.classify?.(file);
  const type = String(file.type || '').toLowerCase();
  if (kind !== 'image' || (type && !COVER_TYPES.includes(type))) return 'Use a JPG, PNG or WebP picture for the cover.';
  if (Number(file.size) === 0) return 'That file is empty.';
  const max = media?.LIMITS?.maxImageInputBytes || 25 * 1048576;
  if (Number(file.size) > max) return `That picture is larger than ${Math.round(max / 1048576)} MB. Choose a smaller one.`;
  return null;
}

// --- Concurrency ----------------------------------------------------------------

// Runs job(item, index) over the list with at most `limit` jobs in flight. Nothing new starts once a job has failed or
// `stop()` says so, but the jobs already running are awaited, so none is left running behind the caller.
// Resolves with the errors, in the order they happened.
export async function pool(list, limit, job, stop = () => false) {
  const errors = [];
  let next = 0;
  const worker = async () => {
    while (next < list.length && !errors.length && !stop()) {
      const index = next++;
      try { await job(list[index], index); } catch (error) { errors.push(error); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return errors;
}

// --- Page state -----------------------------------------------------------------

let keys = 0;
export const nextKey = () => `m${++keys}`;

// The values the form starts with: the post being edited, or the defaults of a new one.
export function initialValues(data) {
  const { entry, creator, kind } = data;
  const category = entry?.category ?? (CATEGORIES.includes(creator?.category) ? creator.category : CATEGORIES[0]);
  return {
    title: entry?.title ?? '',
    subtitle: entry?.subtitle ?? '',
    body: data.body ?? '',
    category,
    format: formatFor(kind, entry?.format),
    image: PRESETS.includes(entry?.image) ? entry.image : PRESETS.includes(creator?.image) ? creator.image : PRESETS[0],
    access: entry?.access ?? 'public'
  };
}

// The state of one editing session. `data` comes from the view's load(); it is never changed.
export function createState(data) {
  const { entry } = data;
  return {
    kind: data.kind,
    entryId: entry?.id ?? '',
    status: entry?.status ?? 'draft',        // what the post was when the page opened: decides "Update" and "Move to drafts"
    live: entry?.status === 'published',     // the post was live when the page opened (its buttons read "Update post" and "Move to drafts")
    items: (data.items ?? []).map(item => ({ ...item, key: nextKey(), progress: null })),
    removed: [...(data.strays ?? [])],       // media rows queued for removal when the post is saved
    uploaded: new Set(),                     // ids of media this editing session stored itself
    cover: {
      path: entry?.coverPath ?? null,        // the uploaded cover the post has now
      url: entry?.coverUrl ?? '',
      file: null,                            // a picture chosen but not yet uploaded
      pendingUrl: '',                        // its local preview
      uploadedPath: null,                    // uploaded by a save that stopped before attaching it: reused on the next try
      removed: false                         // the creator took the uploaded cover away
    },
    mode: 'write',
    saving: false,
    controller: null,                        // the AbortController of the save in progress (Cancel upload)
    dirty: false,
    finished: false,
    note: '',                                // the message shown in the media section
    savedKey: ''                             // what the last successful final save sent: an identical retry does not send it again
  };
}

export { kindOf };
