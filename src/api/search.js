// Search over ateliers and published posts (the search_creators / search_entries database functions rank prefix matches).
import { CREATOR_COLUMNS, ENTRY_COLUMNS, check, unique } from './util.js';

const CREATOR_RESULTS = 6;
const ENTRY_RESULTS = 8;
const MAX_QUERY = 100;

export function createSearch(ctx) {
  const {client, map} = ctx;

  return {
    async search(query) {
      const q = String(query ?? '').trim().slice(0, MAX_QUERY);
      if (!q) return {creators: [], entries: []};
      const [creators, entries] = await Promise.all([
        client.rpc('search_creators', {q, lim: CREATOR_RESULTS}).select(CREATOR_COLUMNS).then(check),
        client.rpc('search_entries', {q, lim: ENTRY_RESULTS, off: 0}).select(ENTRY_COLUMNS).then(check)
      ]);
      // Entry cards show their author: one extra read for the authors that were not already found as creators.
      const authors = Object.fromEntries((creators || []).map(c => [c.id, c]));
      const missing = unique((entries || []).map(e => e.creator_id)).filter(id => !authors[id]);
      if (missing.length) for (const row of check(await client.from('creators').select(CREATOR_COLUMNS).in('id', missing))) authors[row.id] = row;
      return {creators: (creators || []).map(map.creator), entries: (entries || []).map(e => map.entry({...e, creator: authors[e.creator_id]}))};
    }
  };
}
