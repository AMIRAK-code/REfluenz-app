// The activity feed (comments, likes, follows, new posts, ...) written by database triggers, and the unread counts behind the badges.
import { PERSON_COLUMNS, check, checkCount, chunk, clampLimit, cursorTime, pageOf, mapPage, isoTime } from './util.js';

// Two relations point at profiles (user_id and actor_id), so the actor embed names its column.
export const NOTIFICATION_COLUMNS = `id,type,actor_id,comment_id,read_at,created_at,actor:profiles!actor_id(${PERSON_COLUMNS}),creator:creators(id,slug,name),entry:entries(id,title)`;
const ID_CHUNK = 100;

export function createNotifications(ctx) {
  const {client, map} = ctx;

  return {
    // Newest first.
    async listNotifications({cursor, limit} = {}) {
      const userId = await ctx.requireUserId();
      const size = clampLimit(limit, 20);
      let query = client.from('notifications').select(NOTIFICATION_COLUMNS).eq('user_id', userId);
      const time = cursorTime(cursor);
      if (time) query = query.lt('created_at', time);
      const rows = check(await query.order('created_at', {ascending: false}).limit(size + 1));
      return mapPage(pageOf(rows, size, row => row.created_at), map.notification);
    },

    // notifications: unread rows of the activity feed, without the 'message' ones (every new message also leaves one, and messages has its
    // own badge, so counting both would show one message twice). messages: unread messages in threads the viewer takes part in
    // (replies to them as a member, or members' messages to their own atelier), the same rule the inbox uses.
    async unreadCounts() {
      const userId = await ctx.getUserId();
      if (!userId) return {notifications: 0, messages: 0};
      const unread = table => client.from(table).select('id', {count: 'exact', head: true}).is('read_at', null);
      const [notifications, messages] = await Promise.all([
        unread('notifications').eq('user_id', userId).neq('type', 'message'),
        unread('messages').or(`and(sender.eq.creator,member_id.eq.${userId}),and(sender.eq.member,member_id.neq.${userId})`)
      ]);
      return {notifications: checkCount(notifications), messages: checkCount(messages)};
    },

    // ids: a list of notification ids, or 'all'.
    async markNotificationsRead(ids) {
      const userId = await ctx.requireUserId();
      const readAt = isoTime(ctx.now());
      const unread = () => client.from('notifications').update({read_at: readAt}).eq('user_id', userId).is('read_at', null);
      if (ids === 'all') { check(await unread()); return; }
      for (const part of chunk((Array.isArray(ids) ? ids : []).filter(Boolean), ID_CHUNK)) check(await unread().in('id', part));
    },
    async deleteNotification(id) { check(await client.from('notifications').delete().eq('id', id)); }
  };
}
