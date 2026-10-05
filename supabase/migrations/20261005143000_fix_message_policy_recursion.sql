create function app_private.member_started_thread(c uuid, m uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.messages where creator_id = c and member_id = m and sender = 'member');
$$;
revoke execute on function app_private.member_started_thread(uuid, uuid) from public;
grant execute on function app_private.member_started_thread(uuid, uuid) to authenticated;

drop policy "send in thread" on public.messages;
create policy "send in thread" on public.messages for insert to authenticated with check (
  (sender = 'member' and member_id = (select auth.uid()) and not (select app_private.owns_creator(creator_id)))
  or (sender = 'creator' and (select app_private.owns_creator(creator_id)) and app_private.member_started_thread(creator_id, member_id)));
