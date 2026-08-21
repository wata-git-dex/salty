-- Salty locations + travel memberships + profile participation stats
-- Run once in the Supabase SQL Editor after the existing schema/migrations.

begin;

alter table public.regions add column if not exists location_scope text;
alter table public.regions add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.regions add column if not exists is_active boolean not null default false;

update public.regions
set location_scope = case when name in ('California', 'Utah') then 'state' else 'country' end
where location_scope is null;

alter table public.regions alter column location_scope set default 'country';
alter table public.regions alter column location_scope set not null;
alter table public.regions drop constraint if exists regions_location_scope_check;
alter table public.regions add constraint regions_location_scope_check
  check (location_scope in ('state', 'country'));

create unique index if not exists regions_name_lower_key on public.regions (lower(name));

create table if not exists public.region_memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  region_id uuid not null references public.regions(id) on delete cascade,
  is_home boolean not null default false,
  notifications_enabled boolean not null default true,
  joined_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  primary key (user_id, region_id)
);

create unique index if not exists region_memberships_one_home_per_user
  on public.region_memberships (user_id) where is_home;
create index if not exists region_memberships_region_idx
  on public.region_memberships (region_id, notifications_enabled);

insert into public.region_memberships (user_id, region_id, is_home)
select id, home_region, true from public.profiles where home_region is not null
on conflict (user_id, region_id) do update set is_home = true;

update public.regions region
set is_active = exists (
  select 1 from public.region_memberships membership where membership.region_id = region.id
);

create or replace function public.sync_home_location_membership()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.home_region is null then return new; end if;
  update public.region_memberships set is_home = false
    where user_id = new.id and region_id <> new.home_region and is_home;
  insert into public.region_memberships (user_id, region_id, is_home, notifications_enabled, last_viewed_at)
  values (new.id, new.home_region, true, true, now())
  on conflict (user_id, region_id) do update
    set is_home = true, notifications_enabled = true, last_viewed_at = now();
  update public.regions set is_active = true where id = new.home_region;
  return new;
end $$;

drop trigger if exists sync_home_location_membership on public.profiles;
create trigger sync_home_location_membership
after insert or update of home_region on public.profiles
for each row execute function public.sync_home_location_membership();

create or replace function public.create_or_join_location(
  location_name text,
  location_scope text default 'country'
) returns public.regions
language plpgsql security definer set search_path = public
as $$
declare
  clean_name text;
  result public.regions;
begin
  if not public.is_member() then raise exception 'Community membership required'; end if;
  clean_name := regexp_replace(trim(location_name), '\s+', ' ', 'g');
  if char_length(clean_name) < 2 or char_length(clean_name) > 80 then
    raise exception 'Location names must be between 2 and 80 characters';
  end if;
  if location_scope not in ('state', 'country') then
    raise exception 'Choose state or country';
  end if;

  select * into result from public.regions where lower(name) = lower(clean_name) limit 1;
  if not found then
    begin
      insert into public.regions (name, location_scope, created_by, is_active)
      values (clean_name, location_scope, auth.uid(), true)
      returning * into result;
    exception when unique_violation then
      select * into result from public.regions where lower(name) = lower(clean_name) limit 1;
    end;
  else
    update public.regions set is_active = true where id = result.id returning * into result;
  end if;

  insert into public.region_memberships (user_id, region_id, notifications_enabled, last_viewed_at)
  values (auth.uid(), result.id, true, now())
  on conflict (user_id, region_id) do update
    set notifications_enabled = true, last_viewed_at = now();
  return result;
end $$;

create or replace function public.join_location(location_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_member() then raise exception 'Community membership required'; end if;
  if not exists (select 1 from public.regions where id = location_id and is_active) then
    raise exception 'Location not found';
  end if;
  insert into public.region_memberships (user_id, region_id, notifications_enabled, last_viewed_at)
  values (auth.uid(), location_id, true, now())
  on conflict (user_id, region_id) do update
    set notifications_enabled = true, last_viewed_at = now();
end $$;

create or replace function public.set_home_location(location_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_member() then raise exception 'Community membership required'; end if;
  if not exists (select 1 from public.regions where id = location_id and is_active) then
    raise exception 'Location not found';
  end if;
  update public.profiles set home_region = location_id where id = auth.uid();
end $$;

create or replace function public.get_profile_participation_stats(target_user uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_member() then raise exception 'Community membership required'; end if;
  with completed as (
    select id, author, author_role, region_id
    from public.sessions
    where points_awarded_at is not null
  ), participation as (
    select id as session_id, author as user_id, author_role as role, region_id from completed
    union
    select session.id, rsvp.user_id, rsvp.role, session.region_id
    from completed session
    join public.session_rsvps rsvp on rsvp.session_id = session.id
  )
  select jsonb_build_object(
    'surfed', (select count(distinct session_id) from participation where user_id = target_user and role = 'surf'),
    'filmed', (select count(distinct session_id) from participation where user_id = target_user and role = 'film'),
    'organized', (select count(*) from completed where author = target_user),
    'stoke', (select count(*) from public.posts where author = target_user),
    'locations', (select count(distinct region_id) from participation where user_id = target_user and role = 'surf')
  ) into result;
  return result;
end $$;

alter table public.invites add column if not exists region_id uuid references public.regions(id) on delete set null;

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
  new_code := 'SALTY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.invites (code, created_by, max_uses, region_id)
  values (new_code, auth.uid(), invite_max_uses, invite_region);
  return new_code;
end $$;

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

  insert into public.profiles (id, name, phone, home_region)
  values (auth.uid(), resolved_name, resolved_phone, region_uuid)
  returning * into result;

  if invite_row.region_id is not null then
    insert into public.region_memberships (user_id, region_id, notifications_enabled)
    values (auth.uid(), invite_row.region_id, true)
    on conflict (user_id, region_id) do update set notifications_enabled = true;
  end if;

  update public.invites
     set use_count = use_count + 1,
         used_by = case when max_uses = 1 then auth.uid() else used_by end
   where id = invite_row.id;
  return result;
end $$;

create or replace function public.region_notification_members(target_region uuid)
returns table(user_id uuid) language sql stable security definer set search_path = public
as $$
  select profile.id
  from public.profiles profile
  join public.region_memberships membership on membership.user_id = profile.id
  where profile.onboarding_complete
    and membership.region_id = target_region
    and membership.notifications_enabled
$$;

create or replace function public.notify_new_session()
returns trigger language plpgsql security definer set search_path = public
as $$
declare member record; author_name text; place_name text;
begin
  select name into author_name from public.profiles where id = new.author;
  select name into place_name from public.spots where id = new.spot_id;
  for member in select user_id from public.region_notification_members(new.region_id) where user_id <> new.author loop
    perform public.enqueue_notification(member.user_id, 'new_session', 'New surf',
      coalesce(author_name, 'A friend') || ' shared a surf' || case when place_name is null then '.' else ' at ' || place_name || '.' end,
      './?open=surfing', new.id);
  end loop;
  return new;
end $$;

create or replace function public.notify_new_event()
returns trigger language plpgsql security definer set search_path = public
as $$
declare member record;
begin
  for member in select user_id from public.region_notification_members(new.region_id) where user_id <> new.author loop
    perform public.enqueue_notification(member.user_id, 'event', 'New event', new.title, './?open=events', new.id);
  end loop;
  return new;
end $$;

create or replace function public.notify_new_room_message()
returns trigger language plpgsql security definer set search_path = public
as $$
declare member record; author_name text;
begin
  select name into author_name from public.profiles where id = new.author;
  for member in select user_id from public.region_notification_members(new.region_id) where user_id <> new.author loop
    perform public.enqueue_notification(member.user_id, 'community_chat', coalesce(author_name, 'Community Chat'),
      coalesce(case when char_length(new.body) > 120 then left(new.body, 117) || '...' else new.body end, 'Shared a photo.'),
      './?open=chat', new.id);
  end loop;
  return new;
end $$;

alter table public.region_memberships enable row level security;
drop policy if exists region_memberships_read_own on public.region_memberships;
drop policy if exists region_memberships_insert_own on public.region_memberships;
drop policy if exists region_memberships_update_own on public.region_memberships;
drop policy if exists region_memberships_delete_own on public.region_memberships;
create policy region_memberships_read_own on public.region_memberships for select using (user_id = auth.uid());
create policy region_memberships_insert_own on public.region_memberships for insert with check (user_id = auth.uid());
create policy region_memberships_update_own on public.region_memberships for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy region_memberships_delete_own on public.region_memberships for delete using (user_id = auth.uid() and not is_home);

grant select, insert, update, delete on public.region_memberships to authenticated;
grant execute on function public.create_or_join_location(text,text) to authenticated;
grant execute on function public.join_location(uuid) to authenticated;
grant execute on function public.set_home_location(uuid) to authenticated;
grant execute on function public.get_profile_participation_stats(uuid) to authenticated;
grant execute on function public.create_invite(int,uuid) to authenticated;
grant execute on function public.redeem_invite(text,text,text,text) to authenticated;
revoke execute on function public.region_notification_members(uuid), public.sync_home_location_membership() from public, anon, authenticated;

commit;

select 'Salty location memberships migration complete' as result;
