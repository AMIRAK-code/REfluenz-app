// Deletes the calling person's account and everything that belongs to it.
//
//   POST /functions/v1/delete-account   Authorization: Bearer <the person's access token>
//
// The token is verified with auth.getUser, so only the owner of the account can delete it. The service role then:
//   1. lists the files of the person's atelier (entry-media, previews, covers: <creator_id>/...) and their avatar (avatars: <user_id>/...),
//   2. removes those files,
//   3. deletes the atelier row (entries, media rows, notes, memberships and notifications cascade),
//   4. deletes the user (profile, settings, follows, likes, comments and messages cascade).
// The atelier has to go explicitly: creators.owner_id is "on delete set null", so deleting only the user would leave the atelier published.
// Files go first so a failure part way leaves the atelier in place and a retry finds everything again; every step can be repeated.
//
// Deploy with verify_jwt disabled: the project's publishable key is not a JWT, and the function does its own verification.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CREATOR_BUCKETS = ['entry-media', 'previews', 'covers'];
const AVATAR_BUCKET = 'avatars';
const PAGE = 100;

const ORIGINS = [/^https:\/\/refluenz\.com$/, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Max-Age': '86400' };
  if (origin && ORIGINS.some(pattern => pattern.test(origin))) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function reply(status: number, body: Record<string, unknown>, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// Every file under a folder, at any depth. Folders come back from list() without an id.
// deno-lint-ignore no-explicit-any
async function listFiles(admin: any, bucket: string, folder: string): Promise<string[]> {
  const files: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    for (const item of data ?? []) {
      if (item.id === null) files.push(...await listFiles(admin, bucket, `${folder}/${item.name}`));
      else files.push(`${folder}/${item.name}`);
    }
    if (!data || data.length < PAGE) return files;
  }
}

// deno-lint-ignore no-explicit-any
async function removeFiles(admin: any, bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + PAGE));
    if (error) throw error;
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST to delete an account.' }, origin);

  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) return reply(401, { error: 'Sign in again to delete your account.' }, origin);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: auth, error: authError } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (authError || !user) return reply(401, { error: 'Sign in again to delete your account.' }, origin);

  try {
    const { data: creator, error: lookupError } = await admin.from('creators').select('id').eq('owner_id', user.id).maybeSingle();
    if (lookupError) throw lookupError;

    if (creator) {
      for (const bucket of CREATOR_BUCKETS) await removeFiles(admin, bucket, await listFiles(admin, bucket, creator.id));
      const { error } = await admin.from('creators').delete().eq('id', creator.id);
      if (error) throw error;
    }
    await removeFiles(admin, AVATAR_BUCKET, await listFiles(admin, AVATAR_BUCKET, user.id));

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;
  } catch (error) {
    console.error('delete-account failed', user.id, error);
    return reply(500, { error: 'Your account could not be deleted. Try again in a moment.' }, origin);
  }
  return reply(200, { ok: true }, origin);
});
