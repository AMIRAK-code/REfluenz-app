create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to anon, authenticated;

alter function public.owns_creator(uuid) set schema app_private;
alter function public.can_read_entry(uuid) set schema app_private;
revoke execute on function app_private.owns_creator(uuid) from public;
revoke execute on function app_private.can_read_entry(uuid) from public;
grant execute on function app_private.owns_creator(uuid) to anon, authenticated;
grant execute on function app_private.can_read_entry(uuid) to authenticated;
