-- Sodium v1.117: linked session crew, lifecycle notifications, and active-surf reminders.
-- Additive and data-preserving. Safe to run once after the existing Sodium schema.

begin;

alter table public.sessions
  add column if not exists reminder_sent_at timestamptz;

create or replace function public.add_session_member(
  target_session uuid,
  target_user uuid,
  target_role text default 'surf'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare selected_session public.sessions;
begin
  if target_role not in ('surf','film') then raise exception 'Invalid session role'; end if;
  select * into selected_session from public.sessions where id = target_session;
  if selected_session.id is null then raise exception 'Session not found'; end if;
  if auth.uid() is null or (selected_session.author <> auth.uid() and not public.is_admin()) then
    raise exception 'Only the session organizer can add crew';
  end if;
  if not exists (select 1 from public.profiles where id = target_user and onboarding_complete) then
    raise exception 'That Sodium member is not available';
  end if;
  insert into public.session_rsvps(session_id,user_id,role)
  values(target_session,target_user,target_role)
  on conflict(session_id,user_id) do update set role = excluded.role;
end $$;

revoke all on function public.add_session_member(uuid,uuid,text) from public, anon;
grant execute on function public.add_session_member(uuid,uuid,text) to authenticated;

create or replace function public.notify_new_session()
returns trigger language plpgsql security definer set search_path = public
as $$
declare member record; author_name text; place_name text;
begin
  if new.status <> 'active' or new.when_label = 'Logged' then return new; end if;
  select name into author_name from public.profiles where id = new.author;
  select name into place_name from public.spots where id = new.spot_id;
  for member in select user_id from public.region_notification_members(new.region_id) where user_id <> new.author loop
    perform public.enqueue_notification(member.user_id,'new_session','New surf',
      coalesce(author_name,'A friend')||' shared a surf'||case when place_name is null then '.' else ' at '||place_name||'.' end,
      './?open=surfing&session='||new.id::text||'&region='||new.region_id::text,new.id);
  end loop;
  return new;
end $$;

create or replace function public.notify_session_rsvp()
returns trigger language plpgsql security definer set search_path = public
as $$
declare session_row public.sessions; member_name text; role_name text; selected_session uuid; selected_user uuid; actor uuid;
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  actor := auth.uid();
  if tg_op='DELETE' then selected_session:=old.session_id; selected_user:=old.user_id; role_name:=old.role;
  else selected_session:=new.session_id; selected_user:=new.user_id; role_name:=new.role; end if;
  select * into session_row from public.sessions where id=selected_session;
  if session_row.when_label='Logged' then if tg_op='DELETE' then return old; else return new; end if; end if;
  select name into member_name from public.profiles where id=selected_user;
  role_name:=case when role_name='film' then 'film' else 'surf' end;
  if tg_op='INSERT' and selected_user is distinct from actor then
    perform public.enqueue_notification(selected_user,'session_update','Added to a surf',
      'You were added to '||role_name||'.','./?open=surfing&session='||selected_session::text||'&region='||session_row.region_id::text,session_row.id);
  elsif session_row.author<>selected_user then
    perform public.enqueue_notification(session_row.author,'session_update','Surf RSVP',
      coalesce(member_name,'A friend')||case when tg_op='DELETE' then ' left your surf.' else ' is coming to '||role_name||'.' end,
      './?open=surfing&session='||selected_session::text||'&region='||session_row.region_id::text,session_row.id);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

create or replace function public.notify_session_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare attendee record; author_name text; message text; selected_id uuid; selected_author uuid; selected_region uuid; selected_when text;
begin
  if tg_op='DELETE' then selected_id:=old.id; selected_author:=old.author; selected_region:=old.region_id; selected_when:=old.when_label;
  else selected_id:=new.id; selected_author:=new.author; selected_region:=new.region_id; selected_when:=new.when_label; end if;
  if selected_when='Logged' then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='UPDATE' and not (
    old.status is distinct from new.status or old.when_label is distinct from new.when_label or
    old.surf_time is distinct from new.surf_time or old.spot_id is distinct from new.spot_id or
    old.general_location is distinct from new.general_location or old.participant_names is distinct from new.participant_names or
    old.wants_filmer is distinct from new.wants_filmer or old.featured_surfer_name is distinct from new.featured_surfer_name or
    old.featured_surfer_user is distinct from new.featured_surfer_user or old.initiator_user is distinct from new.initiator_user
  ) then return new; end if;
  select name into author_name from public.profiles where id=selected_author;
  if tg_op='DELETE' then message:=coalesce(author_name,'The organizer')||' cancelled a surf.';
  elsif new.status='ended' and old.status is distinct from 'ended' then message:=coalesce(author_name,'The organizer')||' finished the surf.';
  elsif new.when_label='Now' and old.when_label is distinct from 'Now' then message:=coalesce(author_name,'The organizer')||' started the surf.';
  else message:=coalesce(author_name,'The organizer')||' updated a surf.'; end if;
  for attendee in
    select distinct member_id from (
      select case when tg_op='DELETE' then old.initiator_user else new.initiator_user end as member_id
      union all select case when tg_op='DELETE' then old.featured_surfer_user else new.featured_surfer_user end
      union all select rsvp.user_id from public.session_rsvps rsvp where rsvp.session_id=selected_id
    ) crew where member_id is not null and member_id<>selected_author
  loop
    perform public.enqueue_notification(attendee.member_id,'session_update','Surf update',message,
      './?open=surfing&session='||selected_id::text||'&region='||selected_region::text,selected_id);
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

create or replace function public.queue_active_session_reminders()
returns integer language plpgsql security definer set search_path = public
as $$
declare session_row record; queued integer := 0;
begin
  for session_row in
    select session.id,session.author,session.region_id,coalesce(spot.name,'your surf') as place_name
    from public.sessions session left join public.spots spot on spot.id=session.spot_id
    where session.status='active' and session.when_label='Now' and session.started_at<=now()-interval '3 hours' and session.reminder_sent_at is null
    for update of session skip locked
  loop
    perform public.enqueue_notification(session_row.author,'session_update','Still surfing?',
      session_row.place_name||' has been active for about three hours. Finish it when the crew is out.',
      './?open=surfing&session='||session_row.id::text||'&region='||session_row.region_id::text,session_row.id);
    update public.sessions set reminder_sent_at=now() where id=session_row.id;
    queued:=queued+1;
  end loop;
  return queued;
end $$;

revoke all on function public.queue_active_session_reminders() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    begin perform cron.unschedule('sodium-active-session-reminders'); exception when others then null; end;
    perform cron.schedule('sodium-active-session-reminders','*/15 * * * *','select public.queue_active_session_reminders();');
  end if;
end $$;

commit;
