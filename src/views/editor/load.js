// What the editor needs before it can draw: the atelier's tiers (for the access select) and, when editing, the post, its text and its files.

import { KINDS } from '../../core/constants.js';
import { kindOf } from '../../core/format.js';
import { cleanupDone } from './save.js';

export async function loadEditor(ctx) {
  const { api, store, params, query } = ctx;
  const creator = store.state.myCreator;
  const id = params.id || '';
  await cleanupDone();   // files that a discarded edit is still removing must be gone before this post's files are read

  if (!id) {
    const kind = KINDS.includes(query.kind) ? query.kind : 'text';
    const tiers = await api.listTiers(creator.id);
    return { mode: 'new', creator, tiers, kind, entry: null, body: '', items: [], strays: [] };
  }

  const [tiers, entry] = await Promise.all([api.listTiers(creator.id), api.getEntry(id)]);
  if (!entry || entry.creatorId !== creator.id) return { mode: 'edit', missing: true, creator };
  const kind = kindOf(entry);

  // The text and the file list are read together. A text post has no files, so a failed lookup is not worth stopping for. For image and
  // video posts it is: saving without knowing the files could not clean up after itself.
  const [body, list] = await Promise.all([
    api.getBody(id),
    api.media([id]).then(found => found?.[id] ?? [], error => { if (kind !== 'text') throw error; return []; })
  ]);
  if (body === null || body === undefined) throw Error('We could not read the text of this post. Try again in a moment.');

  // Files of another kind than the post (a save that failed half way can leave some, for example the new video of a switch from images)
  // can never be published with it, and the server refuses to. They are queued for removal and the next save clears them.
  const own = list.filter(row => row.kind === kind);
  const strays = list.filter(row => row.kind !== kind);
  const paths = own.flatMap(row => [row.path, row.posterPath]).filter(Boolean);
  let urls = {};
  if (paths.length) {
    try { urls = (await api.signedUrls(paths)) || {}; } catch { /* Pictures are optional here: the editor opens without them. */ }
  }
  // The grid shows the small card thumbnail of an image (or a film's poster); `src` is the file itself, for the preview.
  const items = own.map(row => ({
    media: row,
    alt: row.alt || '',
    url: urls[row.posterPath] || (row.kind === 'video' ? '' : urls[row.path]) || '',
    src: urls[row.path] || '',
    poster: urls[row.posterPath] || ''
  }));
  return { mode: 'edit', creator, tiers, kind, entry, body, items, strays };
}
