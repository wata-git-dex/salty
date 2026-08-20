-- Salty v36: iPhone/web push preferences + abuse-resistant surf points.
-- Run once after the earlier Salty migrations.

begin;

-- POINTS ---------------------------------------------------------------------

alter table public.sessions add column if not exists points_awarded_at timestamptz;
alter table public.points_events add column if not exists source_id uuid;

create unique index if not exists points_once_per_source
  on public.points_events (user_id, action, source_id)
  where source_id is not null;

-- Sessions already in production received their organizer/RSVP points under the
-- old create/join rules. Mark them so finishing one cannot pay the same points twice.
update public.sessions set points_awarded_at = coalesce(points_awarded_at, created_at);

drop trigger if exists points_session on public.sessions;
drop trigger if exists points_rsvp on public.session_rsvps;
drop function if exists public.record_activity(uuid,text,int);

create or replace function public.record_activity(
  activity_user uuid,
  activity_action text,
  activity_points int,
  activity_source_id uuid default null
) returns void language plpgsql security definer set search_path = public
as $$
declare
  today date := (now() at time zone 'UTC')::date;
  inserted_count integer := 0;
begin
  insert into public.points_events (user_id, action, points, source_id)
  values (activity_user, activity_action, activity_points, activity_source_id)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;

  -- A duplicate source never pays twice and does not advance activity/streaks.
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

create or replace function public.award_finished_surf()
returns trigger language plpgsql security definer set search_path = public
as $$
declare attendee record;
begin
  if tg_op = 'INSERT' then
    new.points_awarded_at := null;
    return new;
  end if;

  if new.status = 'ended' and old.status is distinct from 'ended' and old.points_awarded_at is null then
    new.points_awarded_at := now();
    perform public.record_activity(new.author, 'post_session', 10, new.id);
    for attendee in select user_id from public.session_rsvps where session_id = new.id loop
      perform public.record_activity(attendee.user_id, 'rsvp', 5, new.id);
    end loop;
  else
    -- Clients cannot manufacture, clear, or move the one-time award marker.
    new.points_awarded_at := old.points_awarded_at;
  end if;
  return new;
end $$;

drop trigger if exists award_finished_surf on public.sessions;
create trigger award_finished_surf
before insert or update on public.sessions
for each row execute function public.award_finished_surf();

revoke execute on function public.record_activity(uuid,text,int,uuid), public.award_finished_surf() from public, anon, authenticated;

-- PUSH SUBSCRIPTIONS + PREFERENCES ------------------------------------------

create table if not exists public.notification_preferences (
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

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table if not exists public.notification_queue (
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
create index if not exists notification_queue_recipient_idx on public.notification_queue(recipient, created_at desc);

alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_queue enable row level security;

drop policy if exists notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own on public.notification_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notification_queue_read_own on public.notification_queue;
create policy notification_queue_read_own on public.notification_queue for select
  using (recipient = auth.uid());

grant select, insert, update, delete on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notification_queue to authenticated;

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

create or replace function public.enqueue_notification(
  target_user uuid, notification_kind text, notification_title text,
  notification_body text, notification_url text, notification_source uuid default null
) returns void language plpgsql security definer set search_path = public
as $$
begin
  if target_user is not null and public.notification_allowed(target_user, notification_kind) then
    insert into public.notification_queue(recipient, kind, title, body, url, source_id)
    values (target_user, notification_kind, notification_title, notification_body, notification_url, notification_source);
  end if;
end $$;

create or replace function public.notify_new_session()
returns trigger language plpgsql security definer set search_path = public
as $$
declare member record; author_name text; place_name text;
begin
  select name into author_name from public.profiles where id = new.author;
  select name into place_name from public.spots where id = new.spot_id;
  for member in select id from public.profiles where onboarding_complete and home_region = new.region_id and id <> new.author loop
    perform public.enqueue_notification(member.id, 'new_session', 'New surf',
      coalesce(author_name, 'A friend') || ' shared a surf' || case when place_name is null then '.' else ' at ' || place_name || '.' end,
      './?open=surfing', new.id);
  end loop;
  return new;
end $$;

create or replace function public.notify_new_stoke()
returns trigger language plpgsql security definer set search_path = public
as $$
declare member record; author_name text;
begin
  select name into author_name from public.profiles where id = new.author;
  for member in select id from public.profiles where onboarding_complete and id <> new.author loop
    perform public.enqueue_notification(member.id, 'new_stoke', 'New Stoke',
      coalesce(author_name, 'A friend') || ' shared a ' || case when new.media_type = 'clip' then 'clip.' else 'photo.' end,
      './?open=feed', new.id);
  end loop;
  return new;
end $$;

create or replace function public.notify_new_dm()
returns trigger language plpgsql security definer set search_path = public
as $$
declare sender_name text;
begin
  select name into sender_name from public.profiles where id = new.sender;
  perform public.enqueue_notification(new.recipient, 'direct_message', coalesce(sender_name, 'A friend'),
    case when char_length(new.body) > 120 then left(new.body, 117) || '…' else new.body end,
    './?open=dms', new.id);
  return new;
end $$;

create or replace function public.notify_new_event()
returns trigger language plpgsql security definer set search_path = public
as $$
declare member record;
begin
  for member in select id from public.profiles where onboarding_complete and home_region = new.region_id and id <> new.author loop
    perform public.enqueue_notification(member.id, 'event', 'New event', new.title, './?open=events', new.id);
  end loop;
  return new;
end $$;

create or replace function public.notify_new_room_message()
returns trigger language plpgsql security definer set search_path = public
as $$
declare member record; author_name text;
begin
  select name into author_name from public.profiles where id = new.author;
  for member in select id from public.profiles where onboarding_complete and home_region = new.region_id and id <> new.author loop
    perform public.enqueue_notification(member.id, 'community_chat', coalesce(author_name, 'Community Chat'),
      coalesce(case when char_length(new.body) > 120 then left(new.body, 117) || '…' else new.body end, 'Shared a photo.'),
      './?open=chat', new.id);
  end loop;
  return new;
end $$;

create or replace function public.notify_session_rsvp()
returns trigger language plpgsql security definer set search_path = public
as $$
declare session_row public.sessions; member_name text; role_name text; selected_session uuid; selected_user uuid;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if tg_op = 'DELETE' then selected_session := old.session_id; selected_user := old.user_id; role_name := old.role;
  else selected_session := new.session_id; selected_user := new.user_id; role_name := new.role; end if;
  select * into session_row from public.sessions where id = selected_session;
  select name into member_name from public.profiles where id = selected_user;
  role_name := case when role_name = 'film' then 'film' else 'surf' end;
  if session_row.author <> selected_user then
    perform public.enqueue_notification(session_row.author, 'session_update', 'Surf RSVP',
      coalesce(member_name, 'A friend') || case when tg_op = 'DELETE' then ' left your surf.' else ' is coming to ' || role_name || '.' end,
      './?open=surfing', session_row.id);
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

create or replace function public.notify_session_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare attendee record; author_name text; message text; selected_id uuid; selected_author uuid;
begin
  if tg_op = 'DELETE' then selected_id := old.id; selected_author := old.author;
  else selected_id := new.id; selected_author := new.author; end if;
  select name into author_name from public.profiles where id = selected_author;
  if tg_op = 'DELETE' then message := coalesce(author_name, 'The organizer') || ' cancelled a surf.';
  elsif new.status = 'ended' and old.status is distinct from 'ended' then message := coalesce(author_name, 'The organizer') || ' marked the surf finished.';
  elsif new.when_label = 'Now' and old.when_label is distinct from 'Now' then message := coalesce(author_name, 'The organizer') || ' started the surf.';
  else message := coalesce(author_name, 'The organizer') || ' updated a surf.';
  end if;
  for attendee in select user_id from public.session_rsvps where session_id = selected_id loop
    perform public.enqueue_notification(attendee.user_id, 'session_update', 'Surf update', message, './?open=surfing', selected_id);
  end loop;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists notify_new_session on public.sessions;
create trigger notify_new_session after insert on public.sessions for each row execute function public.notify_new_session();
drop trigger if exists notify_new_stoke on public.posts;
create trigger notify_new_stoke after insert on public.posts for each row execute function public.notify_new_stoke();
drop trigger if exists notify_new_dm on public.dm_messages;
create trigger notify_new_dm after insert on public.dm_messages for each row execute function public.notify_new_dm();
drop trigger if exists notify_new_event on public.events;
create trigger notify_new_event after insert on public.events for each row execute function public.notify_new_event();
drop trigger if exists notify_new_room_message on public.room_messages;
create trigger notify_new_room_message after insert on public.room_messages for each row execute function public.notify_new_room_message();
drop trigger if exists notify_session_rsvp on public.session_rsvps;
create trigger notify_session_rsvp after insert or delete on public.session_rsvps for each row execute function public.notify_session_rsvp();
drop trigger if exists notify_session_change on public.sessions;
drop trigger if exists notify_session_delete on public.sessions;
create trigger notify_session_change after update of spot_id, when_label, surf_time, wants_filmer, status on public.sessions
for each row execute function public.notify_session_change();
create trigger notify_session_delete before delete on public.sessions
for each row execute function public.notify_session_change();

revoke execute on function public.notification_allowed(uuid,text), public.enqueue_notification(uuid,text,text,text,text,uuid),
  public.notify_new_session(), public.notify_new_stoke(), public.notify_new_dm(), public.notify_new_event(),
  public.notify_new_room_message(), public.notify_session_rsvp(), public.notify_session_change()
  from public, anon, authenticated;

commit;

select 'Salty push + points migration complete' as result;
