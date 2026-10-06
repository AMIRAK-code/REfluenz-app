// Private threads between a member and an atelier's owner, and the circle notes an owner posts for members.
import { CREATOR_COLUMNS, PERSON_COLUMNS, MESSAGE_COLUMNS, NOTE_COLUMNS, check, chunk, unique, cleanMessage, cleanNote } from './util.js';

const INBOX_LIMIT = 200;
const THREAD_LIMIT = 200;
const NOTES_LIMIT = 100;
const ID_CHUNK = 100;
const SENDERS = ['member', 'creator'];

export function createMessages(ctx) {
  const {client, map} = ctx;

  // Rows of `table` whose id is in `ids`, looked up in chunks that keep the URL short.
  async function byIds(table, columns, ids) {
    const parts = await Promise.all(chunk(unique(ids), ID_CHUNK).map(async part => check(await client.from(table).select(columns).in('id', part))));
    return Object.fromEntries(parts.flat().map(row => [row.id, row]));
  }

  return {
    // One row per conversation, newest first; `unread` counts what the viewer has not opened yet.
    async inbox() {
      const rows = check(await client.rpc('inbox').limit(INBOX_LIMIT)) || [];
      const [creators, members] = await Promise.all([
        byIds('creators', CREATOR_COLUMNS, rows.map(r => r.creator_id)),
        byIds('profiles', PERSON_COLUMNS, rows.map(r => r.member_id))
      ]);
      return rows.filter(r => creators[r.creator_id]).map(r => ({creatorId: r.creator_id, memberId: r.member_id, creator: map.creator(creators[r.creator_id]), member: map.person(members[r.member_id], r.member_id),
        lastBody: r.last_body ?? '', lastSender: r.last_sender, lastAt: r.last_at, unread: r.unread ?? 0}));
    },

    // The latest messages of one thread, oldest first.
    async thread(creatorId, memberId) {
      const rows = check(await client.from('messages').select(MESSAGE_COLUMNS).eq('creator_id', creatorId).eq('member_id', memberId).order('created_at', {ascending: false}).limit(THREAD_LIMIT));
      return rows.reverse().map(map.message);
    },
    // `from` is 'member' (the person writing to an atelier) or 'creator' (the owner replying in a thread the member started).
    async sendMessage(creatorId, memberId, from, body) {
      if (!SENDERS.includes(from)) throw Error('Choose who is sending the message.');
      await ctx.requireUserId();
      const row = check(await client.from('messages').insert({creator_id: creatorId, member_id: memberId, sender: from, body: cleanMessage(body)}).select(MESSAGE_COLUMNS).single());
      return map.message(row);
    },
    async markThreadRead(creatorId, memberId) { check(await client.rpc('mark_thread_read', {p_creator: creatorId, p_member: memberId})); },

    async listNotes(creatorId) {
      return check(await client.from('circle_notes').select(NOTE_COLUMNS).eq('creator_id', creatorId).order('created_at', {ascending: false}).limit(NOTES_LIMIT)).map(map.note);
    },
    async postNote(creatorId, body) {
      await ctx.requireUserId();
      return map.note(check(await client.from('circle_notes').insert({creator_id: creatorId, body: cleanNote(body)}).select(NOTE_COLUMNS).single()));
    },
    async deleteNote(id) { check(await client.from('circle_notes').delete().eq('id', id)); }
  };
}
