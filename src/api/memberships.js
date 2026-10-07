// Joining and leaving circles (membership in a creator's atelier), the creator's member list and their statistics.
import { MEMBERSHIP_COLUMNS, TIER_COLUMNS, PERSON_COLUMNS, TIER_IDS, check, fetchAll, unique } from './util.js';

const MEMBERS_LIMIT = 500;

// The creators a person follows or belongs to. Feeds read it on every call, so it is fetched once per account
// and forgotten whenever a follow or membership changes.
export function createCircle(ctx) {
  const {client} = ctx;
  let pending = null;

  const column = (table, userId) => fetchAll((from, to) => client.from(table).select('creator_id').eq('user_id', userId).order('created_at', {ascending: false}).range(from, to));
  async function load() {
    const userId = await ctx.getUserId();
    if (!userId) return [];
    const [follows, members] = await Promise.all([column('follows', userId), column('memberships', userId)]);
    return unique([...follows, ...members].map(row => row.creator_id));
  }

  ctx.onAccountChange(() => { pending = null; });
  return {
    ids() {
      if (!pending) {
        const request = pending = load();
        request.catch(() => { if (pending === request) pending = null; });   // a failed lookup is retried on the next call
      }
      return pending;
    },
    forget() { pending = null; }
  };
}

export function createMemberships(ctx, {circle}) {
  const {client, map} = ctx;

  return {
    // Joining is free during early access. Joining again at another tier changes the tier.
    async join(creatorId, tierId) {
      if (!TIER_IDS.includes(tierId)) throw Error('Choose Essential, Premium or Signature.');
      const userId = await ctx.requireUserId();
      const row = check(await client.from('memberships').upsert({user_id: userId, creator_id: creatorId, tier: tierId}, {onConflict: 'user_id,creator_id'}).select(MEMBERSHIP_COLUMNS).single());
      circle.forget();
      return map.membership(row);
    },
    async leave(creatorId) {
      const userId = await ctx.requireUserId();
      check(await client.from('memberships').delete().match({user_id: userId, creator_id: creatorId}));
      circle.forget();
    },
    async myMemberships() {
      const userId = await ctx.requireUserId();
      const rows = await fetchAll((from, to) => client.from('memberships').select(MEMBERSHIP_COLUMNS).eq('user_id', userId).order('created_at', {ascending: false}).range(from, to));
      return rows.map(map.membership);
    },

    // The people in a creator's circle, newest first (row level security lets only the owner read them).
    async circleMembers(creatorId) {
      const [rows, tiers] = await Promise.all([
        client.from('memberships').select(`user_id,tier,created_at,member:profiles!user_id(${PERSON_COLUMNS})`).eq('creator_id', creatorId).order('created_at', {ascending: false}).limit(MEMBERS_LIMIT).then(check),
        client.from('creator_tiers').select(TIER_COLUMNS).eq('creator_id', creatorId).then(check)
      ]);
      const byId = Object.fromEntries(map.tiers(tiers).map(tier => [tier.id, tier]));
      return rows.map(row => ({member: map.person(row.member, row.user_id), tier: byId[row.tier] ?? map.tier({tier_id: row.tier, creator_id: creatorId, name: row.tier, price_cents: 0}), joinedAt: row.created_at}));
    },
    async creatorStats(creatorId) {
      return map.stats(check(await client.rpc('creator_stats', {p_creator: creatorId})) || {});
    }
  };
}
