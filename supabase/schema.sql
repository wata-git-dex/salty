-- Salty — complete initial database schema
-- Run this entire file once in the Supabase SQL Editor before testing the app.

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- Reference tables must exist before profiles can reference them.
create table public.regions (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  nickname text check (nickname is null or char_length(trim(nickname)) between 1 and 50),
  phone text,
  home_region uuid references public.regions(id),
  sponsors text[] not null default '{}',
  social_url text,
  avatar_path text,
  onboarding_complete boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.spots (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  general_location text check (general_location is null or char_length(trim(general_location)) between 1 and 160),
  region_id uuid references public.regions(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index spots_name_location_region_key
  on public.spots (region_id, lower(name), lower(coalesce(general_location, '')));

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  author uuid references public.profiles(id) on delete cascade not null,
  spot_id uuid references public.spots(id),
  region_id uuid references public.regions(id) not null,
  when_label text,
  surf_time timestamptz,
  author_role text not null default 'surf' check (author_role in ('surf','film')),
  featured_surfer_name text,
  featured_surfer_user uuid references public.profiles(id),
  participant_names text[] not null default '{}',
  wants_filmer boolean not null default false,
  note text,
  status text not null default 'active' check (status in ('active','ended','archived')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  points_awarded_at timestamptz,
  check ((status = 'active' and ended_at is null) or status <> 'active')
);

create table public.session_rsvps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text not null check (role in ('surf','film')),
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author uuid references public.profiles(id) on delete cascade not null,
  media_url text not null,
  media_path text not null,
  media_type text not null check (media_type in ('clip','photo')),
  filmer_name text not null check (char_length(trim(filmer_name)) > 0),
  filmer_user uuid references public.profiles(id),
  surfer_name text,
  board text,
  spot_id uuid references public.spots(id),
  caption text,
  created_at timestamptz not null default now()
);

create table public.post_tags (
  post_id uuid references public.posts(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text not null check (role in ('surfer','filmer','shaper')),
  primary key (post_id, user_id, role)
);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade not null,
  author uuid references public.profiles(id) on delete cascade not null,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table public.post_likes (
  post_id uuid references public.posts(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  primary key (post_id, user_id)
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_a uuid references public.profiles(id) on delete cascade not null,
  user_b uuid references public.profiles(id) on delete cascade not null,
  source text not null check (source in ('rsvp','tag','dm')),
  created_at timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);

create table public.room_messages (
  id uuid primary key default gen_random_uuid(),
  region_id uuid references public.regions(id) on delete cascade not null,
  author uuid references public.profiles(id) on delete cascade not null,
  body text check (body is null or char_length(trim(body)) between 1 and 2000),
  attachment_path text,
  attachment_type text check (attachment_type is null or attachment_type in ('image/jpeg','image/png','image/webp','image/gif')),
  attachment_name text,
  attachment_size int check (attachment_size is null or attachment_size between 1 and 10485760),
  created_at timestamptz not null default now(),
  check (nullif(trim(body), '') is not null or attachment_path is not null),
  check ((attachment_path is null and attachment_type is null and attachment_name is null and attachment_size is null)
      or (attachment_path is not null and attachment_type is not null and attachment_size is not null))
);

create table public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid references public.profiles(id) on delete cascade not null,
  recipient uuid references public.profiles(id) on delete cascade not null,
  body text check (body is null or char_length(trim(body)) between 1 and 2000),
  attachment_path text,
  attachment_type text check (attachment_type is null or attachment_type in ('image/jpeg','image/png','image/webp','image/gif')),
  attachment_name text,
  attachment_size int check (attachment_size is null or attachment_size between 1 and 10485760),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender <> recipient),
  check (attachment_path is null and attachment_type is null and attachment_name is null and attachment_size is null),
  check (nullif(trim(body), '') is not null or attachment_path is not null),
  check ((attachment_path is null and attachment_type is null and attachment_name is null and attachment_size is null)
      or (attachment_path is not null and attachment_type is not null and attachment_size is not null))
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  author uuid references public.profiles(id) on delete cascade not null,
  region_id uuid references public.regions(id) on delete cascade not null,
  title text not null,
  spot_id uuid references public.spots(id),
  start_time timestamptz,
  end_time timestamptz,
  venue_name text,
  location_text text,
  description text,
  created_at timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time > start_time)
);

create table public.event_rsvps (
  event_id uuid references public.events(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.points_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  action text not null check (action in ('post_session','rsvp','post_clip','comment','attend_event','daily_active')),
  points int not null check (points > 0),
  source_id uuid,
  created_at timestamptz not null default now()
);

create unique index points_once_per_source
  on public.points_events (user_id, action, source_id)
  where source_id is not null;

create unique index one_daily_active_per_user
  on public.points_events (user_id, action, ((created_at at time zone 'UTC')::date))
  where action = 'daily_active';

create table public.streaks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_active_date date,
  current_streak int not null default 0 check (current_streak >= 0)
);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  master_enabled boolean not null default true,
  new_sessions boolean not null default true,
  new_stoke boolean not null default true,
  direct_messages boolean not null default true,
  events boolean not null default true,
  session_updates boolean not null default true,
  community_chat boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  recipient uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('new_session','new_stoke','direct_message','event','session_update','community_chat')),
  title text not null,
  body text not null,
  url text not null default './',
  source_id uuid,
  delivered_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index notification_queue_recipient_idx on public.notification_queue(recipient, created_at desc);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  points_cost int not null check (points_cost >= 0),
  type text not null check (type in ('discount','physical','entry')),
  brand_name text,
  offer_text text,
  description text,
  discount_code text,
  store_url text,
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  reward_id uuid references public.rewards(id) on delete cascade not null,
  status text not null default 'claimed' check (status in ('claimed','fulfilled','cancelled')),
  created_at timestamptz not null default now()
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  created_by uuid references public.profiles(id) on delete set null,
  max_uses int not null default 1 check (max_uses > 0),
  use_count int not null default 0 check (use_count >= 0 and use_count <= max_uses),
  used_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.mutes (
  muter uuid references public.profiles(id) on delete cascade not null,
  muted uuid references public.profiles(id) on delete cascade not null,
  primary key (muter, muted),
  check (muter <> muted)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid references public.profiles(id) on delete cascade not null,
  target_type text not null check (target_type in ('post','profile','message','event')),
  target_id uuid not null,
  reason text not null check (char_length(trim(reason)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table public.beta_issue_reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('broken','confusing','suggestion','other')),
  description text not null check (char_length(trim(description)) between 1 and 2000),
  expected_behavior text check (expected_behavior is null or char_length(trim(expected_behavior)) between 1 and 2000),
  screen text check (screen is null or char_length(screen) <= 120),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  user_agent text check (user_agent is null or char_length(user_agent) <= 1000),
  screenshot_path text check (screenshot_path is null or split_part(screenshot_path, '/', 1) = reporter::text),
  status text not null default 'new' check (status in ('new','reviewing','fixed','closed')),
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index beta_issue_reports_status_created_idx on public.beta_issue_reports (status, created_at desc);
create index beta_issue_reports_reporter_created_idx on public.beta_issue_reports (reporter, created_at desc);

insert into public.regions (name) values ('California'),('France'),('Germany'),('Utah')
on conflict (name) do nothing;

insert into public.brands (name) values ('Sodium'),('Salty Viewfinder'),('WATA'),('Snake Eyes')
on conflict (name) do nothing;

insert into public.rewards (name, points_cost, type, brand_name, offer_text, description, store_url, sort_order) values
  ('Saltyviewfinder Store Discount', 0, 'discount', 'Saltyviewfinder', 'Salty member discount', 'Sodium merch, prints, and more.', 'https://saltyviewfinder.com', 10),
  ('WATA Store Discount', 0, 'discount', 'WATA', 'Salty member discount', 'Support WATA and save on store gear.', 'https://cleanwata.org', 20);

-- One multi-use bootstrap invite. The final SELECT prints it after the transaction.
insert into public.invites (code, max_uses)
values ('SALTY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), 25);

-- Membership helpers. SECURITY DEFINER avoids recursive RLS checks.
create or replace function public.is_member(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = uid) $$;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = uid and is_admin) $$;

create or replace function public.invite_is_valid(invite_code text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.invites
    where upper(code) = upper(trim(invite_code))
      and revoked_at is null
      and (expires_at is null or expires_at > now())
      and use_count < max_uses
  )
$$;

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
  if resolved_name is null then raise exception 'A profile name is required'; end if;

  select id into region_uuid from public.regions
   where lower(name) = lower(coalesce(profile_region, auth.jwt() -> 'user_metadata' ->> 'home_region', 'California'))
   limit 1;

  insert into public.profiles (id, name, phone, home_region)
  values (auth.uid(), resolved_name, resolved_phone, region_uuid)
  returning * into result;

  update public.invites
     set use_count = use_count + 1,
         used_by = case when max_uses = 1 then auth.uid() else used_by end
   where id = invite_row.id;

  return result;
end $$;

create or replace function public.create_invite(invite_max_uses int default 1)
returns text language plpgsql security definer set search_path = public
as $$
declare new_code text;
begin
  if not public.is_member() then raise exception 'Community membership required'; end if;
  if invite_max_uses < 1 or invite_max_uses > 25 then raise exception 'max uses must be between 1 and 25'; end if;
  new_code := 'SALTY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.invites (code, created_by, max_uses) values (new_code, auth.uid(), invite_max_uses);
  return new_code;
end $$;

create or replace function public.upsert_connection(first_user uuid, second_user uuid, connection_source text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if first_user is null or second_user is null or first_user = second_user then return; end if;
  insert into public.connections (user_a, user_b, source)
  values (least(first_user, second_user), greatest(first_user, second_user), connection_source)
  on conflict (user_a, user_b) do nothing;
end $$;

create or replace function public.connection_from_rsvp()
returns trigger language plpgsql security definer set search_path = public
as $$
declare session_author uuid;
begin
  select author into session_author from public.sessions where id = new.session_id;
  perform public.upsert_connection(session_author, new.user_id, 'rsvp');
  return new;
end $$;

create or replace function public.connection_from_tag()
returns trigger language plpgsql security definer set search_path = public
as $$
declare post_author uuid;
begin
  select author into post_author from public.posts where id = new.post_id;
  perform public.upsert_connection(post_author, new.user_id, 'tag');
  return new;
end $$;

create or replace function public.connection_from_dm()
returns trigger language plpgsql security definer set search_path = public
as $$ begin perform public.upsert_connection(new.sender, new.recipient, 'dm'); return new; end $$;

create trigger session_rsvp_connection after insert on public.session_rsvps
for each row execute function public.connection_from_rsvp();
create trigger post_tag_connection after insert on public.post_tags
for each row execute function public.connection_from_tag();
create trigger dm_connection after insert on public.dm_messages
for each row execute function public.connection_from_dm();

create or replace function public.record_activity(activity_user uuid, activity_action text, activity_points int, activity_source_id uuid default null)
returns void language plpgsql security definer set search_path = public
as $$
declare today date := (now() at time zone 'UTC')::date; inserted_count integer := 0;
begin
  insert into public.points_events (user_id, action, points, source_id)
  values (activity_user, activity_action, activity_points, activity_source_id)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return; end if;

  insert into public.points_events (user_id, action, points)
  values (activity_user, 'daily_active', 5)
  on conflict do nothing;

  insert into public.streaks (user_id, last_active_date, current_streak)
  values (activity_user, today, 1)
  on conflict (user_id) do update set
    current_streak = case
      when streaks.last_active_date = today then streaks.current_streak
      when streaks.last_active_date >= today - 7 then streaks.current_streak + 1
      else 1 end,
    last_active_date = today;
end $$;

create or replace function public.points_from_action()
returns trigger language plpgsql security definer set search_path = public
as $$
declare activity_user uuid; activity_action text; activity_points int; activity_source uuid;
begin
  case tg_table_name
    when 'posts' then activity_user := new.author; activity_action := 'post_clip'; activity_points := 15; activity_source := new.id;
    when 'post_comments' then activity_user := new.author; activity_action := 'comment'; activity_points := 3; activity_source := new.id;
    when 'event_rsvps' then activity_user := new.user_id; activity_action := 'attend_event'; activity_points := 10; activity_source := new.event_id;
    else return new;
  end case;
  perform public.record_activity(activity_user, activity_action, activity_points, activity_source);
  return new;
end $$;

create trigger points_post after insert on public.posts for each row execute function public.points_from_action();
create trigger points_comment after insert on public.post_comments for each row execute function public.points_from_action();
create trigger points_event_rsvp after insert on public.event_rsvps for each row execute function public.points_from_action();

create or replace function public.award_finished_surf()
returns trigger language plpgsql security definer set search_path = public
as $$
declare attendee record;
begin
  if tg_op = 'INSERT' then new.points_awarded_at := null; return new; end if;
  if new.status = 'ended' and old.status is distinct from 'ended' and old.points_awarded_at is null then
    new.points_awarded_at := now();
    perform public.record_activity(new.author, 'post_session', 10, new.id);
    for attendee in select user_id from public.session_rsvps where session_id = new.id loop
      perform public.record_activity(attendee.user_id, 'rsvp', 5, new.id);
    end loop;
  else
    new.points_awarded_at := old.points_awarded_at;
  end if;
  return new;
end $$;

create trigger award_finished_surf before insert or update on public.sessions
for each row execute function public.award_finished_surf();

create or replace function public.notification_allowed(target_user uuid, notification_kind text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.push_subscriptions s where s.user_id = target_user)
    and coalesce((select p.master_enabled from public.notification_preferences p where p.user_id = target_user), true)
    and case notification_kind
      when 'new_session' then coalesce((select p.new_sessions from public.notification_preferences p where p.user_id = target_user), true)
      when 'new_stoke' then coalesce((select p.new_stoke from public.notification_preferences p where p.user_id = target_user), true)
      when 'direct_message' then coalesce((select p.direct_messages from public.notification_preferences p where p.user_id = target_user), true)
      when 'event' then coalesce((select p.events from public.notification_preferences p where p.user_id = target_user), true)
      when 'session_update' then coalesce((select p.session_updates from public.notification_preferences p where p.user_id = target_user), true)
      when 'community_chat' then coalesce((select p.community_chat from public.notification_preferences p where p.user_id = target_user), false)
      else false end
$$;

create or replace function public.enqueue_notification(target_user uuid, notification_kind text, notification_title text,
  notification_body text, notification_url text, notification_source uuid default null)
returns void language plpgsql security definer set search_path = public
as $$ begin
  if target_user is not null and public.notification_allowed(target_user, notification_kind) then
    insert into public.notification_queue(recipient,kind,title,body,url,source_id)
    values(target_user,notification_kind,notification_title,notification_body,notification_url,notification_source);
  end if;
end $$;

create or replace function public.notify_new_session() returns trigger language plpgsql security definer set search_path = public
as $$ declare member record; author_name text; place_name text; begin
  select name into author_name from public.profiles where id=new.author;
  select name into place_name from public.spots where id=new.spot_id;
  for member in select id from public.profiles where onboarding_complete and home_region=new.region_id and id<>new.author loop
    perform public.enqueue_notification(member.id,'new_session','New surf',coalesce(author_name,'A friend')||' shared a surf'||case when place_name is null then '.' else ' at '||place_name||'.' end,'./?open=surfing',new.id);
  end loop; return new;
end $$;

create or replace function public.notify_new_stoke() returns trigger language plpgsql security definer set search_path = public
as $$ declare member record; author_name text; begin
  select name into author_name from public.profiles where id=new.author;
  for member in select id from public.profiles where onboarding_complete and id<>new.author loop
    perform public.enqueue_notification(member.id,'new_stoke','New Stoke',coalesce(author_name,'A friend')||' shared a '||case when new.media_type='clip' then 'clip.' else 'photo.' end,'./?open=feed',new.id);
  end loop; return new;
end $$;

create or replace function public.notify_new_dm() returns trigger language plpgsql security definer set search_path = public
as $$ declare sender_name text; begin
  select name into sender_name from public.profiles where id=new.sender;
  perform public.enqueue_notification(new.recipient,'direct_message',coalesce(sender_name,'A friend'),case when char_length(new.body)>120 then left(new.body,117)||'…' else new.body end,'./?open=dms',new.id);
  return new;
end $$;

create or replace function public.notify_new_event() returns trigger language plpgsql security definer set search_path = public
as $$ declare member record; begin
  for member in select id from public.profiles where onboarding_complete and home_region=new.region_id and id<>new.author loop
    perform public.enqueue_notification(member.id,'event','New event',new.title,'./?open=events',new.id);
  end loop; return new;
end $$;

create or replace function public.notify_new_room_message() returns trigger language plpgsql security definer set search_path = public
as $$ declare member record; author_name text; begin
  select name into author_name from public.profiles where id=new.author;
  for member in select id from public.profiles where onboarding_complete and home_region=new.region_id and id<>new.author loop
    perform public.enqueue_notification(member.id,'community_chat',coalesce(author_name,'Community Chat'),coalesce(case when char_length(new.body)>120 then left(new.body,117)||'…' else new.body end,'Shared a photo.'),'./?open=chat',new.id);
  end loop; return new;
end $$;

create or replace function public.notify_session_rsvp() returns trigger language plpgsql security definer set search_path = public
as $$ declare session_row public.sessions; member_name text; role_name text; selected_session uuid; selected_user uuid; begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  if tg_op='DELETE' then selected_session:=old.session_id; selected_user:=old.user_id; role_name:=old.role;
  else selected_session:=new.session_id; selected_user:=new.user_id; role_name:=new.role; end if;
  select * into session_row from public.sessions where id=selected_session;
  select name into member_name from public.profiles where id=selected_user;
  role_name:=case when role_name='film' then 'film' else 'surf' end;
  if session_row.author<>selected_user then
    perform public.enqueue_notification(session_row.author,'session_update','Surf RSVP',coalesce(member_name,'A friend')||case when tg_op='DELETE' then ' left your surf.' else ' is coming to '||role_name||'.' end,'./?open=surfing',session_row.id);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

create or replace function public.notify_session_change() returns trigger language plpgsql security definer set search_path = public
as $$ declare attendee record; author_name text; message text; selected_id uuid; selected_author uuid; begin
  if tg_op='DELETE' then selected_id:=old.id; selected_author:=old.author; else selected_id:=new.id; selected_author:=new.author; end if;
  select name into author_name from public.profiles where id=selected_author;
  if tg_op='DELETE' then message:=coalesce(author_name,'The organizer')||' cancelled a surf.';
  elsif new.status='ended' and old.status is distinct from 'ended' then message:=coalesce(author_name,'The organizer')||' marked the surf finished.';
  elsif new.when_label='Now' and old.when_label is distinct from 'Now' then message:=coalesce(author_name,'The organizer')||' started the surf.';
  else message:=coalesce(author_name,'The organizer')||' updated a surf.'; end if;
  for attendee in select user_id from public.session_rsvps where session_id=selected_id loop
    perform public.enqueue_notification(attendee.user_id,'session_update','Surf update',message,'./?open=surfing',selected_id);
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

create trigger notify_new_session after insert on public.sessions for each row execute function public.notify_new_session();
create trigger notify_new_stoke after insert on public.posts for each row execute function public.notify_new_stoke();
create trigger notify_new_dm after insert on public.dm_messages for each row execute function public.notify_new_dm();
create trigger notify_new_event after insert on public.events for each row execute function public.notify_new_event();
create trigger notify_new_room_message after insert on public.room_messages for each row execute function public.notify_new_room_message();
create trigger notify_session_rsvp after insert or delete on public.session_rsvps for each row execute function public.notify_session_rsvp();
create trigger notify_session_change after update of spot_id,when_label,surf_time,wants_filmer,status on public.sessions for each row execute function public.notify_session_change();
create trigger notify_session_delete before delete on public.sessions for each row execute function public.notify_session_change();

create or replace function public.mark_dm_read(other_user uuid)
returns void language sql security definer set search_path = public
as $$
  update public.dm_messages set read_at = now()
  where sender = other_user and recipient = auth.uid() and read_at is null;
$$;

-- Every table has RLS enabled. Policies use membership, ownership, and relationship checks.
alter table public.regions enable row level security;
alter table public.profiles enable row level security;
alter table public.spots enable row level security;
alter table public.brands enable row level security;
alter table public.sessions enable row level security;
alter table public.session_rsvps enable row level security;
alter table public.posts enable row level security;
alter table public.post_tags enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.connections enable row level security;
alter table public.room_messages enable row level security;
alter table public.dm_messages enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.points_events enable row level security;
alter table public.streaks enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_queue enable row level security;
alter table public.rewards enable row level security;
alter table public.reward_claims enable row level security;
alter table public.invites enable row level security;
alter table public.mutes enable row level security;
alter table public.reports enable row level security;
alter table public.beta_issue_reports enable row level security;

create policy regions_read on public.regions for select using (public.is_member());
create policy regions_admin_write on public.regions for all using (public.is_admin()) with check (public.is_admin());
create policy profiles_read on public.profiles for select using (public.is_member());
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and is_admin = public.is_admin());
create policy profiles_admin_delete on public.profiles for delete using (public.is_admin());
create policy spots_read on public.spots for select using (public.is_member());
create policy spots_insert on public.spots for insert with check (public.is_member() and created_by = auth.uid());
create policy spots_update_own on public.spots for update using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy spots_delete_own on public.spots for delete using (created_by = auth.uid() or public.is_admin());
create policy brands_read on public.brands for select using (public.is_member());
create policy brands_insert on public.brands for insert with check (public.is_member());
create policy brands_admin_change on public.brands for all using (public.is_admin()) with check (public.is_admin());
create policy sessions_read on public.sessions for select using (public.is_member());
create policy sessions_insert_own on public.sessions for insert with check (public.is_member() and author = auth.uid());
create policy sessions_update_own on public.sessions for update using (author = auth.uid()) with check (author = auth.uid());
create policy sessions_delete_own on public.sessions for delete using (author = auth.uid() or public.is_admin());
create policy session_rsvps_read on public.session_rsvps for select using (public.is_member());
create policy session_rsvps_insert_own on public.session_rsvps for insert with check (public.is_member() and user_id = auth.uid());
create policy session_rsvps_update_own on public.session_rsvps for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy session_rsvps_delete_own on public.session_rsvps for delete using (user_id = auth.uid());
create policy posts_read on public.posts for select using (public.is_member());
create policy posts_insert_own on public.posts for insert with check (public.is_member() and author = auth.uid());
create policy posts_update_own on public.posts for update using (author = auth.uid()) with check (author = auth.uid());
create policy posts_delete_own on public.posts for delete using (author = auth.uid() or public.is_admin());
create policy post_tags_read on public.post_tags for select using (public.is_member());
create policy post_tags_insert_by_post_author on public.post_tags for insert with check (exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid()));
create policy post_tags_delete_by_post_author on public.post_tags for delete using (exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid()));
create policy comments_read on public.post_comments for select using (public.is_member());
create policy comments_insert_own on public.post_comments for insert with check (public.is_member() and author = auth.uid());
create policy comments_update_own on public.post_comments for update using (author = auth.uid()) with check (author = auth.uid());
create policy comments_delete_own on public.post_comments for delete using (author = auth.uid() or public.is_admin());
create policy likes_read on public.post_likes for select using (public.is_member());
create policy likes_insert_own on public.post_likes for insert with check (public.is_member() and user_id = auth.uid());
create policy likes_delete_own on public.post_likes for delete using (user_id = auth.uid());
create policy connections_read_parties on public.connections for select using (public.is_member() and auth.uid() in (user_a, user_b));
create policy room_messages_read on public.room_messages for select using (public.is_member());
create policy room_messages_insert_own on public.room_messages for insert with check (
  public.is_member() and author = auth.uid()
  and (attachment_path is null or split_part(attachment_path, '/', 1) = auth.uid()::text)
);
create policy room_messages_update_own on public.room_messages for update using (author = auth.uid()) with check (author = auth.uid());
create policy room_messages_delete_own on public.room_messages for delete using (author = auth.uid() or public.is_admin());
create policy dms_read_parties on public.dm_messages for select using (public.is_member() and auth.uid() in (sender, recipient));
create policy dms_insert_sender on public.dm_messages for insert with check (
  public.is_member() and sender = auth.uid()
  and (attachment_path is null or split_part(attachment_path, '/', 1) = auth.uid()::text)
);
create policy dms_delete_sender on public.dm_messages for delete using (sender = auth.uid());
create policy events_read on public.events for select using (public.is_member());
create policy events_insert_own on public.events for insert with check (public.is_member() and author = auth.uid());
create policy events_update_own on public.events for update using (author = auth.uid()) with check (author = auth.uid());
create policy events_delete_own on public.events for delete using (author = auth.uid() or public.is_admin());
create policy event_rsvps_read on public.event_rsvps for select using (public.is_member());
create policy event_rsvps_insert_own on public.event_rsvps for insert with check (public.is_member() and user_id = auth.uid());
create policy event_rsvps_delete_own on public.event_rsvps for delete using (user_id = auth.uid());
create policy points_read_own on public.points_events for select using (user_id = auth.uid() or public.is_admin());
create policy streaks_read_members on public.streaks for select using (public.is_member());
create policy notification_preferences_own on public.notification_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_own on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notification_queue_read_own on public.notification_queue for select using (recipient = auth.uid());
create policy rewards_read on public.rewards for select using (public.is_member());
create policy rewards_admin_write on public.rewards for all using (public.is_admin()) with check (public.is_admin());
create policy reward_claims_read_own on public.reward_claims for select using (user_id = auth.uid() or public.is_admin());
create policy reward_claims_insert_own on public.reward_claims for insert with check (public.is_member() and user_id = auth.uid());
create policy reward_claims_admin_update on public.reward_claims for update using (public.is_admin()) with check (public.is_admin());
create policy invites_read_creator on public.invites for select using (created_by = auth.uid() or used_by = auth.uid() or public.is_admin());
create policy mutes_read_own on public.mutes for select using (muter = auth.uid());
create policy mutes_insert_own on public.mutes for insert with check (public.is_member() and muter = auth.uid());
create policy mutes_delete_own on public.mutes for delete using (muter = auth.uid());
create policy reports_insert_own on public.reports for insert with check (public.is_member() and reporter = auth.uid());
create policy reports_read_admin on public.reports for select using (public.is_admin());
create policy reports_update_admin on public.reports for update using (public.is_admin()) with check (public.is_admin());
create policy beta_issue_reports_insert_own on public.beta_issue_reports for insert to authenticated with check (public.is_member() and reporter = auth.uid());
create policy beta_issue_reports_read_own_or_admin on public.beta_issue_reports for select to authenticated using (reporter = auth.uid() or public.is_admin());
create policy beta_issue_reports_update_admin on public.beta_issue_reports for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy beta_issue_reports_delete_admin on public.beta_issue_reports for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.beta_issue_reports to authenticated;

grant execute on function public.invite_is_valid(text) to anon, authenticated;
grant execute on function public.redeem_invite(text,text,text,text) to authenticated;
grant execute on function public.create_invite(int) to authenticated;
grant execute on function public.is_member(uuid), public.is_admin(uuid) to anon, authenticated;
revoke all on function public.mark_dm_read(uuid) from public, anon;
grant execute on function public.mark_dm_read(uuid) to authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notification_queue to authenticated;
revoke execute on function public.upsert_connection(uuid,uuid,text), public.record_activity(uuid,text,int,uuid), public.award_finished_surf(),
  public.notification_allowed(uuid,text), public.enqueue_notification(uuid,text,text,text,text,uuid),
  public.notify_new_session(), public.notify_new_stoke(), public.notify_new_dm(), public.notify_new_event(),
  public.notify_new_room_message(), public.notify_session_rsvp(), public.notify_session_change()
  from public, anon, authenticated;
revoke update on public.dm_messages from authenticated;

-- Media bucket and ownership-scoped writes. Public URLs are intentional because the feed is community-global.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('salty-media', 'salty-media', true, 52428800, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Legacy private-DM bucket retained for safe schema upgrades. DMs are text-only;
-- room photos use the private salty-chat bucket below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('salty-dm', 'salty-dm', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('salty-chat', 'salty-chat', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Member-only profile images, 8 MB max.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('salty-avatars', 'salty-avatars', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Private beta screenshots, visible only to their reporter and Salty admins.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('salty-feedback', 'salty-feedback', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy salty_media_read on storage.objects for select using (bucket_id = 'salty-media');
create policy salty_media_insert on storage.objects for insert to authenticated
with check (bucket_id = 'salty-media' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy salty_media_update on storage.objects for update to authenticated
using (bucket_id = 'salty-media' and owner_id = auth.uid()::text)
with check (bucket_id = 'salty-media' and owner_id = auth.uid()::text);
create policy salty_media_delete on storage.objects for delete to authenticated
using (bucket_id = 'salty-media' and owner_id = auth.uid()::text);

create policy salty_dm_read_parties on storage.objects for select to authenticated
using (
  bucket_id = 'salty-dm' and exists (
    select 1 from public.dm_messages message
    where message.attachment_path = name and auth.uid() in (message.sender, message.recipient)
  )
);
create policy salty_dm_delete_sender on storage.objects for delete to authenticated
using (bucket_id = 'salty-dm' and owner_id = auth.uid()::text);

create policy salty_chat_read on storage.objects for select to authenticated
using (bucket_id = 'salty-chat' and public.is_member());
create policy salty_chat_insert on storage.objects for insert to authenticated
with check (bucket_id = 'salty-chat' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy salty_chat_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'salty-chat' and owner_id = auth.uid()::text);

create policy salty_avatars_read_members on storage.objects for select to authenticated
using (bucket_id = 'salty-avatars' and public.is_member());
create policy salty_avatars_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'salty-avatars' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy salty_avatars_update_own on storage.objects for update to authenticated
using (bucket_id = 'salty-avatars' and owner_id = auth.uid()::text)
with check (bucket_id = 'salty-avatars' and owner_id = auth.uid()::text);
create policy salty_avatars_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'salty-avatars' and owner_id = auth.uid()::text);

create policy salty_feedback_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'salty-feedback' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy salty_feedback_read_own_or_admin on storage.objects for select to authenticated
using (bucket_id = 'salty-feedback' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy salty_feedback_delete_own_or_admin on storage.objects for delete to authenticated
using (bucket_id = 'salty-feedback' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Realtime tables used by the later chat phase and live core/feed refreshes.
alter publication supabase_realtime add table public.sessions, public.session_rsvps, public.posts, public.post_comments, public.post_likes, public.room_messages, public.dm_messages;

-- Nightly stale-session safety net. Unschedule an old Salty job if this script is adapted/re-run.
select cron.schedule(
  'salty-nightly-session-archive',
  '15 3 * * *',
  $$update public.sessions
      set status = 'archived', ended_at = coalesce(ended_at, now())
    where status = 'active'
      and ((surf_time is null and created_at < now() - interval '18 hours')
        or (surf_time is not null and surf_time < now() - interval '18 hours'))$$
);

commit;

-- Copy this generated value: it is the first invite code for phone testing.
select code as bootstrap_invite_code, max_uses
from public.invites
where created_by is null
order by created_at desc
limit 1;
