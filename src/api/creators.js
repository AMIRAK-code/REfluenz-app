// Ateliers (creator pages): listing, lookup, opening and editing, and their two public images.
import { COVER_BUCKET, COVER_IMAGE, CREATOR_COLUMNS, CREATOR_TIERS, SLUG, check, checkCount, clampLimit, cleanAtelier, putImage, isUuid, slugify, isoTime } from './util.js';

const IMAGE_COLUMN = {avatar: 'avatar_path', cover: 'cover_path'};
const SLUG_ATTEMPTS = 4;

export function createCreators(ctx, {circle}) {
  const {client, map} = ctx;

  const bad = id => !isUuid(id);
  async function creatorRow(id) {
    return check(await client.from('creators').select(CREATOR_COLUMNS).eq('id', id).single());
  }
  async function updateCreator(id, patch) {
    return map.creator(check(await client.from('creators').update({...patch, updated_at: isoTime(ctx.now())}).eq('id', id).select(CREATOR_COLUMNS).single()));
  }
  const removeImageFile = async path => { if (path) try { await client.storage.from(COVER_BUCKET).remove([path]); } catch { /* orphaned files are harmless */ } };

  const columnOf = kind => {
    if (!IMAGE_COLUMN[kind]) throw Error('Choose the avatar or the cover.');
    return IMAGE_COLUMN[kind];
  };

  return {
    // 'popular' = most followers first, 'new' = newest first. Plain offset paging: the list is small and the order is not stable under writes anyway.
    async listCreators({category, sort = 'popular', limit, offset = 0} = {}) {
      const size = clampLimit(limit);
      const from = Math.max(0, Math.trunc(Number(offset)) || 0);
      let query = client.from('creators').select(CREATOR_COLUMNS);
      if (category) query = query.eq('category', category);
      query = sort === 'new' ? query.order('created_at', {ascending: false}) : query.order('follower_count', {ascending: false}).order('created_at', {ascending: false});
      return check(await query.range(from, from + size - 1)).map(map.creator);
    },

    // Popular ateliers the person does not follow, belong to or own. Guests get the popular ones.
    async suggestedCreators(limit = 6) {
      const size = clampLimit(limit, 6);
      const userId = await ctx.getUserId();
      let query = client.from('creators').select(CREATOR_COLUMNS);
      if (userId) {
        const known = (await circle.ids()).slice(0, 100);
        if (known.length) query = query.not('id', 'in', `(${known.join(',')})`);
        query = query.or(`owner_id.is.null,owner_id.neq.${userId}`);
      }
      return check(await query.order('follower_count', {ascending: false}).order('created_at', {ascending: false}).limit(size)).map(map.creator);
    },

    async getCreatorBySlug(slug) {
      const clean = String(slug ?? '').trim().toLowerCase();
      if (!SLUG.test(clean)) return null;
      const row = check(await client.from('creators').select(`${CREATOR_COLUMNS},${CREATOR_TIERS}`).eq('slug', clean).maybeSingle());
      return row ? {creator: map.creator(row), tiers: map.tiers(row.creator_tiers)} : null;
    },
    async getCreator(id) {
      if (bad(id)) return null;
      const row = check(await client.from('creators').select(CREATOR_COLUMNS).eq('id', String(id).toLowerCase()).maybeSingle());
      return row ? map.creator(row) : null;
    },

    // The slug comes from the name unless one is given. A taken generated slug gets a short suffix; a chosen one is reported as taken.
    async createAtelier(values = {}) {
      const userId = await ctx.requireUserId();
      const clean = cleanAtelier(values);
      for (const field of ['name', 'category']) if (clean[field] === undefined) throw Error(field === 'name' ? 'Give your atelier a name.' : 'Choose a category.');
      const chosen = clean.slug !== undefined;
      const base = clean.slug ?? (slugify(clean.name).length >= 2 ? slugify(clean.name) : 'atelier');
      for (let attempt = 0; ; attempt++) {
        const slug = attempt === 0 ? base : `${base.slice(0, 35)}-${String(ctx.uuid()).replace(/-/g, '').slice(0, 4)}`;
        const result = await client.from('creators').insert({...clean, slug, owner_id: userId}).select(CREATOR_COLUMNS).single();
        const slugTaken = result.error?.code === '23505' && /slug/i.test(result.error.message || '');
        if (slugTaken && !chosen && attempt < SLUG_ATTEMPTS) continue;
        return map.creator(check(result));
      }
    },

    async updateAtelier(id, values = {}) {
      if (bad(id)) throw Error('That atelier could not be found.');
      return updateCreator(id, cleanAtelier(values));
    },

    async slugAvailable(slug) {
      const clean = String(slug ?? '').trim().toLowerCase();
      if (!SLUG.test(clean)) return false;
      return checkCount(await client.from('creators').select('id', {count: 'exact', head: true}).eq('slug', clean)) === 0;
    },

    // Avatar and cover share the public covers bucket, under the atelier's folder. The old file goes once the new one is saved.
    async uploadCreatorImage(creatorId, kind, blob) {
      const column = columnOf(kind);
      if (bad(creatorId)) throw Error('That atelier could not be found.');
      const folder = String(creatorId).toLowerCase();
      const previous = (await creatorRow(folder))[column];
      const path = await putImage(client, COVER_BUCKET, folder, blob, {uuid: ctx.uuid, ...COVER_IMAGE});
      try {
        const creator = await updateCreator(folder, {[column]: path});
        await removeImageFile(previous);
        return creator;
      } catch (error) {
        await removeImageFile(path);
        throw error;
      }
    },
    async removeCreatorImage(creatorId, kind) {
      const column = columnOf(kind);
      if (bad(creatorId)) throw Error('That atelier could not be found.');
      const folder = String(creatorId).toLowerCase();
      const previous = (await creatorRow(folder))[column];
      const creator = await updateCreator(folder, {[column]: null});
      await removeImageFile(previous);
      return creator;
    }
  };
}
