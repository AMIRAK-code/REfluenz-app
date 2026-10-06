create index if not exists memberships_creator_tier_idx on public.memberships (creator_id, tier);
alter table app_private.rate_log add column id bigint generated always as identity primary key;
