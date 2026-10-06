// The signed-in person: profile, settings, their atelier and everything the store needs after sign-in.
import { AVATAR_BUCKET, PROFILE_COLUMNS, SETTINGS_COLUMNS, CREATOR_COLUMNS, MEMBERSHIP_COLUMNS, check, fetchAll, cleanProfile, putImage, isoTime } from './util.js';

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;   // the limit of the avatars bucket

export function createViewer(ctx) {
  const {client, map} = ctx;

  const ids = (userId, table, column) => fetchAll((from, to) => client.from(table).select(column).eq('user_id', userId).order('created_at', {ascending: false}).range(from, to))
    .then(rows => rows.map(row => row[column]));

  async function updateProfile(userId, patch) {
    return map.profile(check(await client.from('profiles').update({...patch, updated_at: isoTime(ctx.now())}).eq('id', userId).select(PROFILE_COLUMNS).single()));
  }
  async function currentAvatarPath(userId) {
    return check(await client.from('profiles').select('avatar_path').eq('id', userId).single()).avatar_path ?? null;
  }
  // Orphaned files are harmless, so a failed removal is ignored.
  const removeAvatarFile = async path => { if (path) try { await client.storage.from(AVATAR_BUCKET).remove([path]); } catch { /* best effort */ } };

  return {
    // One round of parallel reads: the store keeps the result as its state.
    async loadViewer() {
      const userId = await ctx.requireUserId();
      const [profile, settings, creator, tiers, following, saved, liked, memberships] = await Promise.all([
        client.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single().then(check),
        client.from('user_settings').select(SETTINGS_COLUMNS).eq('user_id', userId).maybeSingle().then(check),
        client.from('creators').select(CREATOR_COLUMNS).eq('owner_id', userId).maybeSingle().then(check),
        client.from('tiers').select('id,level,name').order('level').then(check),
        ids(userId, 'follows', 'creator_id'),
        ids(userId, 'bookmarks', 'entry_id'),
        ids(userId, 'likes', 'entry_id'),
        fetchAll((from, to) => client.from('memberships').select(MEMBERSHIP_COLUMNS).eq('user_id', userId).order('created_at', {ascending: false}).range(from, to))
      ]);
      return {
        profile: map.profile(profile),
        settings: map.settings(settings),
        myCreator: creator ? map.creator(creator) : null,
        tiers: (tiers || []).map(t => ({id: t.id, level: t.level, name: t.name})),
        following, saved, liked,
        memberships: memberships.map(map.membership)
      };
    },

    async saveProfile(values) {
      const userId = await ctx.requireUserId();
      const clean = cleanProfile(values);
      const patch = {};
      if (clean.name !== undefined) patch.display_name = clean.name;
      if (clean.bio !== undefined) patch.bio = clean.bio;
      if (clean.website !== undefined) patch.website = clean.website;
      return updateProfile(userId, patch);
    },

    // Only the keys given are written. notifyPrefs is merged into the stored preferences so one switch never resets the others.
    async saveSettings(partial = {}) {
      const userId = await ctx.requireUserId();
      const patch = {updated_at: isoTime(ctx.now())};
      if (partial.compact !== undefined) patch.compact = Boolean(partial.compact);
      if (partial.welcomeDismissed !== undefined) patch.welcome_dismissed = Boolean(partial.welcomeDismissed);
      if (partial.onboarded !== undefined) patch.onboarded = Boolean(partial.onboarded);
      if (partial.notifyPrefs !== undefined) {
        const current = check(await client.from('user_settings').select('notify_prefs').eq('user_id', userId).single());
        patch.notify_prefs = {...map.settings(current).notifyPrefs, ...partial.notifyPrefs};
      }
      return map.settings(check(await client.from('user_settings').update(patch).eq('user_id', userId).select(SETTINGS_COLUMNS).single()));
    },

    async uploadAvatar(blob) {
      const userId = await ctx.requireUserId();
      const previous = await currentAvatarPath(userId);
      const path = await putImage(client, AVATAR_BUCKET, userId, blob, {uuid: ctx.uuid, types: AVATAR_TYPES, maxBytes: AVATAR_MAX_BYTES});
      try {
        const profile = await updateProfile(userId, {avatar_path: path});
        await removeAvatarFile(previous);
        return profile;
      } catch (error) {
        await removeAvatarFile(path);
        throw error;
      }
    },

    async removeAvatar() {
      const userId = await ctx.requireUserId();
      const previous = await currentAvatarPath(userId);
      const profile = await updateProfile(userId, {avatar_path: null});
      await removeAvatarFile(previous);
      return profile;
    }
  };
}
