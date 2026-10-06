// Follows, likes, bookmarks and comments. Repeating a follow, like or bookmark is not an error: the person already has the state they asked for.
import { ENTRY_WITH_CREATOR, COMMENT_COLUMNS, check, checkInsert, clampLimit, cursorTime, pageOf, mapPage, cleanComment } from './util.js';

const COMMENTS_LIMIT = 500;

export function createSocial(ctx, {circle}) {
  const {client, map} = ctx;

  // follows, likes and bookmarks are all (user_id, <column>) rows.
  async function setRelation(table, column, id, on) {
    const userId = await ctx.requireUserId();
    const result = on ? await client.from(table).insert({user_id: userId, [column]: id}) : await client.from(table).delete().match({user_id: userId, [column]: id});
    on ? checkInsert(result) : check(result);
  }

  return {
    async setFollow(creatorId, on) { await setRelation('follows', 'creator_id', creatorId, on); circle.forget(); },
    async setLike(entryId, on) { await setRelation('likes', 'entry_id', entryId, on); },
    async setBookmark(entryId, on) { await setRelation('bookmarks', 'entry_id', entryId, on); },

    // Saved posts, most recently saved first. A post that was unpublished or removed since it was saved is left out.
    async savedEntries({cursor, limit} = {}) {
      const userId = await ctx.requireUserId();
      const size = clampLimit(limit);
      let query = client.from('bookmarks').select(`created_at,entry:entries(${ENTRY_WITH_CREATOR})`).eq('user_id', userId);
      const time = cursorTime(cursor);
      if (time) query = query.lt('created_at', time);
      const rows = check(await query.order('created_at', {ascending: false}).limit(size + 1));
      const page = mapPage(pageOf(rows, size, row => row.created_at), row => row.entry);
      return {items: page.items.filter(Boolean).map(map.entry), nextCursor: page.nextCursor};
    },

    // Oldest first, replies carry parentId (one level deep). The most recent 500 are enough for one post.
    async listComments(entryId) {
      const rows = check(await client.from('comments').select(COMMENT_COLUMNS).eq('entry_id', entryId).order('created_at', {ascending: false}).limit(COMMENTS_LIMIT));
      return rows.reverse().map(map.comment);
    },
    async addComment(entryId, body, parentId = null) {
      const userId = await ctx.requireUserId();
      const row = check(await client.from('comments').insert({entry_id: entryId, author_id: userId, parent_id: parentId || null, body: cleanComment(body)}).select(COMMENT_COLUMNS).single());
      return map.comment(row);
    },
    async editComment(id, body) {
      return map.comment(check(await client.from('comments').update({body: cleanComment(body)}).eq('id', id).select(COMMENT_COLUMNS).single()));
    },
    async deleteComment(id) { check(await client.from('comments').delete().eq('id', id)); }
  };
}
