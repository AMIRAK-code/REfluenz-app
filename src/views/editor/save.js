// The save flow of the editor (docs/POST_FORMATS.md, "Save flow"). No DOM in here: the page hands in the state `s`, the api and two
// callbacks (a status line and a progress painter), so every step can be tested on its own.
//
// The order never varies, so a failed step cannot leave a published post without its media:
//   1. a draft, when a new post needs an id for its files     2. the new files, two at a time (all of them are stored before anything goes)
//   3. the files the creator removed, together with           4. the order and the alt texts
//   5. an uploaded cover (text posts)                          6. the final save with the real status (the server re-checks the shape)
//   7. the cover is attached to the post (or taken off it).
// The database tolerates the transient surplus this needs: up to 20 images or 2 videos per post while a save is running.
// Progress lives on the items, in `s.entryId`, `s.removed` and `s.cover`, so a retry continues where the save stopped instead of
// repeating work. `signal` is the creator's Cancel button: it stops the uploads in flight and every step after them.

import { CANCELLED } from '../../api/util.js';
import { plural } from '../../core/format.js';
import { deps } from './deps.js';
import { UPDATES_AT_ONCE, UPLOADS_AT_ONCE, itemName, pool } from './model.js';

// The most media rows of one kind a post may hold while a save runs (the insert guard of the database).
const HEADROOM = { image: 20, video: 2 };

// What a discarded editing session leaves attached to the post: the files it uploaded itself. A kind with no file from before the session is
// left alone, so a published post never loses its last file (the database would send it back to draft).
export function sessionUploads(s) {
  if (!s.entryId || !s.uploaded.size) return [];
  const attached = [...s.items.map(item => item.media).filter(Boolean), ...s.removed];
  const before = attached.filter(row => !s.uploaded.has(row.id));
  return attached.filter(row => s.uploaded.has(row.id) && before.some(other => other.kind === row.kind));
}

// Best effort and one request at a time: the editor waits for it before it reads a post's files again (see load.js).
let queue = Promise.resolve();
export const cleanupDone = () => queue;
export function undoUploads(api, list) {
  queue = queue.then(async () => {
    try { await api.removeMedia(list); } catch { /* the creator can still remove them from the editor next time */ }
  });
  return queue;
}

export function createSaver({ api, s, creatorId, say = () => {}, progress = () => {} }) {
  // Removes the media rows (and their files) that the creator deleted, in one request. A row leaves the queue only once it is gone.
  async function dropRemoved() {
    const batch = [...s.removed];
    if (!batch.length) return;
    await api.removeMedia(batch);
    for (const row of batch) s.removed.splice(s.removed.indexOf(row), 1);
  }

  // Frees insert headroom when a retry would otherwise run into the transient cap. The only files that may go before the uploads are ones
  // this very session stored and the creator then discarded again after a failed save: they were never part of the post. Only as many as the
  // cap needs are removed, so at least one file of the kind (an original, or the newest upload) stays and a published post is never emptied.
  async function makeRoom(kind, incoming) {
    const cap = HEADROOM[kind] ?? HEADROOM.image;
    const held = s.removed.filter(row => row.kind === kind).length + s.items.filter(item => item.media?.kind === kind).length;
    const batch = s.removed.filter(row => row.kind === kind && s.uploaded.has(row.id)).slice(0, Math.max(0, held + incoming - cap));
    if (!batch.length) return;
    await api.removeMedia(batch);
    for (const row of batch) s.removed.splice(s.removed.indexOf(row), 1);
  }

  // Returns the id of the saved post. Throws the first problem; the page shows it and keeps everything that was finished.
  async function persist(values, status, signal) {
    const stopped = () => { if (signal?.aborted) throw Error(CANCELLED); };
    const pending = s.items.filter(item => item.file);
    const total = pending.length;

    if (total && !s.entryId) {
      say('Saving draft…');
      s.entryId = await api.saveEntry(null, values, 'draft');
    }
    if (total) await makeRoom(values.kind, total);

    // Two files at a time: while one is prepared (decoded and re-encoded) the other uploads, so neither the processor nor the network
    // sits idle. Once a file has failed nothing new starts, but the one still running is allowed to finish, so its upload is not thrown away.
    let started = 0;
    const failed = await pool(pending, UPLOADS_AT_ONCE, async (item, index) => {
      item.progress = 0;
      item.failed = false;
      item.error = '';
      progress(item);
      try {
        stopped();
        say(values.kind === 'video' ? 'Preparing video…' : `Preparing image ${index + 1} of ${total}…`);
        const prepared = await (values.kind === 'video' ? deps.media.prepareVideo(item.file) : deps.media.prepareImage(item.file));
        stopped();
        say(`Uploading ${++started} of ${total}…`);
        item.media = await api.uploadMedia(s.entryId, creatorId, prepared, {
          position: s.items.indexOf(item),
          alt: item.alt,
          signal,
          onProgress: fraction => { item.progress = fraction; progress(item); }
        });
        s.uploaded.add(item.media.id);
        item.file = null;
        item.progress = 1;
        progress(item);
      } catch (error) {
        const cancelled = Boolean(signal?.aborted);
        item.progress = null;
        item.failed = true;
        item.error = cancelled ? '' : error.message;
        throw cancelled ? error : new Error(`${itemName(item, index + 1)}: ${error.message}`, { cause: error });
      }
    }, () => Boolean(signal?.aborted));
    if (failed.length) {
      // Each file that failed also says why next to itself; the summary names the first one and counts the others.
      const [first, ...others] = failed;
      throw signal?.aborted || !others.length ? first : new Error(`${first.message} ${plural(others.length, 'other file')} also failed.`, { cause: first });
    }
    stopped();

    // Removing what the creator deleted and saving the order and descriptions touch different rows, so both go out together.
    const changed = s.items.map((item, index) => ({ item, index })).filter(({ item, index }) => item.media && (item.media.position !== index || (item.media.alt || '') !== item.alt));
    const tidy = s.removed.length && changed.length ? 'Removing old files and saving the order…' : s.removed.length ? 'Removing the old files…' : changed.length ? 'Saving the order and descriptions…' : '';
    if (tidy) say(tidy);
    const [removal, updates] = await Promise.all([
      dropRemoved().then(() => [], error => [error]),
      pool(changed, UPDATES_AT_ONCE, async ({ item, index }) => {
        await api.updateMedia(item.media.id, { alt: item.alt, position: index });
        item.media = { ...item.media, alt: item.alt, position: index };
      })
    ]);
    if (removal.length || updates.length) throw [...removal, ...updates][0];
    stopped();

    // The cover of a text post: the picture goes up first (it needs no post), and is attached once the post is saved.
    const text = values.kind === 'text';
    const cover = s.cover;
    if (text && cover.file && !cover.uploadedPath) {
      say('Preparing your cover…');
      const prepared = await deps.media.prepareImage(cover.file);
      stopped();
      say('Uploading your cover…');
      cover.uploadedPath = await api.uploadEntryCover(creatorId, prepared.blob);
    }
    stopped();

    // An identical retry (the final save worked and only the cover failed) does not send the post again.
    const key = JSON.stringify([values, status]);
    if (s.savedKey !== key) {
      say(status === 'published' ? 'Publishing…' : 'Saving…');
      s.entryId = await api.saveEntry(s.entryId || null, values, status);
      s.savedKey = key;
    }
    s.status = status;

    if (text && cover.uploadedPath) {
      say('Adding your cover…');
      await api.setEntryCover(s.entryId, cover.uploadedPath);
      cover.path = cover.uploadedPath;
      cover.uploadedPath = null;
      cover.file = null;
      cover.removed = false;
    } else if (cover.path && (cover.removed || !text)) {
      // The creator took the cover away, or the post is no longer a text post: a leftover cover would only sit unused.
      say('Removing your cover…');
      await api.setEntryCover(s.entryId, null);
      cover.path = null;
      cover.url = '';
      cover.removed = false;
    }
    return s.entryId;
  }

  // What the creator is told after a failed save: the draft and the finished uploads are still there, and which button continues.
  function recoveryNote() {
    if (!s.entryId) return 'Press Save draft or Publish to try again.';
    const stored = s.items.filter(item => item.media && s.uploaded.has(item.media.id)).length;
    const next = `Press Save draft or ${s.live ? 'Update post' : 'Publish'} to continue.`;
    const what = s.live ? 'Your changes' : 'Your draft';
    return stored ? `${what} and ${plural(stored, 'uploaded file')} are kept. ${next}` : `${what} ${s.live ? 'are' : 'is'} kept. ${next}`;
  }

  return { persist, makeRoom, dropRemoved, recoveryNote };
}
