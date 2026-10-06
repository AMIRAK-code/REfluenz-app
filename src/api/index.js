// The data layer: createApi(client, options) returns ONE flat object with every method of docs/ARCHITECTURE.md section 6.
// Each module gets the same context; the few things modules share beyond it (the circle lookup and the media cleanup) are passed explicitly.
//
// Options (all optional): url and key of the Supabase project, XHR (constructor used for uploads, injected by tests),
// now (clock of the signed URL cache), uuid (random part of object names), stallMs (an upload that makes no progress for this long is
// given up) and fetch (used by deleteAccount).
import { createContext } from './util.js';
import { createAuth } from './auth.js';
import { createViewer } from './viewer.js';
import { createCreators } from './creators.js';
import { createTiers } from './tiers.js';
import { createEntries } from './entries.js';
import { createMedia } from './media.js';
import { createSocial } from './social.js';
import { createMemberships, createCircle } from './memberships.js';
import { createMessages } from './messages.js';
import { createNotifications } from './notifications.js';
import { createSearch } from './search.js';
import { createReports } from './reports.js';
import { createAccount } from './account.js';
import { createRealtime } from './realtime.js';

export function createApi(client, options = {}) {
  const ctx = createContext(client, options);
  const circle = createCircle(ctx);
  const {purge, ...media} = createMedia(ctx);

  const parts = [
    createAuth(ctx), createViewer(ctx), createCreators(ctx, {circle}), createTiers(ctx), createEntries(ctx, {purge, circle}), media,
    createSocial(ctx, {circle}), createMemberships(ctx, {circle}), createMessages(ctx), createNotifications(ctx), createSearch(ctx),
    createReports(ctx), createAccount(ctx), createRealtime(ctx)
  ];
  const api = {};
  for (const part of parts) {
    for (const [name, method] of Object.entries(part)) {
      if (name in api) throw Error(`Two api modules define ${name}.`);
      api[name] = method;
    }
  }
  return api;
}
