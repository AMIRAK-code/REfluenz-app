// Entries (posts): feeds, lists, reading, saving and deleting. Writes go through the save_entry function; the media pipeline is in media.js.
import { COVER_BUCKET, COVER_IMAGE, ENTRY_COLUMNS, ENTRY_WITH_CREATOR, ENTRY_KINDS, check, clampLimit, cursorTime, pageOf, mapPage, popularCursor, parsePopularCursor, unique, isUuid, putImage } from './util.js';

// The followed-creators filter travels in the URL, so it is capped to keep the request well below proxy limits.
const FEED_CREATOR_LIMIT = 200;
const EMPTY_PAGE = {items: [], nextCursor: null};

export function createEntries(ctx, {purge, circle}) {
  const {client, map} = ctx;

  const removeCoverFile = async path => { if (path) try { await client.storage.from(COVER_BUCKET).remove([path]); } catch { /* orphaned files are harmless */ } };

  const newestFirst = (query, cursor) => {
    const time = cursorTime(cursor);
    return (time ? query.lt('published_at', time) : query).order('published_at', {ascending: false});
  };
  // Most appreciated first, newest first among equals. The cursor carries both values so the next page continues exactly after the last row.
  const popularFirst = (query, cursor) => {
    const at = parsePopularCursor(cursor);
    const after = at ? query.or(`like_count.lt.${at.count},and(like_count.eq.${at.count},published_at.lt.${at.time})`) : query;
    return after.order('like_count', {ascending: false}).order('published_at', {ascending: false});
  };

  return {
    // scope 'all': everything published. 'following': creators the person follows or belongs to. Pass `creatorIds` (the store has them)
    // to skip the lookup. Guests have no circle, so 'following' is empty for them.
    async feed({scope = 'all', category, kind, sort = 'new', cursor, limit, creatorIds} = {}) {
      const size = clampLimit(limit);
      let query = client.from('entries').select(ENTRY_WITH_CREATOR).eq('status', 'published');
      if (scope === 'following') {
        const ids = unique(creatorIds ?? await circle.ids()).slice(0, FEED_CREATOR_LIMIT);
        if (!ids.length) return EMPTY_PAGE;
        query = query.in('creator_id', ids);
      }
      if (category) query = query.eq('category', category);
      if (ENTRY_KINDS.includes(kind)) query = query.eq('kind', kind);
      const popular = sort === 'popular';
      const rows = check(await (popular ? popularFirst(query, cursor) : newestFirst(query, cursor)).limit(size + 1));
      return mapPage(pageOf(rows, size, popular ? popularCursor : row => row.published_at), map.entry);
    },

    // An atelier's posts. 'published' is newest first; 'draft' (the owner's, row level security hides them from everyone else) is last edited first.
    async creatorEntries(creatorId, {status = 'published', kind, cursor, limit} = {}) {
      if (!isUuid(creatorId)) return EMPTY_PAGE;
      const size = clampLimit(limit);
      const draft = status === 'draft';
      const column = draft ? 'updated_at' : 'published_at';
      let query = client.from('entries').select(ENTRY_COLUMNS).eq('creator_id', String(creatorId).toLowerCase()).eq('status', draft ? 'draft' : 'published');
      if (ENTRY_KINDS.includes(kind)) query = query.eq('kind', kind);
      const time = cursorTime(cursor);
      if (time) query = query.lt(column, time);
      const rows = check(await query.order(column, {ascending: false}).limit(size + 1));
      return mapPage(pageOf(rows, size, row => row[column]), map.entry);
    },

    async getEntry(id) {
      if (!isUuid(id)) return null;
      const row = check(await client.from('entries').select(ENTRY_WITH_CREATOR).eq('id', String(id).toLowerCase()).maybeSingle());
      return row ? map.entry(row) : null;
    },
    // The full text, or null when the reader's membership does not cover it. A caption can be empty ('') and is still readable.
    async getBody(id) {
      if (!isUuid(id)) return null;
      const rows = check(await client.from('entry_bodies').select('body').eq('entry_id', String(id).toLowerCase()));
      return rows[0]?.body ?? null;
    },

    // values: {kind, title, subtitle, body, category, format, image, access}. The server validates by kind and returns the entry id.
    async saveEntry(id, values, status) {
      return check(await client.rpc('save_entry', {p_id: id || null, p_title: values.title, p_subtitle: values.subtitle ?? '', p_body: values.body ?? '', p_category: values.category,
        p_format: values.format, p_image: values.image, p_access: values.access, p_status: status, p_kind: values.kind || 'text'}));
    },

    // Reads the media (and cover) first, so the files can be removed once the rows cascade away. A failed read stops the delete: it is safe
    // to retry, and nothing is left orphaned in storage.
    async deleteEntry(id) {
      const [rows, entry] = await Promise.all([
        client.from('entry_media').select('path,poster_path,preview_path').eq('entry_id', id).then(check),
        client.from('entries').select('cover_path').eq('id', id).maybeSingle().then(check)
      ]);
      check(await client.from('entries').delete().eq('id', id));
      await Promise.all([
        purge((rows || []).map(r => ({path: r.path, posterPath: r.poster_path, previewPath: r.preview_path}))),
        removeCoverFile(entry?.cover_path)
      ]);
    },

    // Uploads the picture only; setEntryCover attaches it. Returns the object path.
    async uploadEntryCover(creatorId, blob) {
      if (!isUuid(creatorId)) throw Error('That atelier could not be found.');
      return putImage(client, COVER_BUCKET, String(creatorId).toLowerCase(), blob, {uuid: ctx.uuid, ...COVER_IMAGE});
    },
    // Attaches an uploaded cover (or clears it with null) and removes the file it replaces.
    async setEntryCover(entryId, path) {
      const previous = check(await client.from('entries').select('cover_path').eq('id', entryId).maybeSingle())?.cover_path ?? null;
      check(await client.rpc('set_entry_cover', {p_entry: entryId, p_path: path ?? null}));
      if (previous && previous !== path) await removeCoverFile(previous);
    },

    // Counts a read for analytics. Never throws: reading must not fail because a counter could not be bumped.
    async recordRead(id) {
      try {
        if (await ctx.getUserId()) await client.rpc('record_read', {p_entry: id});
      } catch { /* analytics only */ }
    }
  };
}
