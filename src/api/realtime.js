// Live updates for the signed-in person: new notifications addressed to them, and new messages in their threads.
import { isUuid } from './util.js';
import { NOTIFICATION_COLUMNS } from './notifications.js';

export function createRealtime(ctx) {
  const {client, map} = ctx;

  // The realtime payload is a bare row. Notifications are read once more with their actor, atelier and post, so they have the same shape as
  // the list; when that read fails the bare row is still delivered.
  async function fullNotification(row) {
    try {
      const {data} = await client.from('notifications').select(NOTIFICATION_COLUMNS).eq('id', row.id).single();
      if (data) return map.notification(data);
    } catch { /* fall back to the bare row */ }
    return map.notification(row);
  }

  return {
    // Messages arrive for every thread the person can read, including ones they sent from another tab: compare `from` and `memberId` with
    // the viewer to tell. Returns a function that stops listening.
    subscribe(userId, {onNotification, onMessage} = {}) {
      if (!isUuid(userId)) throw Error('Sign in to receive updates.');
      const channel = client.channel(`atelier-live-${userId}`)
        .on('postgres_changes', {event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}`}, async payload => onNotification?.(await fullNotification(payload.new)))
        .on('postgres_changes', {event: 'INSERT', schema: 'public', table: 'messages'}, payload => onMessage?.(map.message(payload.new)))
        .subscribe();
      return () => { client.removeChannel(channel); };
    }
  };
}
