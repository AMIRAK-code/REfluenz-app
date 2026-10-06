-- REFLUENZ production schema v2
-- Per-creator tiers, text / image / video posts with uploads (storage),
-- comments, notifications, search, counters, read analytics, inbox,
-- reports and rate limits. All client writes stay behind RLS; derived
-- columns are not client-writable.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 0. Private helpers
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

create or replace function app_private.entry_published(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.entries where id = e and status = 'published');
$$;

create or replace function app_private.creator_has_owner(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.creators where id = c and owner_id is not null);
$$;

-- Throttle: raise when the current user inserted at least p_max rows into
-- p_table within p_window. Called from BEFORE INSERT triggers.
create or replace function app_private.enforce_rate(p_table text, p_col text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  if (select auth.uid()) is null then return; end if;
  execute format('select count(*) from public.%I where %I = $1 and created_at > now() - $2', p_table, p_col)
    into n using (select auth.uid()), p_window;
  if n >= p_max then
    raise exception 'You are doing that too often. Please wait a moment and try again.' using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Wider vocabularies
-- ---------------------------------------------------------------------------
alter table public.creators drop constraint creators_category_check;
alter table public.creators add constraint creators_category_check check (category in
  ('Style','Beauty','Design','Culture','Art','Music','Writing','Photography','Wellness','Food','Education','Technology'));
alter table public.entries drop constraint entries_category_check;
alter table public.entries add constraint entries_category_check check (category in
  ('Style','Beauty','Design','Culture','Art','Music','Writing','Photography','Wellness','Food','Education','Technology'));
alter table public.entries drop constraint entries_format_check;
alter table public.entries add constraint entries_format_check check (format in
  ('Essay','Guide','Studio note','Field note','Collection','Gallery','Update'));

-- ---------------------------------------------------------------------------
-- 2. Profiles (public) + user_settings (private)
-- ---------------------------------------------------------------------------
create table public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  compact boolean not null default false,
  welcome_dismissed boolean not null default false,
  onboarded boolean not null default false,
  notify_prefs jsonb not null default '{"new_entry":true,"comment":true,"reply":true,"like":true,"follow":true,"membership":true,"message":true,"note":true}'::jsonb
    check (jsonb_typeof(notify_prefs) = 'object'),
  updated_at timestamptz not null default now()
);
insert into public.user_settings (user_id, compact, welcome_dismissed)
  select id, compact, welcome_dismissed from public.profiles;

alter table public.profiles
  drop column compact,
  drop column welcome_dismissed,
  add column avatar_path text check (avatar_path is null or char_length(avatar_path) <= 300),
  add column website text not null default '' check (char_length(website) <= 200),
  add column updated_at timestamptz not null default now();

drop policy "profiles readable by members" on public.profiles;
create policy "profiles are public" on public.profiles for select to anon, authenticated using (true);
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name, bio, avatar_path, website, updated_at) on public.profiles to authenticated;

alter table public.user_settings enable row level security;
create policy "own settings" on public.user_settings for select to authenticated using (user_id = (select auth.uid()));
create policy "update own settings" on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, update, delete on public.user_settings from anon, authenticated;
revoke select on public.user_settings from anon;
grant update (compact, welcome_dismissed, onboarded, notify_prefs, updated_at) on public.user_settings to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1), 'Member'), 60));
  insert into public.user_settings (user_id) values (new.id);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Creators
-- ---------------------------------------------------------------------------
alter table public.creators
  add column avatar_path text check (avatar_path is null or char_length(avatar_path) <= 300),
  add column cover_path text check (cover_path is null or char_length(cover_path) <= 300),
  add column links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 5),
  add column is_showcase boolean not null default false,
  add column follower_count integer not null default 0,
  add column member_count integer not null default 0,
  add column entry_count integer not null default 0,
  add column updated_at timestamptz not null default now(),
  add column search tsvector generated always as (to_tsvector('simple'::regconfig,
    coalesce(name,'') || ' ' || coalesce(descriptor,'') || ' ' || coalesce(location,'') || ' ' || coalesce(category,'') || ' ' || coalesce(bio,''))) stored;
create index creators_search_idx on public.creators using gin (search);
create index creators_name_trgm_idx on public.creators using gin (name extensions.gin_trgm_ops);
create index creators_popular_idx on public.creators (follower_count desc);
update public.creators set is_showcase = true where owner_id is null;

revoke insert, update, delete on public.creators from anon, authenticated;
grant insert (owner_id, slug, name, category, descriptor, location, image, bio, avatar_path, cover_path, links) on public.creators to authenticated;
grant update (slug, name, category, descriptor, location, image, bio, avatar_path, cover_path, links, updated_at) on public.creators to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Per-creator tiers
-- ---------------------------------------------------------------------------
create table public.creator_tiers (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  price_cents integer not null check (price_cents between 0 and 100000),
  currency text not null default 'EUR' check (currency in ('EUR','USD','GBP')),
  description text not null default '' check (char_length(description) <= 280),
  perks text[] not null default '{}' check (cardinality(perks) <= 8),
  rank integer not null check (rank between 1 and 10),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (creator_id, rank),
  unique (id, creator_id)
);
alter table public.creator_tiers enable row level security;
create policy "tiers are public" on public.creator_tiers for select to anon, authenticated using (true);
create policy "owner adds tiers" on public.creator_tiers for insert to authenticated with check ((select app_private.owns_creator(creator_id)));
create policy "owner edits tiers" on public.creator_tiers for update to authenticated
  using ((select app_private.owns_creator(creator_id))) with check ((select app_private.owns_creator(creator_id)));
create policy "owner removes tiers" on public.creator_tiers for delete to authenticated using ((select app_private.owns_creator(creator_id)));
revoke insert, update, delete on public.creator_tiers from anon, authenticated;
grant insert (creator_id, name, price_cents, currency, description, perks, rank) on public.creator_tiers to authenticated;
grant update (name, price_cents, currency, description, perks, rank, archived) on public.creator_tiers to authenticated;
grant delete on public.creator_tiers to authenticated;

insert into public.creator_tiers (creator_id, name, price_cents, description, perks, rank)
  select c.id, t.name, t.price * 100, t.description, t.features, t.level from public.creators c cross join public.tiers t;

create or replace function app_private.default_tiers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.creator_tiers (creator_id, name, price_cents, description, perks, rank) values
    (new.id, 'Essential', 900, 'A closer look at the work.', array['All member entries','The complete archive','Members’ conversation'], 1),
    (new.id, 'Premium', 1900, 'More context. More connection.', array['Everything in Essential','In-depth studio notes','Priority replies'], 2),
    (new.id, 'Signature', 3900, 'Inside the creative process.', array['Everything in Premium','Reference collections','Private workshop notes'], 3);
  return new;
end $$;
create trigger creators_default_tiers after insert on public.creators
  for each row execute function app_private.default_tiers();

-- ---------------------------------------------------------------------------
-- 5. Memberships reference a creator's own tier
-- ---------------------------------------------------------------------------
alter table public.memberships add column tier_id uuid;
update public.memberships m set tier_id = ct.id
  from public.tiers t, public.creator_tiers ct
  where t.id = m.tier and ct.creator_id = m.creator_id and ct.rank = t.level;
delete from public.memberships where tier_id is null;
alter table public.memberships alter column tier_id set not null;
alter table public.memberships drop column tier;
alter table public.memberships add constraint memberships_tier_fk
  foreign key (tier_id, creator_id) references public.creator_tiers(id, creator_id) on delete restrict;
create index memberships_tier_id_idx on public.memberships (tier_id);
drop table public.tiers;

revoke insert, update, delete on public.memberships from anon, authenticated;
grant insert (user_id, creator_id, tier_id) on public.memberships to authenticated;
grant update (tier_id, updated_at) on public.memberships to authenticated;
grant delete on public.memberships to authenticated;

create or replace function app_private.check_membership_tier() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.creator_tiers where id = new.tier_id and archived) then
    raise exception 'That membership tier is no longer available.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger memberships_check_tier before insert or update of tier_id on public.memberships
  for each row execute function app_private.check_membership_tier();

-- ---------------------------------------------------------------------------
-- 6. Entries: post kind, rank-based access, uploaded covers, tags, counters, search
-- ---------------------------------------------------------------------------
alter table public.entries
  add column kind text not null default 'text' check (kind in ('text','image','video')),
  add column min_rank integer not null default 0 check (min_rank between 0 and 10),
  add column cover_path text check (cover_path is null or char_length(cover_path) <= 300),
  add column tags text[] not null default '{}' check (cardinality(tags) <= 8),
  add column like_count integer not null default 0,
  add column comment_count integer not null default 0,
  add column read_count integer not null default 0,
  add column search tsvector generated always as (to_tsvector('simple'::regconfig,
    coalesce(title,'') || ' ' || coalesce(subtitle,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(category,''))) stored;
update public.entries set min_rank = case access when 'essential' then 1 when 'premium' then 2 when 'signature' then 3 else 0 end;
alter table public.entries drop column access;
create index entries_search_idx on public.entries using gin (search);
create index entries_title_trgm_idx on public.entries using gin (title extensions.gin_trgm_ops);
create index entries_tags_idx on public.entries using gin (tags);
create index entries_popular_idx on public.entries (status, like_count desc);
create index entries_creator_feed_idx on public.entries (creator_id, status, published_at desc);
create index entries_kind_feed_idx on public.entries (kind, status, published_at desc);

-- Image and video posts carry an optional caption instead of a 30-character minimum.
alter table public.entry_bodies drop constraint entry_bodies_body_check;
alter table public.entry_bodies add constraint entry_bodies_body_check check (char_length(body) <= 20000);

revoke insert, update on public.entries from anon, authenticated;
revoke delete on public.entries from anon;

create or replace function app_private.can_read_entry(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.entries en
    where en.id = e and (
      (en.status = 'published' and (
        en.min_rank = 0
        or exists (
          select 1 from public.memberships m
          join public.creator_tiers t on t.id = m.tier_id
          where m.user_id = (select auth.uid()) and m.creator_id = en.creator_id and t.rank >= en.min_rank)))
      or exists (select 1 from public.creators c where c.id = en.creator_id and c.owner_id = (select auth.uid()))));
$$;
grant execute on function app_private.can_read_entry(uuid) to anon, authenticated;
grant execute on function app_private.owns_entry(uuid) to anon, authenticated;
grant execute on function app_private.entry_published(uuid) to anon, authenticated;
grant execute on function app_private.creator_has_owner(uuid) to anon, authenticated;
grant execute on function app_private.try_uuid(text) to anon, authenticated;
revoke execute on function app_private.enforce_rate(text, text, int, interval) from public, anon, authenticated;

drop policy "bodies by access" on public.entry_bodies;
create policy "bodies by access" on public.entry_bodies for select to anon, authenticated
  using ((select app_private.can_read_entry(entry_id)));
revoke insert, update, delete on public.entry_bodies from anon, authenticated;

drop function public.save_entry(uuid,text,text,text,text,text,text,text,text);
create function public.save_entry(
  p_id uuid, p_kind text, p_title text, p_subtitle text, p_body text, p_category text, p_format text,
  p_image text, p_cover_path text, p_min_rank integer, p_tags text[], p_status text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_creator uuid;
  v_id uuid := p_id;
  v_body text := trim(coalesce(p_body, ''));
  v_title text := trim(coalesce(p_title, ''));
  v_existing public.entries;
  v_tags text[];
  v_kind text := coalesce(p_kind, 'text');
begin
  select id into v_creator from public.creators where owner_id = (select auth.uid());
  if v_creator is null then raise exception 'Open your atelier before writing an entry.' using errcode = 'P0001'; end if;
  if v_kind not in ('text','image','video') then raise exception 'Choose a post type.' using errcode = 'P0001'; end if;
  if char_length(v_title) not between 3 and 100 then raise exception 'Use a title between 3 and 100 characters.' using errcode = 'P0001'; end if;
  if v_kind = 'text' and char_length(v_body) not between 30 and 20000 then raise exception 'Write between 30 and 20,000 characters for your entry.' using errcode = 'P0001'; end if;
  if char_length(v_body) > 20000 then raise exception 'Keep the caption under 20,000 characters.' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_subtitle, '')) > 180 then raise exception 'Keep the introduction under 180 characters.' using errcode = 'P0001'; end if;
  if p_status not in ('draft','published') then raise exception 'Invalid status.' using errcode = 'P0001'; end if;
  if coalesce(p_min_rank, 0) < 0 or (coalesce(p_min_rank, 0) > 0 and not exists (
      select 1 from public.creator_tiers where creator_id = v_creator and rank = p_min_rank and not archived)) then
    raise exception 'Choose who can read this entry.' using errcode = 'P0001';
  end if;
  if p_cover_path is not null and p_cover_path not like v_creator::text || '/%' then
    raise exception 'Invalid cover image.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct t), '{}') into v_tags from (
    select left(lower(trim(both '# ' from x)), 30) t from unnest(coalesce(p_tags, '{}')) x
  ) s where t <> '';
  if cardinality(v_tags) > 8 then raise exception 'Use up to 8 tags.' using errcode = 'P0001'; end if;
  if v_id is null and p_status = 'published' and v_kind <> 'text' then
    raise exception 'Save the post as a draft and add media before publishing.' using errcode = 'P0001';
  end if;

  if v_id is not null then
    select * into v_existing from public.entries where id = v_id;
    if v_existing.id is null or v_existing.creator_id <> v_creator then
      raise exception 'You can only edit your own entries.' using errcode = 'P0001';
    end if;
    if p_status = 'published' and v_kind = 'image' and not exists (select 1 from public.entry_media where entry_id = v_id and kind = 'image') then
      raise exception 'Add at least one photo before publishing.' using errcode = 'P0001';
    end if;
    if p_status = 'published' and v_kind = 'video' and not exists (select 1 from public.entry_media where entry_id = v_id and kind = 'video') then
      raise exception 'Add a video before publishing.' using errcode = 'P0001';
    end if;
    update public.entries set
      kind = v_kind, title = v_title, subtitle = trim(coalesce(p_subtitle, '')), category = p_category,
      format = coalesce(p_format, 'Essay'), image = coalesce(p_image, 'atelier'), cover_path = p_cover_path,
      min_rank = coalesce(p_min_rank, 0), tags = v_tags, status = p_status,
      excerpt = left(split_part(v_body, E'\n\n', 1), 600),
      minutes = greatest(1, ceil(array_length(regexp_split_to_array(v_body, '\s+'), 1) / 200.0)::int),
      published_at = case when p_status = 'published' then coalesce(v_existing.published_at, now()) else v_existing.published_at end,
      updated_at = now()
    where id = v_id;
    update public.entry_bodies set body = v_body where entry_id = v_id;
  else
    insert into public.entries (creator_id, kind, title, subtitle, category, format, image, cover_path, min_rank, tags, status, excerpt, minutes, published_at)
    values (v_creator, v_kind, v_title, trim(coalesce(p_subtitle, '')), p_category, coalesce(p_format, 'Essay'), coalesce(p_image, 'atelier'),
      p_cover_path, coalesce(p_min_rank, 0), v_tags, p_status,
      left(split_part(v_body, E'\n\n', 1), 600),
      greatest(1, ceil(array_length(regexp_split_to_array(v_body, '\s+'), 1) / 200.0)::int),
      case when p_status = 'published' then now() end)
    returning id into v_id;
    insert into public.entry_bodies (entry_id, body) values (v_id, v_body);
  end if;
  return v_id;
end $$;
revoke execute on function public.save_entry(uuid,text,text,text,text,text,text,text,text,integer,text[],text) from public, anon;
grant execute on function public.save_entry(uuid,text,text,text,text,text,text,text,text,integer,text[],text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Entry media: photos and video (private bucket, signed URLs by access)
-- ---------------------------------------------------------------------------
create table public.entry_media (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  path text not null unique check (char_length(path) <= 300),
  kind text not null default 'image' check (kind in ('image','video')),
  mime text not null default 'image/webp' check (mime in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime')),
  poster_path text check (poster_path is null or char_length(poster_path) <= 300),
  duration_seconds numeric(8,2) check (duration_seconds is null or duration_seconds >= 0),
  alt text not null default '' check (char_length(alt) <= 200),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index entry_media_entry_idx on public.entry_media (entry_id, position);

create or replace function app_private.entry_media_prefix(e uuid) returns text
language sql stable security definer set search_path = '' as $$
  select creator_id::text || '/' || id::text || '/' from public.entries where id = e;
$$;
grant execute on function app_private.entry_media_prefix(uuid) to authenticated;

alter table public.entry_media enable row level security;
create policy "media by access" on public.entry_media for select to anon, authenticated
  using ((select app_private.can_read_entry(entry_id)));
create policy "owner adds media" on public.entry_media for insert to authenticated
  with check ((select app_private.owns_entry(entry_id)) and path like (select app_private.entry_media_prefix(entry_id)) || '%'
    and (poster_path is null or poster_path like (select app_private.entry_media_prefix(entry_id)) || '%'));
create policy "owner edits media" on public.entry_media for update to authenticated
  using ((select app_private.owns_entry(entry_id))) with check ((select app_private.owns_entry(entry_id)));
create policy "owner removes media" on public.entry_media for delete to authenticated
  using ((select app_private.owns_entry(entry_id)));
revoke insert, update, delete on public.entry_media from anon, authenticated;
grant insert (entry_id, path, kind, mime, poster_path, duration_seconds, alt, width, height, position) on public.entry_media to authenticated;
grant update (alt, position) on public.entry_media to authenticated;
grant delete on public.entry_media to authenticated;

-- At most 10 items per post, at most one video, kinds must match the file and the post.
create or replace function app_private.before_media() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.entries where id = new.entry_id;
  if (select count(*) from public.entry_media where entry_id = new.entry_id) >= 10 then
    raise exception 'A post can hold up to 10 media items.' using errcode = 'P0001';
  end if;
  if new.kind = 'video' and exists (select 1 from public.entry_media where entry_id = new.entry_id and kind = 'video') then
    raise exception 'A post can hold one video.' using errcode = 'P0001';
  end if;
  if (new.kind = 'video') <> (new.mime like 'video/%') then
    raise exception 'The file type does not match the media kind.' using errcode = 'P0001';
  end if;
  if v_kind is distinct from 'video' and new.kind = 'video' then
    raise exception 'Switch the post to Video to attach a video.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger entry_media_before before insert on public.entry_media for each row execute function app_private.before_media();

-- ---------------------------------------------------------------------------
-- 8. Storage buckets
--   avatars/<user_id>/...                    public
--   covers/<creator_id>/...                  public (creator banners, entry covers)
--   entry-media/<creator_id>/<entry_id>/...  private (photos, video, posters)
-- 50 MB per file is the Supabase free-plan ceiling.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif']),
  ('covers', 'covers', true, 10485760, array['image/jpeg','image/png','image/webp']),
  ('entry-media', 'entry-media', false, 52428800, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do nothing;

create policy "avatars: read own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "covers: read own" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1])));
create policy "covers: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1])));
create policy "covers: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'covers' and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1])));
create policy "covers: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1])));

create policy "entry-media: read by access" on storage.objects for select to anon, authenticated
  using (bucket_id = 'entry-media' and app_private.can_read_entry(app_private.try_uuid((storage.foldername(name))[2])));
create policy "entry-media: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'entry-media'
    and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1]))
    and app_private.owns_entry(app_private.try_uuid((storage.foldername(name))[2])));
create policy "entry-media: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'entry-media' and app_private.owns_entry(app_private.try_uuid((storage.foldername(name))[2])));

-- ---------------------------------------------------------------------------
-- 9. Comments (one level of replies)
-- ---------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index comments_entry_idx on public.comments (entry_id, created_at);
create index comments_author_idx on public.comments (author_id, created_at);
create index comments_parent_idx on public.comments (parent_id);

alter table public.comments enable row level security;
create policy "comments by access" on public.comments for select to anon, authenticated
  using ((select app_private.can_read_entry(entry_id)));
create policy "comment when you can read" on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and (select app_private.can_read_entry(entry_id)) and (select app_private.entry_published(entry_id)));
create policy "edit own comment" on public.comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "delete own or on own entry" on public.comments for delete to authenticated
  using (author_id = (select auth.uid()) or (select app_private.owns_entry(entry_id)));
revoke insert, update, delete on public.comments from anon, authenticated;
grant insert (entry_id, author_id, parent_id, body) on public.comments to authenticated;
grant update (body) on public.comments to authenticated;
grant delete on public.comments to authenticated;

create or replace function app_private.before_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.comments;
begin
  if tg_op = 'INSERT' then
    perform app_private.enforce_rate('comments', 'author_id', 10, interval '1 minute');
    if new.parent_id is not null then
      select * into p from public.comments where id = new.parent_id;
      if p.id is null or p.entry_id <> new.entry_id then raise exception 'Invalid reply.' using errcode = 'P0001'; end if;
      if p.parent_id is not null then new.parent_id := p.parent_id; end if; -- keep threads one level deep
    end if;
    new.created_at := now();
  else
    new.edited_at := now();
    new.entry_id := old.entry_id; new.author_id := old.author_id; new.parent_id := old.parent_id; new.created_at := old.created_at;
  end if;
  return new;
end $$;
create trigger comments_before before insert or update on public.comments
  for each row execute function app_private.before_comment();

-- ---------------------------------------------------------------------------
-- 10. Likes / bookmarks require a visible, published entry
-- ---------------------------------------------------------------------------
drop policy "like" on public.likes;
create policy "like" on public.likes for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app_private.can_read_entry(entry_id)) and (select app_private.entry_published(entry_id)));
drop policy "bookmark" on public.bookmarks;
create policy "bookmark" on public.bookmarks for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app_private.entry_published(entry_id)));
revoke update on public.likes, public.bookmarks, public.follows from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Counters (maintained by triggers only)
-- ---------------------------------------------------------------------------
create or replace function app_private.count_follows() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.creators set follower_count = (select count(*) from public.follows where creator_id = coalesce(new.creator_id, old.creator_id))
    where id = coalesce(new.creator_id, old.creator_id);
  return null;
end $$;
create trigger follows_count after insert or delete on public.follows for each row execute function app_private.count_follows();

create or replace function app_private.count_members() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.creators set member_count = (select count(*) from public.memberships where creator_id = coalesce(new.creator_id, old.creator_id))
    where id = coalesce(new.creator_id, old.creator_id);
  return null;
end $$;
create trigger memberships_count after insert or delete on public.memberships for each row execute function app_private.count_members();

create or replace function app_private.count_likes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.entries set like_count = (select count(*) from public.likes where entry_id = coalesce(new.entry_id, old.entry_id))
    where id = coalesce(new.entry_id, old.entry_id);
  return null;
end $$;
create trigger likes_count after insert or delete on public.likes for each row execute function app_private.count_likes();

create or replace function app_private.count_comments() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.entries set comment_count = (select count(*) from public.comments where entry_id = coalesce(new.entry_id, old.entry_id))
    where id = coalesce(new.entry_id, old.entry_id);
  return null;
end $$;
create trigger comments_count after insert or delete on public.comments for each row execute function app_private.count_comments();

create or replace function app_private.count_entries() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.creators set entry_count = (select count(*) from public.entries where creator_id = coalesce(new.creator_id, old.creator_id) and status = 'published')
    where id = coalesce(new.creator_id, old.creator_id);
  return null;
end $$;
create trigger entries_count after insert or delete or update of status on public.entries for each row execute function app_private.count_entries();

update public.creators c set
  follower_count = (select count(*) from public.follows f where f.creator_id = c.id),
  member_count = (select count(*) from public.memberships m where m.creator_id = c.id),
  entry_count = (select count(*) from public.entries e where e.creator_id = c.id and e.status = 'published');
update public.entries e set
  like_count = (select count(*) from public.likes l where l.entry_id = e.id);

-- ---------------------------------------------------------------------------
-- 12. Read analytics
-- ---------------------------------------------------------------------------
create table public.entry_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_id uuid not null references public.entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, entry_id)
);
create index entry_reads_entry_idx on public.entry_reads (entry_id);
alter table public.entry_reads enable row level security;
create policy "own reads" on public.entry_reads for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.entry_reads from anon, authenticated;

create function public.record_read(p_entry uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not app_private.can_read_entry(p_entry) or not app_private.entry_published(p_entry) then return; end if;
  insert into public.entry_reads (user_id, entry_id) values ((select auth.uid()), p_entry) on conflict do nothing;
  if found then update public.entries set read_count = read_count + 1 where id = p_entry; end if;
end $$;
revoke execute on function public.record_read(uuid) from public, anon;
grant execute on function public.record_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Messages: owned creators only, read receipts, inbox, rate limit
-- ---------------------------------------------------------------------------
alter table public.messages add column read_at timestamptz;
drop policy "send in thread" on public.messages;
create policy "send in thread" on public.messages for insert to authenticated with check (
  (sender = 'member' and member_id = (select auth.uid()) and not (select app_private.owns_creator(creator_id)) and (select app_private.creator_has_owner(creator_id)))
  or (sender = 'creator' and (select app_private.owns_creator(creator_id)) and app_private.member_started_thread(creator_id, member_id)));
revoke insert, update, delete on public.messages from anon, authenticated;
grant insert (creator_id, member_id, sender, body) on public.messages to authenticated;

create or replace function app_private.before_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.messages m where m.created_at > now() - interval '1 minute'
      and ((m.sender = 'member' and m.member_id = (select auth.uid()))
           or (m.sender = 'creator' and m.creator_id in (select id from public.creators where owner_id = (select auth.uid()))))) >= 20 then
    raise exception 'You are sending messages too quickly. Please wait a moment.' using errcode = 'P0001';
  end if;
  new.created_at := now(); new.read_at := null;
  return new;
end $$;
create trigger messages_before before insert on public.messages for each row execute function app_private.before_message();

create function public.mark_thread_read(p_creator uuid, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) = p_member then
    update public.messages set read_at = now() where creator_id = p_creator and member_id = p_member and sender = 'creator' and read_at is null;
  elsif app_private.owns_creator(p_creator) then
    update public.messages set read_at = now() where creator_id = p_creator and member_id = p_member and sender = 'member' and read_at is null;
  end if;
end $$;
revoke execute on function public.mark_thread_read(uuid, uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid, uuid) to authenticated;

create function public.inbox() returns table (
  creator_id uuid, member_id uuid, last_body text, last_sender text, last_at timestamptz, unread integer
)
language sql stable security invoker set search_path = '' as $$
  with t as (
    select m.creator_id, m.member_id, m.body, m.sender, m.created_at, m.read_at,
      row_number() over (partition by m.creator_id, m.member_id order by m.created_at desc) rn
    from public.messages m
  )
  select t.creator_id, t.member_id,
    max(t.body) filter (where t.rn = 1),
    max(t.sender) filter (where t.rn = 1),
    max(t.created_at),
    (count(*) filter (where t.read_at is null and (
      (t.sender = 'creator' and t.member_id = (select auth.uid()))
      or (t.sender = 'member' and t.member_id <> (select auth.uid())))))::integer
  from t group by t.creator_id, t.member_id
  order by max(t.created_at) desc;
$$;
revoke execute on function public.inbox() from public, anon;
grant execute on function public.inbox() to authenticated;

-- Circle notes: rate limit
create or replace function app_private.before_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.circle_notes where creator_id = new.creator_id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You have shared a lot of notes this hour. Please wait a little.' using errcode = 'P0001';
  end if;
  new.created_at := now();
  return new;
end $$;
create trigger circle_notes_before before insert on public.circle_notes for each row execute function app_private.before_note();
revoke insert, update, delete on public.circle_notes from anon, authenticated;
grant insert (creator_id, body) on public.circle_notes to authenticated;
grant delete on public.circle_notes to authenticated;

-- ---------------------------------------------------------------------------
-- 14. Notifications (written by triggers only)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('new_entry','comment','reply','like','follow','membership','message','note')),
  actor_id uuid references public.profiles(id) on delete cascade,
  creator_id uuid references public.creators(id) on delete cascade,
  entry_id uuid references public.entries(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_actor_idx on public.notifications (actor_id);
create index notifications_creator_idx on public.notifications (creator_id);
create index notifications_entry_idx on public.notifications (entry_id);
create index notifications_comment_idx on public.notifications (comment_id);

alter table public.notifications enable row level security;
create policy "own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "mark own read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "clear own" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.notifications from anon, authenticated;
revoke select on public.notifications from anon;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;

create or replace function app_private.wants(p_user uuid, p_type text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (notify_prefs ->> p_type)::boolean from public.user_settings where user_id = p_user), true);
$$;

create or replace function app_private.notify(p_user uuid, p_type text, p_actor uuid, p_creator uuid, p_entry uuid, p_comment uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or p_user is not distinct from p_actor or not app_private.wants(p_user, p_type) then return; end if;
  insert into public.notifications (user_id, type, actor_id, creator_id, entry_id, comment_id)
  values (p_user, p_type, p_actor, p_creator, p_entry, p_comment);
end $$;

create or replace function app_private.notify_circle(p_creator uuid, p_type text, p_entry uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from public.creators where id = p_creator;
  insert into public.notifications (user_id, type, actor_id, creator_id, entry_id)
  select r.user_id, p_type, v_owner, p_creator, p_entry
  from (select user_id from public.follows where creator_id = p_creator
        union select user_id from public.memberships where creator_id = p_creator) r
  where r.user_id is distinct from v_owner and app_private.wants(r.user_id, p_type);
end $$;

revoke execute on function app_private.notify(uuid, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.notify_circle(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function app_private.wants(uuid, text) from public, anon, authenticated;

create or replace function app_private.on_entry_published() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    perform app_private.notify_circle(new.creator_id, 'new_entry', new.id);
  end if;
  return null;
end $$;
create trigger entries_notify after insert or update of status on public.entries for each row execute function app_private.on_entry_published();

create or replace function app_private.on_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid; v_creator uuid; v_parent_author uuid;
begin
  select c.owner_id, c.id into v_owner, v_creator from public.entries e join public.creators c on c.id = e.creator_id where e.id = new.entry_id;
  if new.parent_id is not null then
    select author_id into v_parent_author from public.comments where id = new.parent_id;
    perform app_private.notify(v_parent_author, 'reply', new.author_id, v_creator, new.entry_id, new.id);
  end if;
  if v_owner is distinct from v_parent_author then
    perform app_private.notify(v_owner, 'comment', new.author_id, v_creator, new.entry_id, new.id);
  end if;
  return null;
end $$;
create trigger comments_notify after insert on public.comments for each row execute function app_private.on_comment();

create or replace function app_private.on_like() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid; v_creator uuid;
begin
  select c.owner_id, c.id into v_owner, v_creator from public.entries e join public.creators c on c.id = e.creator_id where e.id = new.entry_id;
  if not exists (select 1 from public.notifications where user_id = v_owner and type = 'like' and actor_id = new.user_id and entry_id = new.entry_id) then
    perform app_private.notify(v_owner, 'like', new.user_id, v_creator, new.entry_id, null);
  end if;
  return null;
end $$;
create trigger likes_notify after insert on public.likes for each row execute function app_private.on_like();

create or replace function app_private.on_follow() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.notify((select owner_id from public.creators where id = new.creator_id), 'follow', new.user_id, new.creator_id, null, null);
  return null;
end $$;
create trigger follows_notify after insert on public.follows for each row execute function app_private.on_follow();

create or replace function app_private.on_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or old.tier_id is distinct from new.tier_id then
    perform app_private.notify((select owner_id from public.creators where id = new.creator_id), 'membership', new.user_id, new.creator_id, null, null);
  end if;
  return null;
end $$;
create trigger memberships_notify after insert or update of tier_id on public.memberships for each row execute function app_private.on_membership();

create or replace function app_private.on_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.sender = 'member' then
    perform app_private.notify((select owner_id from public.creators where id = new.creator_id), 'message', new.member_id, new.creator_id, null, null);
  else
    perform app_private.notify(new.member_id, 'message', (select owner_id from public.creators where id = new.creator_id), new.creator_id, null, null);
  end if;
  return null;
end $$;
create trigger messages_notify after insert on public.messages for each row execute function app_private.on_message();

create or replace function app_private.on_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.notify_circle(new.creator_id, 'note', null);
  return null;
end $$;
create trigger circle_notes_notify after insert on public.circle_notes for each row execute function app_private.on_note();

-- ---------------------------------------------------------------------------
-- 15. Reports (moderation queue, reviewed with the service role)
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('entry','comment','creator','message')),
  target_id uuid not null,
  reason text not null check (reason in ('spam','harassment','nudity','violence','copyright','other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now()
);
create index reports_reporter_idx on public.reports (reporter_id, created_at);
create index reports_open_idx on public.reports (status, created_at) where status = 'open';
alter table public.reports enable row level security;
create policy "file a report" on public.reports for insert to authenticated with check (reporter_id = (select auth.uid()));
create policy "see own reports" on public.reports for select to authenticated using (reporter_id = (select auth.uid()));
revoke insert, update, delete on public.reports from anon, authenticated;
revoke select on public.reports from anon;
grant insert (reporter_id, target_type, target_id, reason, details) on public.reports to authenticated;

create or replace function app_private.before_report() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.enforce_rate('reports', 'reporter_id', 10, interval '1 hour');
  new.status := 'open'; new.created_at := now();
  return new;
end $$;
create trigger reports_before before insert on public.reports for each row execute function app_private.before_report();

-- ---------------------------------------------------------------------------
-- 16. Search
-- ---------------------------------------------------------------------------
create or replace function app_private.prefix_query(q text) returns tsquery
language sql immutable set search_path = '' as $$
  select case when count(*) = 0 then null else to_tsquery('simple'::regconfig, string_agg(w || ':*', ' & ')) end
  from (
    select regexp_replace(lower(x), '[^[:alnum:]]', '', 'g') w
    from regexp_split_to_table(left(coalesce(q, ''), 120), '\s+') x
  ) s where w <> '';
$$;
create or replace function app_private.like_pattern(q text) returns text
language sql immutable set search_path = '' as $$
  select '%' || replace(replace(replace(left(trim(coalesce(q, '')), 120), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;
grant execute on function app_private.prefix_query(text) to anon, authenticated;
grant execute on function app_private.like_pattern(text) to anon, authenticated;

create function public.search_creators(q text, lim integer default 12) returns setof public.creators
language sql stable security invoker set search_path = '' as $$
  select c.* from public.creators c
  where length(trim(coalesce(q, ''))) > 0
    and (c.search @@ app_private.prefix_query(q) or c.name ilike app_private.like_pattern(q))
  order by ts_rank(c.search, coalesce(app_private.prefix_query(q), ''::tsquery)) desc, c.follower_count desc
  limit least(greatest(lim, 1), 50);
$$;

create function public.search_entries(q text, lim integer default 20, off integer default 0) returns setof public.entries
language sql stable security invoker set search_path = '' as $$
  select e.* from public.entries e
  where e.status = 'published' and length(trim(coalesce(q, ''))) > 0
    and (e.search @@ app_private.prefix_query(q) or e.title ilike app_private.like_pattern(q)
         or lower(trim(both '# ' from q)) = any (e.tags))
  order by ts_rank(e.search, coalesce(app_private.prefix_query(q), ''::tsquery)) desc, e.published_at desc
  limit least(greatest(lim, 1), 50) offset greatest(off, 0);
$$;
grant execute on function public.search_creators(text, integer) to anon, authenticated;
grant execute on function public.search_entries(text, integer, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 17. Creator analytics (owner only)
-- ---------------------------------------------------------------------------
create function public.creator_stats(p_creator uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not app_private.owns_creator(p_creator) then raise exception 'Not your atelier.' using errcode = 'P0001'; end if;
  select jsonb_build_object(
    'followers', c.follower_count,
    'members', c.member_count,
    'entries', c.entry_count,
    'drafts', (select count(*) from public.entries where creator_id = c.id and status = 'draft'),
    'likes', (select coalesce(sum(like_count), 0) from public.entries where creator_id = c.id),
    'comments', (select coalesce(sum(comment_count), 0) from public.entries where creator_id = c.id),
    'reads', (select coalesce(sum(read_count), 0) from public.entries where creator_id = c.id),
    'monthly_value_cents', (select coalesce(sum(t.price_cents), 0) from public.memberships m join public.creator_tiers t on t.id = m.tier_id where m.creator_id = c.id),
    'new_members_30d', (select count(*) from public.memberships where creator_id = c.id and created_at > now() - interval '30 days'),
    'new_followers_30d', (select count(*) from public.follows where creator_id = c.id and created_at > now() - interval '30 days'),
    'by_tier', (select coalesce(jsonb_agg(jsonb_build_object('tier_id', t.id, 'name', t.name, 'rank', t.rank, 'members',
                  (select count(*) from public.memberships m where m.tier_id = t.id)) order by t.rank), '[]'::jsonb)
                from public.creator_tiers t where t.creator_id = c.id),
    'top_entries', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select id, title, kind, like_count, comment_count, read_count from public.entries
                  where creator_id = c.id and status = 'published' order by read_count + like_count * 3 + comment_count * 5 desc limit 5) x)
  ) into v from public.creators c where c.id = p_creator;
  return v;
end $$;
revoke execute on function public.creator_stats(uuid) from public, anon;
grant execute on function public.creator_stats(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 18. Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.notifications;
