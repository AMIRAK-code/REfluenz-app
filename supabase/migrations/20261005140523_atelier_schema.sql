-- Profiles ---------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  bio text not null default '' check (char_length(bio) <= 240),
  compact boolean not null default false,
  welcome_dismissed boolean not null default false,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1), 'Member'), 60));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Tiers (global price ladder; payment provider integration comes later) ---
create table public.tiers (
  id text primary key,
  name text not null,
  price integer not null check (price >= 0),
  level integer not null unique check (level > 0),
  description text not null,
  features text[] not null default '{}'
);

-- Creators ---------------------------------------------------------------
create table public.creators (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid unique references public.profiles(id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 2 and 60),
  category text not null check (category in ('Style','Beauty','Design','Culture')),
  descriptor text not null default '' check (char_length(descriptor) <= 60),
  location text not null default '' check (char_length(location) <= 60),
  image text not null default 'atelier' check (image in ('atelier','ritual','architecture')),
  bio text not null default '' check (char_length(bio) <= 400),
  created_at timestamptz not null default now()
);

-- Entries: metadata is public once published; the body is gated -----------
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 100),
  subtitle text not null default '' check (char_length(subtitle) <= 180),
  excerpt text not null default '',
  category text not null check (category in ('Style','Beauty','Design','Culture')),
  format text not null default 'Essay' check (format in ('Essay','Guide','Studio note','Field note','Collection')),
  image text not null default 'atelier' check (image in ('atelier','ritual','architecture')),
  minutes integer not null default 1,
  access text not null default 'public' check (access = 'public' or access in ('essential','premium','signature')),
  status text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index entries_creator_idx on public.entries(creator_id);
create index entries_feed_idx on public.entries(status, published_at desc);

create table public.entry_bodies (
  entry_id uuid primary key references public.entries(id) on delete cascade,
  body text not null check (char_length(body) between 30 and 20000)
);

-- Member relationships ----------------------------------------------------
create table public.follows (
  user_id uuid not null references public.profiles(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, creator_id)
);
create index follows_creator_idx on public.follows(creator_id);

create table public.bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_id uuid not null references public.entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, entry_id)
);
create index bookmarks_entry_idx on public.bookmarks(entry_id);

create table public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_id uuid not null references public.entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, entry_id)
);
create index likes_entry_idx on public.likes(entry_id);

create table public.memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  tier text not null references public.tiers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, creator_id)
);
create index memberships_creator_idx on public.memberships(creator_id);
create index memberships_tier_idx on public.memberships(tier);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  sender text not null check (sender in ('member','creator')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index messages_thread_idx on public.messages(creator_id, member_id, created_at);
create index messages_member_idx on public.messages(member_id);

create table public.circle_notes (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index circle_notes_creator_idx on public.circle_notes(creator_id, created_at);

-- Helpers (moved to app_private in a later migration) ---------------------
create function public.owns_creator(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.creators where id = c and owner_id = (select auth.uid()));
$$;

create function public.can_read_entry(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.entries en
    where en.id = e and (
      (en.status = 'published' and (
        en.access = 'public'
        or exists (
          select 1 from public.memberships m
          join public.tiers have on have.id = m.tier
          join public.tiers need on need.id = en.access
          where m.user_id = (select auth.uid()) and m.creator_id = en.creator_id and have.level >= need.level)))
      or exists (select 1 from public.creators c where c.id = en.creator_id and c.owner_id = (select auth.uid()))));
$$;

-- Atomic, validated entry save for creators
create function public.save_entry(
  p_id uuid, p_title text, p_subtitle text, p_body text, p_category text,
  p_format text, p_image text, p_access text, p_status text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_creator uuid;
  v_id uuid := p_id;
  v_body text := trim(coalesce(p_body, ''));
  v_existing public.entries;
begin
  select id into v_creator from public.creators where owner_id = (select auth.uid());
  if v_creator is null then raise exception 'Open your atelier before writing an entry.'; end if;
  if char_length(trim(coalesce(p_title,''))) not between 3 and 100 then raise exception 'Use a title between 3 and 100 characters.'; end if;
  if char_length(v_body) not between 30 and 20000 then raise exception 'Write between 30 and 20,000 characters for your entry.'; end if;
  if p_status not in ('draft','published') then raise exception 'Invalid status.'; end if;

  if v_id is not null then
    select * into v_existing from public.entries where id = v_id;
    if v_existing.id is null or v_existing.creator_id <> v_creator then raise exception 'You can only edit your own entries.'; end if;
    update public.entries set
      title = trim(p_title), subtitle = trim(coalesce(p_subtitle,'')), category = p_category,
      format = coalesce(p_format,'Essay'), image = p_image, access = p_access, status = p_status,
      excerpt = split_part(v_body, E'\n\n', 1),
      minutes = greatest(1, ceil(array_length(regexp_split_to_array(v_body, '\s+'), 1) / 200.0)::int),
      published_at = case when p_status = 'published' then coalesce(v_existing.published_at, now()) else v_existing.published_at end,
      updated_at = now()
    where id = v_id;
    update public.entry_bodies set body = v_body where entry_id = v_id;
  else
    insert into public.entries (creator_id, title, subtitle, category, format, image, access, status, excerpt, minutes, published_at)
    values (v_creator, trim(p_title), trim(coalesce(p_subtitle,'')), p_category, coalesce(p_format,'Essay'), p_image, p_access, p_status,
      split_part(v_body, E'\n\n', 1),
      greatest(1, ceil(array_length(regexp_split_to_array(v_body, '\s+'), 1) / 200.0)::int),
      case when p_status = 'published' then now() end)
    returning id into v_id;
    insert into public.entry_bodies (entry_id, body) values (v_id, v_body);
  end if;
  return v_id;
end $$;

revoke execute on function public.save_entry(uuid,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.save_entry(uuid,text,text,text,text,text,text,text,text) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Row level security ------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.tiers enable row level security;
alter table public.creators enable row level security;
alter table public.entries enable row level security;
alter table public.entry_bodies enable row level security;
alter table public.follows enable row level security;
alter table public.bookmarks enable row level security;
alter table public.likes enable row level security;
alter table public.memberships enable row level security;
alter table public.messages enable row level security;
alter table public.circle_notes enable row level security;

create policy "profiles readable by members" on public.profiles for select to authenticated using (true);
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "tiers are public" on public.tiers for select to anon, authenticated using (true);

create policy "creators are public" on public.creators for select to anon, authenticated using (true);
create policy "open own atelier" on public.creators for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "edit own atelier" on public.creators for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "published entries or own" on public.entries for select to anon, authenticated
  using (status = 'published' or (select public.owns_creator(creator_id)));
create policy "delete own entries" on public.entries for delete to authenticated
  using ((select public.owns_creator(creator_id)));

create policy "bodies by access" on public.entry_bodies for select to authenticated
  using ((select public.can_read_entry(entry_id)));

create policy "own follows" on public.follows for select to authenticated using (user_id = (select auth.uid()));
create policy "follow" on public.follows for insert to authenticated with check (user_id = (select auth.uid()));
create policy "unfollow" on public.follows for delete to authenticated using (user_id = (select auth.uid()));

create policy "own bookmarks" on public.bookmarks for select to authenticated using (user_id = (select auth.uid()));
create policy "bookmark" on public.bookmarks for insert to authenticated with check (user_id = (select auth.uid()));
create policy "unbookmark" on public.bookmarks for delete to authenticated using (user_id = (select auth.uid()));

create policy "own likes" on public.likes for select to authenticated using (user_id = (select auth.uid()));
create policy "like" on public.likes for insert to authenticated with check (user_id = (select auth.uid()));
create policy "unlike" on public.likes for delete to authenticated using (user_id = (select auth.uid()));

-- Joining is free during the pre-payment phase. When payments launch, drop the
-- insert/update policies and let a payment webhook (service role) write memberships.
create policy "own or my circle memberships" on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or (select public.owns_creator(creator_id)));
create policy "join circle" on public.memberships for insert to authenticated
  with check (user_id = (select auth.uid()) and not (select public.owns_creator(creator_id)));
create policy "change tier" on public.memberships for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "leave circle" on public.memberships for delete to authenticated using (user_id = (select auth.uid()));

create policy "thread participants read" on public.messages for select to authenticated
  using (member_id = (select auth.uid()) or (select public.owns_creator(creator_id)));
create policy "send in thread" on public.messages for insert to authenticated with check (
  (sender = 'member' and member_id = (select auth.uid()) and not (select public.owns_creator(creator_id)))
  or (sender = 'creator' and (select public.owns_creator(creator_id)) and exists (
    select 1 from public.messages m where m.creator_id = messages.creator_id and m.member_id = messages.member_id and m.sender = 'member')));

create policy "notes readable" on public.circle_notes for select to authenticated using (true);
create policy "post note" on public.circle_notes for insert to authenticated with check ((select public.owns_creator(creator_id)));
create policy "remove note" on public.circle_notes for delete to authenticated using ((select public.owns_creator(creator_id)));

alter publication supabase_realtime add table public.messages, public.circle_notes;
