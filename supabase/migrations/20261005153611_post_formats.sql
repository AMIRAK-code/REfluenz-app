-- Post formats: text, image (gallery) and video entries.
--
-- Storage layout
--   entry-media (private): <creator_id>/<entry_id>/<file>   originals, video posters
--   previews    (public):  <creator_id>/<entry_id>/<file>   ~32px blurred teasers
-- Full media is readable only by people who can read the entry (same rule as
-- entry_bodies). The tiny preview is public so locked cards can hint at the image.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app_private.try_uuid(t text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

create or replace function app_private.owns_entry(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.entries en join public.creators c on c.id = en.creator_id
    where en.id = e and c.owner_id = (select auth.uid()));
$$;

create or replace function app_private.entry_media_prefix(e uuid) returns text
language sql stable security definer set search_path = '' as $$
  select creator_id::text || '/' || id::text || '/' from public.entries where id = e;
$$;

revoke execute on function app_private.try_uuid(text) from public;
revoke execute on function app_private.owns_entry(uuid) from public;
revoke execute on function app_private.entry_media_prefix(uuid) from public;
grant execute on function app_private.try_uuid(text) to authenticated;
grant execute on function app_private.owns_entry(uuid) to authenticated;
grant execute on function app_private.entry_media_prefix(uuid) to authenticated;

-- Canonical object names only: <creator uuid>/<entry uuid>/<file>, lowercase uuids,
-- a simple file name. Keeps prefix checks, cleanup and quotas exact and stops
-- '..', quotes, '?' or '#' from reaching public URLs.
create or replace function app_private.media_name_ok(n text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(n ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$', false);
$$;
revoke execute on function app_private.media_name_ok(text) from public;
grant execute on function app_private.media_name_ok(text) to authenticated, service_role;

-- Storage ceiling: at most 60 objects per entry and 500 MB of originals per
-- creator. SECURITY DEFINER so it also sees objects whose entry row is gone.
-- (Measured over stored objects; parallel uploads can overshoot slightly.)
create or replace function app_private.upload_allowed(c uuid, e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    (select count(*) from storage.objects o
       where o.bucket_id in ('entry-media','previews') and o.name like c::text || '/' || e::text || '/%') < 60
    and
    (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o
       where o.bucket_id = 'entry-media' and o.name like c::text || '/%') < 524288000;
$$;
revoke execute on function app_private.upload_allowed(uuid, uuid) from public;
grant execute on function app_private.upload_allowed(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Entries: kind + public card metadata
-- ---------------------------------------------------------------------------
alter table public.entries
  add column kind text not null default 'text' check (kind in ('text','image','video')),
  add column media_count integer not null default 0 check (media_count >= 0),
  add column preview_path text check (preview_path is null or char_length(preview_path) <= 300),
  add column duration_seconds integer check (duration_seconds is null or duration_seconds >= 0);
alter table public.entries add constraint entries_preview_path_format
  check (preview_path is null or app_private.media_name_ok(preview_path));

alter table public.entries drop constraint entries_format_check;
alter table public.entries add constraint entries_format_check check (format in
  ('Essay','Guide','Studio note','Field note','Collection','Gallery','Film','Update'));

-- Captions on image/video entries may be empty; text entries keep the 30-char
-- minimum, enforced in save_entry.
alter table public.entry_bodies drop constraint entry_bodies_body_check;
alter table public.entry_bodies add constraint entry_bodies_body_check check (char_length(body) <= 20000);

-- Entries and bodies are only written through save_entry.
revoke insert, update on public.entries from anon, authenticated;
revoke insert, update, delete on public.entry_bodies from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Entry media
-- ---------------------------------------------------------------------------
create table public.entry_media (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  kind text not null check (kind in ('image','video')),
  path text not null unique check (char_length(path) <= 300),
  poster_path text check (poster_path is null or char_length(poster_path) <= 300),
  preview_path text check (preview_path is null or char_length(preview_path) <= 300),
  mime text not null check (mime in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime')),
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  width integer check (width is null or width between 1 and 20000),
  height integer check (height is null or height between 1 and 20000),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  alt text not null default '' check (char_length(alt) <= 200),
  position integer not null default 0 check (position between 0 and 99),
  created_at timestamptz not null default now(),
  check ((kind = 'image') = (mime like 'image/%')),
  constraint entry_media_path_format check (app_private.media_name_ok(path)),
  constraint entry_media_poster_format check (poster_path is null or app_private.media_name_ok(poster_path)),
  constraint entry_media_preview_format check (preview_path is null or app_private.media_name_ok(preview_path))
);
create index entry_media_entry_idx on public.entry_media (entry_id, position);

alter table public.entry_media enable row level security;
create policy "media by access" on public.entry_media for select to authenticated
  using ((select app_private.can_read_entry(entry_id)));
create policy "owner adds media" on public.entry_media for insert to authenticated with check (
  (select app_private.owns_entry(entry_id))
  and path like (select app_private.entry_media_prefix(entry_id)) || '%'
  and (poster_path is null or poster_path like (select app_private.entry_media_prefix(entry_id)) || '%')
  and (preview_path is null or preview_path like (select app_private.entry_media_prefix(entry_id)) || '%'));
create policy "owner edits media" on public.entry_media for update to authenticated
  using ((select app_private.owns_entry(entry_id))) with check ((select app_private.owns_entry(entry_id)));
create policy "owner removes media" on public.entry_media for delete to authenticated
  using ((select app_private.owns_entry(entry_id)));

revoke insert, update, delete on public.entry_media from anon, authenticated;
revoke select on public.entry_media from anon;
grant insert (entry_id, kind, path, poster_path, preview_path, mime, size_bytes, width, height, duration_seconds, alt, position)
  on public.entry_media to authenticated;
grant update (alt, position) on public.entry_media to authenticated;
grant delete on public.entry_media to authenticated;

-- Insert guard. The final shape (1-10 images, or exactly one video, never
-- mixed) is enforced by save_entry at publish. Here we only cap transient
-- headroom so the editor can upload new media before removing old media
-- (replace a video, swap images at the cap, switch kind) without ever leaving
-- a published entry empty.
create or replace function app_private.before_entry_media() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n_images int; n_videos int;
begin
  -- Not the owner: let RLS reject it with the generic error (no count oracle, no lock).
  if (select auth.uid()) is not null and not app_private.owns_entry(new.entry_id) then
    return new;
  end if;
  -- Serialise concurrent inserts for one entry so the counts are exact.
  perform 1 from public.entries where id = new.entry_id for update;
  select count(*) filter (where kind = 'image'), count(*) filter (where kind = 'video')
    into n_images, n_videos from public.entry_media where entry_id = new.entry_id;
  if new.kind = 'video' and n_videos >= 2 then
    raise exception 'Remove the previous video before adding another.' using errcode = 'P0001';
  end if;
  if new.kind = 'image' and n_images >= 20 then
    raise exception 'Remove some images before adding more.' using errcode = 'P0001';
  end if;
  new.created_at := now();
  return new;
end $$;
create trigger entry_media_before before insert on public.entry_media
  for each row execute function app_private.before_entry_media();

-- Keep public card metadata in step with the media rows, whoever writes them.
-- A published image/video entry that loses all its media goes back to draft.
create or replace function app_private.sync_entry_media() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  e uuid := coalesce(new.entry_id, old.entry_id);
  n int;
begin
  select count(*) into n from public.entry_media where entry_id = e;
  update public.entries en set
    media_count = n,
    preview_path = case when en.kind = 'text' then null
      else (select m.preview_path from public.entry_media m where m.entry_id = e order by m.position, m.created_at limit 1) end,
    duration_seconds = case when en.kind = 'video'
      then (select m.duration_seconds from public.entry_media m where m.entry_id = e and m.kind = 'video' order by m.created_at desc limit 1) end,
    status = case when n = 0 and en.kind in ('image','video') and en.status = 'published' then 'draft' else en.status end
  where en.id = e;
  return null;
end $$;
create trigger entry_media_sync after insert or delete or update of position on public.entry_media
  for each row execute function app_private.sync_entry_media();

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('entry-media', 'entry-media', false, 52428800,
    array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']),
  ('previews', 'previews', true, 262144, array['image/webp','image/jpeg'])
on conflict (id) do nothing;

create policy "entry-media: read by access" on storage.objects for select to authenticated
  using (bucket_id = 'entry-media'
    and app_private.can_read_entry(app_private.try_uuid((storage.foldername(name))[2])));
-- Owners can always see and remove everything in their own creator folder, even
-- after the entry row is gone (cleanup after delete). Object names always start
-- with the owning creator's id, so authorising by that folder alone is safe.
create policy "entry-media: owner reads folder" on storage.objects for select to authenticated
  using (bucket_id = 'entry-media'
    and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1])));
create policy "entry-media: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'entry-media'
    and app_private.media_name_ok(name)
    and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1]))
    and app_private.owns_entry(app_private.try_uuid((storage.foldername(name))[2]))
    and app_private.upload_allowed(app_private.try_uuid((storage.foldername(name))[1]), app_private.try_uuid((storage.foldername(name))[2])));
create policy "entry-media: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'entry-media'
    and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1])));

create policy "previews: owner reads" on storage.objects for select to authenticated
  using (bucket_id = 'previews'
    and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1])));
create policy "previews: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'previews'
    and app_private.media_name_ok(name)
    and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1]))
    and app_private.owns_entry(app_private.try_uuid((storage.foldername(name))[2]))
    and app_private.upload_allowed(app_private.try_uuid((storage.foldername(name))[1]), app_private.try_uuid((storage.foldername(name))[2])));
create policy "previews: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'previews'
    and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------------
-- save_entry v2: kind-aware validation and card metadata
-- ---------------------------------------------------------------------------
drop function public.save_entry(uuid,text,text,text,text,text,text,text,text);

create function public.save_entry(
  p_id uuid, p_title text, p_subtitle text, p_body text, p_category text,
  p_format text, p_image text, p_access text, p_status text, p_kind text default 'text'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_creator uuid;
  v_id uuid := p_id;
  v_body text := trim(coalesce(p_body, ''));
  v_kind text := coalesce(p_kind, 'text');
  v_existing public.entries;
  n_images int := 0; n_videos int := 0;
  v_preview text; v_duration int; v_minutes int;
begin
  select id into v_creator from public.creators where owner_id = (select auth.uid());
  if v_creator is null then raise exception 'Open your atelier before writing an entry.' using errcode = 'P0001'; end if;
  if v_kind not in ('text','image','video') then raise exception 'Choose a post type.' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 3 and 100 then raise exception 'Use a title between 3 and 100 characters.' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_subtitle, '')) > 180 then raise exception 'Keep the introduction under 180 characters.' using errcode = 'P0001'; end if;
  if v_kind = 'text' and char_length(v_body) not between 30 and 20000 then
    raise exception 'Write between 30 and 20,000 characters for your entry.' using errcode = 'P0001';
  end if;
  if char_length(v_body) > 20000 then raise exception 'Keep the caption under 20,000 characters.' using errcode = 'P0001'; end if;
  if p_status not in ('draft','published') then raise exception 'Invalid status.' using errcode = 'P0001'; end if;

  if v_id is not null then
    select * into v_existing from public.entries where id = v_id;
    if v_existing.id is null or v_existing.creator_id <> v_creator then
      raise exception 'You can only edit your own entries.' using errcode = 'P0001';
    end if;
    select count(*) filter (where kind = 'image'), count(*) filter (where kind = 'video')
      into n_images, n_videos from public.entry_media where entry_id = v_id;
    select preview_path into v_preview from public.entry_media where entry_id = v_id order by position, created_at limit 1;
    select duration_seconds into v_duration from public.entry_media where entry_id = v_id and kind = 'video' order by created_at desc limit 1;
  end if;

  if p_status = 'published' then
    if v_kind = 'image' and (n_images < 1 or n_videos > 0) then
      raise exception 'Add at least one image before publishing.' using errcode = 'P0001';
    end if;
    if v_kind = 'image' and n_images > 10 then
      raise exception 'An image entry holds up to 10 images. Remove some before publishing.' using errcode = 'P0001';
    end if;
    if v_kind = 'video' and (n_videos = 0 or n_images > 0) then
      raise exception 'Add a video before publishing.' using errcode = 'P0001';
    end if;
    if v_kind = 'video' and n_videos > 1 then
      raise exception 'Remove the extra video before publishing.' using errcode = 'P0001';
    end if;
    if v_kind = 'text' and (n_images + n_videos) > 0 then
      raise exception 'Remove the attached media or switch the post type.' using errcode = 'P0001';
    end if;
  end if;

  v_minutes := case v_kind
    when 'video' then greatest(1, ceil(coalesce(v_duration, 0) / 60.0)::int)
    when 'image' then greatest(1, ceil(coalesce(array_length(regexp_split_to_array(nullif(v_body, ''), '\s+'), 1), 0) / 200.0)::int)
    else greatest(1, ceil(array_length(regexp_split_to_array(v_body, '\s+'), 1) / 200.0)::int)
  end;

  if v_id is not null then
    update public.entries set
      title = trim(p_title), subtitle = trim(coalesce(p_subtitle, '')), category = p_category,
      format = coalesce(p_format, 'Essay'), image = p_image, access = p_access, status = p_status, kind = v_kind,
      excerpt = left(split_part(v_body, E'\n\n', 1), 600),
      minutes = v_minutes,
      media_count = n_images + n_videos,
      preview_path = case when v_kind = 'text' then null else v_preview end,
      duration_seconds = case when v_kind = 'video' then v_duration end,
      published_at = case when p_status = 'published' then coalesce(v_existing.published_at, now()) else v_existing.published_at end,
      updated_at = now()
    where id = v_id;
    update public.entry_bodies set body = v_body where entry_id = v_id;
  else
    insert into public.entries (creator_id, title, subtitle, category, format, image, access, status, kind, excerpt, minutes, published_at)
    values (v_creator, trim(p_title), trim(coalesce(p_subtitle, '')), p_category, coalesce(p_format, 'Essay'), p_image, p_access, p_status, v_kind,
      left(split_part(v_body, E'\n\n', 1), 600), v_minutes,
      case when p_status = 'published' then now() end)
    returning id into v_id;
    insert into public.entry_bodies (entry_id, body) values (v_id, v_body);
  end if;
  return v_id;
end $$;

revoke execute on function public.save_entry(uuid,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.save_entry(uuid,text,text,text,text,text,text,text,text,text) to authenticated;
