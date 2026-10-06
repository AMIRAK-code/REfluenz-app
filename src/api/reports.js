// Reports of posts, comments, ateliers and messages. They land in a moderation queue that only staff can read.
import { check, cleanReport } from './util.js';

export function createReports(ctx) {
  const {client} = ctx;

  return {
    // reason: spam | harassment | nudity | violence | copyright | other
    async report(values) {
      const {targetType, targetId, reason, details} = cleanReport(values);
      await ctx.requireUserId();
      check(await client.from('reports').insert({target_type: targetType, target_id: targetId, reason, details}));
    }
  };
}
