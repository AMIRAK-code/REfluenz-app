-- REFLUENZ platform v2 (reconciled with post_formats, additive)
--
-- Adds: per-creator tier names/prices/perks over the shared access ladder,
-- profile + atelier images (avatars / covers buckets), uploaded covers for
-- text posts, public browsing for guests, comments, counters, read analytics,
-- read receipts + inbox, notifications, reports, search, creator analytics and
-- rate limits.
--
-- Compatibility: everything the currently deployed client reads or writes keeps
-- working (entries.access, memberships.tier, profiles.compact/welcome_dismissed,
-- save_entry, entry_media). Nothing from post_formats is replaced.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
create or replace function app_private.entry_published(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.entries where id = e and status = 'published');
$$;

create or replace function app_private.creator_has_owner(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.creators where id = c and owner_id is not null);
$$;

-- <uuid>/<file>: one folder level, lowercase uuid, simple file name.
create or replace function app_private.folder_name_ok(n text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(n ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$', false);
$$;

-- [{label, url}] with http(s) urls only.
create or replace function app_private.links_ok(j jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(j) = 'array' and jsonb_array_length(j) <= 5 and not exists (
    select 1 from jsonb_array_elements(j) x
    where jsonb_typeof(x) <> 'object'
       or jsonb_typeof(x -> 'url') <> 'string'
       or char_length(x ->> 'url') > 300
       or (x ->> 'url') !~* '^https?://[^\s<>"]+$'
       or char_length(coalesce(x ->> 'label', '')) > 40);
$$;

-- Throttle: raise when the current user inserted at least p_max rows into
-- p_table (column p_col = auth.uid()) within p_window.
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

-- Object count under a prefix. SECURITY DEFINER so storage policies can use it
-- without querying storage.objects from its own policy (recursion).
create or replace function app_private.object_count(b text, prefix text) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from storage.objects where bucket_id = b and name like prefix || '%';
$$;
revoke execute on function app_private.object_count(text, text) from public, anon;
grant execute on function app_private.object_count(text, text) to authenticated;

revoke execute on function app_private.enforce_rate(text, text, int, interval) from public, anon, authenticated;
grant execute on function app_private.entry_published(uuid) to anon, authenticated;
grant execute on function app_private.creator_has_owner(uuid) to anon, authenticated;
grant execute on function app_private.folder_name_ok(text) to anon, authenticated;
grant execute on function app_private.links_ok(jsonb) to anon, authenticated;
-- Guests may browse public posts and their media.
grant execute on function app_private.can_read_entry(uuid) to anon;
grant execute on function app_private.try_uuid(text) to anon;

-- ---------------------------------------------------------------------------
-- 1. Wider categories
-- ---------------------------------------------------------------------------
alter table public.creators drop constraint creators_category_check;
alter table public.creators add constraint creators_category_check check (category in
  ('Style','Beauty','Design','Culture','Art','Music','Writing','Photography','Wellness','Food','Education','Technology'));
alter table public.entries drop constraint entries_category_check;
alter table public.entries add constraint entries_category_check check (category in
  ('Style','Beauty','Design','Culture','Art','Music','Writing','Photography','Wellness','Food','Education','Technology'));

-- ---------------------------------------------------------------------------
-- 2. Profiles (public) + user_settings (private)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column avatar_path text,
  add column website text not null default '' check (char_length(website) <= 200 and (website = '' or website ~* '^https?://[^\s<>"]+$')),
  add column updated_at timestamptz not null default now();
alter table public.profiles add constraint profiles_avatar_path_ok
  check (avatar_path is null or (app_private.folder_name_ok(avatar_path) and split_part(avatar_path, '/', 1) = id::text));

drop policy "profiles readable by members" on public.profiles;
create policy "profiles are public" on public.profiles for select to anon, authenticated using (true);
revoke insert, update, delete on public.profiles from anon, authenticated;
-- compact / welcome_dismissed stay writable for the previous client; new clients use user_settings.
grant update (display_name, bio, avatar_path, website, updated_at, compact, welcome_dismissed) on public.profiles to authenticated;

create table public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  compact boolean not null default false,
  welcome_dismissed boolean not null default false,
  onboarded boolean not null default false,
  notify_prefs jsonb not null default '{"new_entry":true,"comment":true,"reply":true,"like":true,"follow":true,"membership":true,"message":true,"note":true}'::jsonb
    check (jsonb_typeof(notify_prefs) = 'object'),
  updated_at timestamptz not null default now()
);
insert into public.user_settings (user_id, compact, welcome_dismissed, onboarded)
  select id, compact, welcome_dismissed, true from public.profiles;

alter table public.user_settings enable row level security;
create policy "own settings" on public.user_settings for select to authenticated using (user_id = (select auth.uid()));
create policy "update own settings" on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.user_settings from anon;
revoke insert, update, delete on public.user_settings from authenticated;
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
  add column avatar_path text,
  add column cover_path text,
  add column links jsonb not null default '[]'::jsonb,
  add column is_showcase boolean not null default false,
  add column follower_count integer not null default 0,
  add column member_count integer not null default 0,
  add column entry_count integer not null default 0,
  add column updated_at timestamptz not null default now(),
  add column search tsvector generated always as (to_tsvector('simple'::regconfig,
    coalesce(name,'') || ' ' || coalesce(descriptor,'') || ' ' || coalesce(location,'') || ' ' || coalesce(category,'') || ' ' || coalesce(bio,''))) stored;
alter table public.creators
  add constraint creators_avatar_path_ok check (avatar_path is null or (app_private.folder_name_ok(avatar_path) and split_part(avatar_path, '/', 1) = id::text)),
  add constraint creators_cover_path_ok check (cover_path is null or (app_private.folder_name_ok(cover_path) and split_part(cover_path, '/', 1) = id::text)),
  add constraint creators_links_ok check (app_private.links_ok(links));
create index creators_search_idx on public.creators using gin (search);
create index creators_name_trgm_idx on public.creators using gin (name extensions.gin_trgm_ops);
create index creators_popular_idx on public.creators (follower_count desc, created_at desc);
create index creators_category_idx on public.creators (category);
update public.creators set is_showcase = true where owner_id is null;

revoke insert, update, delete on public.creators from anon, authenticated;
grant insert (owner_id, slug, name, category, descriptor, location, image, bio, links) on public.creators to authenticated;
grant update (slug, name, category, descriptor, location, image, bio, avatar_path, cover_path, links, updated_at) on public.creators to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Per-creator tiers over the shared access ladder (essential/premium/signature)
-- ---------------------------------------------------------------------------
create table public.creator_tiers (
  creator_id uuid not null references public.creators(id) on delete cascade,
  tier_id text not null references public.tiers(id),
  name text not null check (char_length(trim(name)) between 2 and 40),
  price_cents integer not null check (price_cents between 0 and 100000),
  currency text not null default 'EUR' check (currency in ('EUR','USD','GBP')),
  description text not null default '' check (char_length(description) <= 280),
  perks text[] not null default '{}' check (cardinality(perks) <= 8),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (creator_id, tier_id)
);
create index creator_tiers_tier_idx on public.creator_tiers (tier_id);
insert into public.creator_tiers (creator_id, tier_id, name, price_cents, description, perks)
  select c.id, t.id, t.name, t.price * 100, t.description, t.features from public.creators c cross join public.tiers t;

alter table public.creator_tiers enable row level security;
create policy "creator tiers are public" on public.creator_tiers for select to anon, authenticated using (true);
create policy "owner edits tiers" on public.creator_tiers for update to authenticated
  using ((select app_private.owns_creator(creator_id))) with check ((select app_private.owns_creator(creator_id)));
revoke insert, update, delete on public.creator_tiers from anon, authenticated;
grant update (name, price_cents, currency, description, perks, enabled, updated_at) on public.creator_tiers to authenticated;

create or replace function app_private.before_creator_tier() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name := trim(new.name);
  new.perks := coalesce((select array_agg(left(trim(p), 80)) from unnest(new.perks) p where trim(p) <> ''), '{}');
  new.updated_at := now();
  -- At least one tier stays open so a circle can always be joined.
  if tg_op = 'UPDATE' and not new.enabled and not exists (
      select 1 from public.creator_tiers where creator_id = new.creator_id and tier_id <> new.tier_id and enabled) then
    raise exception 'Keep at least one membership tier open.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger creator_tiers_before before insert or update on public.creator_tiers
  for each row execute function app_private.before_creator_tier();

create or replace function app_private.default_tiers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.creator_tiers (creator_id, tier_id, name, price_cents, description, perks)
    select new.id, t.id, t.name, t.price * 100, t.description, t.features from public.tiers t;
  return new;
end $$;
create trigger creators_default_tiers after insert on public.creators
  for each row execute function app_private.default_tiers();

alter table public.memberships add constraint memberships_creator_tier_fk
  foreign key (creator_id, tier) references public.creator_tiers(creator_id, tier_id) on delete cascade;
revoke insert, update, delete on public.memberships from anon, authenticated;
-- Upserts (INSERT ... ON CONFLICT DO UPDATE) need these columns on both sides;
-- before_membership pins user_id/creator_id/created_at on update.
grant insert (user_id, creator_id, tier, updated_at) on public.memberships to authenticated;
grant update (user_id, creator_id, tier, updated_at) on public.memberships to authenticated;
grant delete on public.memberships to authenticated;

create or replace function app_private.before_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.creator_tiers where creator_id = new.creator_id and tier_id = new.tier and enabled) then
    raise exception 'That membership tier is not open right now.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id; new.creator_id := old.creator_id; new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger memberships_before before insert or update on public.memberships
  for each row execute function app_private.before_membership();

-- ---------------------------------------------------------------------------
-- 5. Entries: uploaded covers for text posts, counters, search; guest access
-- ---------------------------------------------------------------------------
alter table public.entries
  add column cover_path text,
  add column like_count integer not null default 0,
  add column comment_count integer not null default 0,
  add column read_count integer not null default 0,
  add column search tsvector generated always as (to_tsvector('simple'::regconfig,
    coalesce(title,'') || ' ' || coalesce(subtitle,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(category,'') || ' ' || coalesce(format,''))) stored;
alter table public.entries add constraint entries_cover_path_ok
  check (cover_path is null or (app_private.folder_name_ok(cover_path) and split_part(cover_path, '/', 1) = creator_id::text));
create index entries_search_idx on public.entries using gin (search);
create index entries_title_trgm_idx on public.entries using gin (title extensions.gin_trgm_ops);
create index entries_popular_idx on public.entries (status, like_count desc, published_at desc);
create index entries_creator_feed_idx on public.entries (creator_id, status, published_at desc);
create index entries_kind_feed_idx on public.entries (kind, status, published_at desc);
create index entries_category_feed_idx on public.entries (category, status, published_at desc);

-- Owner sets or clears the public cover of an entry (covers/<creator_id>/<file>).
create function public.set_entry_cover(p_entry uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_creator uuid;
begin
  select en.creator_id into v_creator from public.entries en join public.creators c on c.id = en.creator_id
    where en.id = p_entry and c.owner_id = (select auth.uid());
  if v_creator is null then raise exception 'You can only change your own entries.' using errcode = 'P0001'; end if;
  if p_path is not null and not (app_private.folder_name_ok(p_path) and split_part(p_path, '/', 1) = v_creator::text) then
    raise exception 'Invalid cover image.' using errcode = 'P0001';
  end if;
  update public.entries set cover_path = p_path, updated_at = now() where id = p_entry;
end $$;
revoke execute on function public.set_entry_cover(uuid, text) from public, anon;
grant execute on function public.set_entry_cover(uuid, text) to authenticated;

-- Guests: bodies, media rows and media files of public posts.
create policy "bodies by access (guests)" on public.entry_bodies for select to anon
  using ((select app_private.can_read_entry(entry_id)));
grant select on public.entry_bodies to anon;
create policy "media by access (guests)" on public.entry_media for select to anon
  using ((select app_private.can_read_entry(entry_id)));
grant select on public.entry_media to anon;
create policy "entry-media: guests read public" on storage.objects for select to anon
  using (bucket_id = 'entry-media'
    and app_private.can_read_entry(app_private.try_uuid((storage.foldername(name))[2])));

-- ---------------------------------------------------------------------------
-- 6. Storage: avatars/<user_id>/<file>, covers/<creator_id>/<file> (both public)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif']),
  ('covers', 'covers', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "avatars: owner reads" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and app_private.folder_name_ok(name) and (storage.foldername(name))[1] = (select auth.uid())::text
    and app_private.object_count('avatars', (select auth.uid())::text || '/') < 10);
create policy "avatars: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "covers: owner reads" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1])));
create policy "covers: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and app_private.folder_name_ok(name)
    and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1]))
    and app_private.object_count('covers', (storage.foldername(name))[1] || '/') < 200);
create policy "covers: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and app_private.owns_creator(app_private.try_uuid((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------------
-- 7. Comments (one level of replies)
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
  new.body := trim(new.body);
  if tg_op = 'INSERT' then
    perform app_private.enforce_rate('comments', 'author_id', 10, interval '1 minute');
    if new.parent_id is not null then
      select * into p from public.comments where id = new.parent_id;
      if p.id is null or p.entry_id <> new.entry_id then raise exception 'Invalid reply.' using errcode = 'P0001'; end if;
      if p.parent_id is not null then new.parent_id := p.parent_id; end if; -- keep threads one level deep
    end if;
    new.created_at := now(); new.edited_at := null;
  else
    new.entry_id := old.entry_id; new.author_id := old.author_id; new.parent_id := old.parent_id;
    new.created_at := old.created_at; new.edited_at := now();
  end if;
  return new;
end $$;
create trigger comments_before before insert or update on public.comments
  for each row execute function app_private.before_comment();

-- ---------------------------------------------------------------------------
-- 8. Likes / bookmarks require a visible, published entry
-- ---------------------------------------------------------------------------
drop policy "like" on public.likes;
create policy "like" on public.likes for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app_private.can_read_entry(entry_id)) and (select app_private.entry_published(entry_id)));
drop policy "bookmark" on public.bookmarks;
create policy "bookmark" on public.bookmarks for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app_private.entry_published(entry_id)));
revoke update on public.likes, public.bookmarks, public.follows from anon, authenticated;
revoke insert, delete on public.likes, public.bookmarks, public.follows from anon;

-- ---------------------------------------------------------------------------
-- 9. Counters (maintained by triggers only)
-- ---------------------------------------------------------------------------
create or replace function app_private.count_follows() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c uuid := coalesce(new.creator_id, old.creator_id);
begin
  update public.creators set follower_count = (select count(*) from public.follows where creator_id = c) where id = c;
  return null;
end $$;
create trigger follows_count after insert or delete on public.follows for each row execute function app_private.count_follows();

create or replace function app_private.count_members() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c uuid := coalesce(new.creator_id, old.creator_id);
begin
  update public.creators set member_count = (select count(*) from public.memberships where creator_id = c) where id = c;
  return null;
end $$;
create trigger memberships_count after insert or delete on public.memberships for each row execute function app_private.count_members();

create or replace function app_private.count_likes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e uuid := coalesce(new.entry_id, old.entry_id);
begin
  update public.entries set like_count = (select count(*) from public.likes where entry_id = e) where id = e;
  return null;
end $$;
create trigger likes_count after insert or delete on public.likes for each row execute function app_private.count_likes();

create or replace function app_private.count_comments() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e uuid := coalesce(new.entry_id, old.entry_id);
begin
  update public.entries set comment_count = (select count(*) from public.comments where entry_id = e) where id = e;
  return null;
end $$;
create trigger comments_count after insert or delete on public.comments for each row execute function app_private.count_comments();

create or replace function app_private.count_entries() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c uuid := coalesce(new.creator_id, old.creator_id);
begin
  update public.creators set entry_count = (select count(*) from public.entries where creator_id = c and status = 'published') where id = c;
  return null;
end $$;
create trigger entries_count after insert or delete or update of status on public.entries for each row execute function app_private.count_entries();

update public.creators c set
  follower_count = (select count(*) from public.follows f where f.creator_id = c.id),
  member_count = (select count(*) from public.memberships m where m.creator_id = c.id),
  entry_count = (select count(*) from public.entries e where e.creator_id = c.id and e.status = 'published');
update public.entries e set like_count = (select count(*) from public.likes l where l.entry_id = e.id);

-- ---------------------------------------------------------------------------
-- 10. Read analytics
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
revoke all on public.entry_reads from anon;
revoke insert, update, delete on public.entry_reads from authenticated;

create function public.record_read(p_entry uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not app_private.entry_published(p_entry) or not app_private.can_read_entry(p_entry) then return; end if;
  insert into public.entry_reads (user_id, entry_id) values ((select auth.uid()), p_entry) on conflict do nothing;
  if found then update public.entries set read_count = read_count + 1 where id = p_entry; end if;
end $$;
revoke execute on function public.record_read(uuid) from public, anon;
grant execute on function public.record_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Messages: owned ateliers only, read receipts, inbox, rate limit
-- ---------------------------------------------------------------------------
alter table public.messages add column read_at timestamptz;
drop policy "send in thread" on public.messages;
create policy "send in thread" on public.messages for insert to authenticated with check (
  (sender = 'member' and member_id = (select auth.uid()) and not (select app_private.owns_creator(creator_id)) and (select app_private.creator_has_owner(creator_id)))
  or (sender = 'creator' and (select app_private.owns_creator(creator_id)) and app_private.member_started_thread(creator_id, member_id)));
revoke insert, update, delete on public.messages from anon, authenticated;
revoke select on public.messages from anon;
grant insert (creator_id, member_id, sender, body) on public.messages to authenticated;

create or replace function app_private.before_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.messages m where m.created_at > now() - interval '1 minute'
      and ((m.sender = 'member' and m.member_id = (select auth.uid()))
           or (m.sender = 'creator' and m.creator_id in (select id from public.creators where owner_id = (select auth.uid()))))) >= 20 then
    raise exception 'You are sending messages too quickly. Please wait a moment.' using errcode = 'P0001';
  end if;
  new.body := trim(new.body);
  new.created_at := now(); new.read_at := null;
  return new;
end $$;
create trigger messages_before before insert on public.messages for each row execute function app_private.before_message();
create index messages_unread_idx on public.messages (member_id, creator_id) where read_at is null;

create function public.mark_thread_read(p_creator uuid, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return; end if;
  if (select auth.uid()) = p_member then
    update public.messages set read_at = now() where creator_id = p_creator and member_id = p_member and sender = 'creator' and read_at is null;
  end if;
  if app_private.owns_creator(p_creator) then
    update public.messages set read_at = now() where creator_id = p_creator and member_id = p_member and sender = 'member' and read_at is null;
  end if;
  update public.notifications set read_at = now()
    where user_id = (select auth.uid()) and type = 'message' and creator_id = p_creator and read_at is null
      and (actor_id = p_member or (select auth.uid()) = p_member);
end $$;
revoke execute on function public.mark_thread_read(uuid, uuid) from public, anon;

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

-- Circle notes: rate limit, column grants
create or replace function app_private.before_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.circle_notes where creator_id = new.creator_id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You have shared a lot of notes this hour. Please wait a little.' using errcode = 'P0001';
  end if;
  new.body := trim(new.body);
  new.created_at := now();
  return new;
end $$;
create trigger circle_notes_before before insert on public.circle_notes for each row execute function app_private.before_note();
revoke insert, update, delete on public.circle_notes from anon, authenticated;
revoke select on public.circle_notes from anon;
grant insert (creator_id, body) on public.circle_notes to authenticated;
grant delete on public.circle_notes to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Notifications (written by triggers only)
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
revoke all on public.notifications from anon;
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;
grant execute on function public.mark_thread_read(uuid, uuid) to authenticated;

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

-- Fan-out to followers and members (union, deduplicated), excluding the owner.
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
  -- First publication only; re-publishing after a demotion does not notify again.
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and not exists (select 1 from public.notifications where type = 'new_entry' and entry_id = new.id) then
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
  if v_owner is not null and not exists (
      select 1 from public.notifications where user_id = v_owner and type = 'like' and actor_id = new.user_id and entry_id = new.entry_id) then
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
  if tg_op = 'INSERT' or old.tier is distinct from new.tier then
    perform app_private.notify((select owner_id from public.creators where id = new.creator_id), 'membership', new.user_id, new.creator_id, null, null);
  end if;
  return null;
end $$;
create trigger memberships_notify after insert or update of tier on public.memberships for each row execute function app_private.on_membership();

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
-- 13. Reports (moderation queue, reviewed with the service role)
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
revoke all on public.reports from anon;
revoke insert, update, delete on public.reports from authenticated;
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
-- 14. Search
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
  limit least(greatest(coalesce(lim, 12), 1), 50);
$$;

create function public.search_entries(q text, lim integer default 20, off integer default 0) returns setof public.entries
language sql stable security invoker set search_path = '' as $$
  select e.* from public.entries e
  where e.status = 'published' and length(trim(coalesce(q, ''))) > 0
    and (e.search @@ app_private.prefix_query(q) or e.title ilike app_private.like_pattern(q))
  order by ts_rank(e.search, coalesce(app_private.prefix_query(q), ''::tsquery)) desc, e.published_at desc
  limit least(greatest(coalesce(lim, 20), 1), 50) offset greatest(coalesce(off, 0), 0);
$$;
grant execute on function public.search_creators(text, integer) to anon, authenticated;
grant execute on function public.search_entries(text, integer, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 15. Creator analytics (owner only)
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
    'monthly_value_cents', (select coalesce(sum(ct.price_cents), 0) from public.memberships m
                              join public.creator_tiers ct on ct.creator_id = m.creator_id and ct.tier_id = m.tier
                              where m.creator_id = c.id),
    'new_members_30d', (select count(*) from public.memberships where creator_id = c.id and created_at > now() - interval '30 days'),
    'new_followers_30d', (select count(*) from public.follows where creator_id = c.id and created_at > now() - interval '30 days'),
    'by_tier', (select coalesce(jsonb_agg(jsonb_build_object('tier_id', ct.tier_id, 'name', ct.name, 'level', t.level, 'enabled', ct.enabled,
                  'price_cents', ct.price_cents, 'members', (select count(*) from public.memberships m where m.creator_id = c.id and m.tier = ct.tier_id))
                  order by t.level), '[]'::jsonb)
                from public.creator_tiers ct join public.tiers t on t.id = ct.tier_id where ct.creator_id = c.id),
    'top_entries', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select id, title, kind, like_count, comment_count, read_count from public.entries
                  where creator_id = c.id and status = 'published'
                  order by read_count + like_count * 3 + comment_count * 5 desc, published_at desc limit 5) x)
  ) into v from public.creators c where c.id = p_creator;
  return v;
end $$;
revoke execute on function public.creator_stats(uuid) from public, anon;
grant execute on function public.creator_stats(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 16. Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.notifications;
