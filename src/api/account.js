// The person's own data: a full export, and deleting the account through the delete-account edge function.
import { PROFILE_COLUMNS, SETTINGS_COLUMNS, CREATOR_COLUMNS, ENTRY_COLUMNS, MEDIA_COLUMNS, MEMBERSHIP_COLUMNS, COMMENT_COLUMNS, MESSAGE_COLUMNS, NOTE_COLUMNS,
  NETWORK, NOT_SIGNED_IN, SESSION_LOST, check, fetchAll, friendly, isoTime } from './util.js';

const DELETE_FAILED = 'Your account could not be deleted. Try again in a moment.';

export function createAccount(ctx) {
  const {client, map} = ctx;

  // Every row of a table the person can read, in created_at order, in ranges of 1000.
  const rows = (table, columns, filter = q => q) =>
    fetchAll((from, to) => filter(client.from(table).select(columns)).order('created_at', {ascending: true}).range(from, to));

  async function accessToken() {
    let token = null;
    try { token = (await client.auth.getSession())?.data?.session?.access_token; } catch { /* treated as signed out */ }
    if (!token) throw Error(NOT_SIGNED_IN);
    return token;
  }

  return {
    // Everything tied to the account except media files (those stay in storage): profile, settings, relationships, writing and the atelier.
    async exportData() {
      const userId = await ctx.requireUserId();
      const user = (await client.auth.getSession())?.data?.session?.user;
      const [profile, settings, creatorRow] = await Promise.all([
        client.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single().then(check),
        client.from('user_settings').select(SETTINGS_COLUMNS).eq('user_id', userId).maybeSingle().then(check),
        client.from('creators').select(CREATOR_COLUMNS).eq('owner_id', userId).maybeSingle().then(check)
      ]);
      const own = creatorRow?.id;
      const [follows, bookmarks, likes, memberships, comments, messages, notes, entries] = await Promise.all([
        rows('follows', 'creator_id,created_at', q => q.eq('user_id', userId)),
        rows('bookmarks', 'entry_id,created_at', q => q.eq('user_id', userId)),
        rows('likes', 'entry_id,created_at', q => q.eq('user_id', userId)),
        rows('memberships', MEMBERSHIP_COLUMNS, q => q.eq('user_id', userId)),
        rows('comments', COMMENT_COLUMNS, q => q.eq('author_id', userId)),
        rows('messages', MESSAGE_COLUMNS),
        own ? rows('circle_notes', NOTE_COLUMNS, q => q.eq('creator_id', own)) : [],
        own ? rows('entries', `${ENTRY_COLUMNS},body:entry_bodies(body),media:entry_media(${MEDIA_COLUMNS})`, q => q.eq('creator_id', own)) : []
      ]);
      return {
        exportedAt: isoTime(ctx.now()),
        account: {id: userId, email: user?.email ?? null},
        profile: map.profile(profile),
        settings: map.settings(settings),
        atelier: creatorRow ? map.creator(creatorRow) : null,
        entries: entries.map(row => ({...map.entry(row), body: row.body?.body ?? '', media: (row.media || []).map(map.media)})),
        notes: notes.map(map.note),
        follows: follows.map(r => ({creatorId: r.creator_id, createdAt: r.created_at})),
        bookmarks: bookmarks.map(r => ({entryId: r.entry_id, createdAt: r.created_at})),
        likes: likes.map(r => ({entryId: r.entry_id, createdAt: r.created_at})),
        memberships: memberships.map(map.membership),
        comments: comments.map(map.comment),
        messages: messages.map(map.message)
      };
    },

    // The edge function verifies the session, removes the atelier, the stored files and finally the user. The caller then shows the goodbye page.
    async deleteAccount() {
      const token = await accessToken();
      if (!ctx.fetch) throw Error('Deleting an account is not supported in this browser.');
      let response;
      try {
        response = await ctx.fetch(`${ctx.url}/functions/v1/delete-account`, {method: 'POST', headers: {authorization: `Bearer ${token}`, apikey: ctx.key, 'content-type': 'application/json'}, body: '{}'});
      } catch { throw Error(NETWORK); }
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw Error(response.status === 401 ? SESSION_LOST : detail?.error ? friendly({message: detail.error}) : DELETE_FAILED);
      }
      try { await client.auth.signOut({scope: 'local'}); } catch { /* the user no longer exists; the local session is dropped below */ }
      ctx.setUserId(null);
    }
  };
}
