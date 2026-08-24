-- Sodium Phase 1 brand migration.
-- Safe to run once after the location-memberships migration.
-- Existing users, profiles, content, invite codes, and relationships are preserved.

begin;

update public.rewards
set offer_text = 'Sodium member discount'
where offer_text = 'Salty member discount';

drop function if exists public.create_invite(int);
create or replace function public.create_invite(invite_max_uses int default 1, invite_region uuid default null)
returns text language plpgsql security definer set search_path = public
as $$
declare new_code text;
begin
  if not public.is_member() then raise exception 'Community membership required'; end if;
  if invite_max_uses < 1 or invite_max_uses > 25 then raise exception 'max uses must be between 1 and 25'; end if;
  if invite_region is not null and not exists (select 1 from public.regions where id = invite_region and is_active) then
    raise exception 'Location not found';
  end if;
  new_code := 'SODIUM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.invites (code, created_by, max_uses, region_id)
  values (new_code, auth.uid(), invite_max_uses, invite_region);
  return new_code;
end $$;

revoke all on function public.create_invite(int,uuid) from public;
grant execute on function public.create_invite(int,uuid) to authenticated;

commit;

select 'Sodium Phase 1 brand migration complete' as result;
