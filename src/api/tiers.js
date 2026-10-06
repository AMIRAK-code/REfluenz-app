// A creator's three membership tiers: the shared ladder (essential < premium < signature) with the creator's own name, price and perks.
import { TIER_COLUMNS, TIER_IDS, check, cleanTier, isUuid, isoTime } from './util.js';

const COLUMN = {name: 'name', priceCents: 'price_cents', currency: 'currency', description: 'description', perks: 'perks', enabled: 'enabled'};

export function createTiers(ctx) {
  const {client, map} = ctx;

  return {
    async listTiers(creatorId) {
      if (!isUuid(creatorId)) return [];
      return map.tiers(check(await client.from('creator_tiers').select(TIER_COLUMNS).eq('creator_id', String(creatorId).toLowerCase())));
    },

    // The database refuses to close the last open tier ("Keep at least one membership tier open.") and says so in plain words.
    async updateTier(creatorId, tierId, values = {}) {
      if (!isUuid(creatorId)) throw Error('That atelier could not be found.');
      if (!TIER_IDS.includes(tierId)) throw Error('Choose Essential, Premium or Signature.');
      const patch = {updated_at: isoTime(ctx.now())};
      for (const [key, value] of Object.entries(cleanTier(values))) patch[COLUMN[key]] = value;
      const row = check(await client.from('creator_tiers').update(patch).eq('creator_id', String(creatorId).toLowerCase()).eq('tier_id', tierId).select(TIER_COLUMNS).single());
      return map.tier(row);
    }
  };
}
