-- Salty profile + persistent-auth migration
-- Run this once because the original full schema has already been installed.

begin;

alter table public.profiles add column if not exists nickname text;
alter table public.profiles add column if not exists social_url text;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists onboarding_complete boolean not null default false;

alter table public.profiles drop constraint if exists profiles_nickname_check;
alter table public.profiles add constraint profiles_nickname_check
  check (nickname is null or char_length(trim(nickname)) between 1 and 50);

create or replace function public.redeem_invite(
  invite_code text,
  profile_name text default null,
  profile_phone text default null,
  profile_region text default null
) returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare
  invite_row public.invites;
  region_uuid uuid;
  result public.profiles;
  resolved_name text;
  resolved_phone text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into result from public.profiles where id = auth.uid();
  if found then return result; end if;

  select * into invite_row from public.invites
   where upper(code) = upper(trim(invite_code))
     and revoked_at is null
     and (expires_at is null or expires_at > now())
     and use_count < max_uses
   for update;
  if not found then raise exception 'This invite is invalid, expired, or already used'; end if;

  resolved_name := coalesce(
    nullif(trim(profile_name), ''),
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'name'), ''),
    nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
    'New member'
  );
  resolved_phone := coalesce(nullif(trim(profile_phone), ''), nullif(trim(auth.jwt() -> 'user_metadata' ->> 'phone'), ''));

  select id into region_uuid from public.regions
   where lower(name) = lower(coalesce(profile_region, auth.jwt() -> 'user_metadata' ->> 'home_region', 'California'))
   limit 1;

  insert into public.profiles (id, name, phone, home_region, onboarding_complete)
  values (auth.uid(), resolved_name, resolved_phone, region_uuid, false)
  returning * into result;

  update public.invites
     set use_count = use_count + 1,
         used_by = case when max_uses = 1 then auth.uid() else used_by end
   where id = invite_row.id;

  return result;
end $$;

grant execute on function public.redeem_invite(text,text,text,text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('salty-avatars', 'salty-avatars', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists salty_avatars_read_members on storage.objects;
drop policy if exists salty_avatars_insert_own on storage.objects;
drop policy if exists salty_avatars_update_own on storage.objects;
drop policy if exists salty_avatars_delete_own on storage.objects;

create policy salty_avatars_read_members on storage.objects for select to authenticated
using (bucket_id = 'salty-avatars' and public.is_member());
create policy salty_avatars_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'salty-avatars' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy salty_avatars_update_own on storage.objects for update to authenticated
using (bucket_id = 'salty-avatars' and owner_id = auth.uid()::text)
with check (bucket_id = 'salty-avatars' and owner_id = auth.uid()::text);
create policy salty_avatars_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'salty-avatars' and owner_id = auth.uid()::text);

commit;

select 'Salty profile migration complete' as result;
