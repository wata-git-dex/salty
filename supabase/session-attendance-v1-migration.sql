-- Sodium v1.118: confirmed attendance, same-day wrap-up, and admin session repair.
-- Additive and data-preserving. Existing awarded sessions retain their history.

begin;

alter table public.session_rsvps
  add column if not exists attendance_status text not null default 'joined',
  add column if not exists attendance_confirmed_at timestamptz,
  add column if not exists attendance_confirmed_by uuid references public.profiles(id) on delete set null;

alter table public.session_rsvps drop constraint if exists session_rsvps_attendance_status_check;
alter table public.session_rsvps add constraint session_rsvps_attendance_status_check
  check (attendance_status in ('joined','confirmed','absent'));

-- Preserve already-awarded history as confirmed rather than re-evaluating it.
update public.session_rsvps rsvp
set attendance_status='confirmed',
    attendance_confirmed_at=coalesce(rsvp.attendance_confirmed_at,session.points_awarded_at),
    attendance_confirmed_by=coalesce(rsvp.attendance_confirmed_by,session.author)
from public.sessions session
where session.id=rsvp.session_id and session.points_awarded_at is not null;

drop policy if exists sessions_update_own on public.sessions;
create policy sessions_update_own on public.sessions for update
  using (author=auth.uid() or public.is_admin())
  with check (author=auth.uid() or public.is_admin());

create or replace function public.guard_session_attendance()
returns trigger language plpgsql security definer set search_path=public
as $$
declare organizer uuid;
begin
  if old.attendance_status is not distinct from new.attendance_status
     and old.attendance_confirmed_at is not distinct from new.attendance_confirmed_at
     and old.attendance_confirmed_by is not distinct from new.attendance_confirmed_by then
    return new;
  end if;
  select author into organizer from public.sessions where id=new.session_id;
  if auth.uid() is null or (auth.uid()<>organizer and not public.is_admin()) then
    raise exception 'Only the session organizer can confirm attendance';
  end if;
  return new;
end $$;

drop trigger if exists guard_session_attendance on public.session_rsvps;
create trigger guard_session_attendance
before update of attendance_status,attendance_confirmed_at,attendance_confirmed_by on public.session_rsvps
for each row execute function public.guard_session_attendance();

create or replace function public.add_session_member(target_session uuid,target_user uuid,target_role text default 'surf')
returns void language plpgsql security definer set search_path=public
as $$
declare selected_session public.sessions;
begin
  if target_role not in ('surf','film') then raise exception 'Invalid session role'; end if;
  select * into selected_session from public.sessions where id=target_session;
  if selected_session.id is null then raise exception 'Session not found'; end if;
  if auth.uid() is null or (selected_session.author<>auth.uid() and not public.is_admin()) then
    raise exception 'Only the session organizer can add crew';
  end if;
  if not exists(select 1 from public.profiles where id=target_user and onboarding_complete) then
    raise exception 'That Sodium member is not available';
  end if;
  insert into public.session_rsvps(session_id,user_id,role,attendance_status,attendance_confirmed_at,attendance_confirmed_by)
  values(target_session,target_user,target_role,'joined',null,null)
  on conflict(session_id,user_id) do update set role=excluded.role,
    attendance_status='joined',attendance_confirmed_at=null,attendance_confirmed_by=null;
end $$;

create or replace function public.finish_session(target_session uuid,confirmed_attendees uuid[] default '{}'::uuid[])
returns uuid language plpgsql security definer set search_path=public
as $$
declare selected_session public.sessions;
begin
  select * into selected_session from public.sessions where id=target_session for update;
  if selected_session.id is null then raise exception 'Session not found'; end if;
  if auth.uid() is null or (selected_session.author<>auth.uid() and not public.is_admin()) then
    raise exception 'Only the session organizer can finish it';
  end if;
  if selected_session.status<>'active' then return selected_session.id; end if;

  update public.session_rsvps
  set attendance_status=case when user_id=any(coalesce(confirmed_attendees,'{}'::uuid[])) then 'confirmed' else 'absent' end,
      attendance_confirmed_at=case when user_id=any(coalesce(confirmed_attendees,'{}'::uuid[])) then now() else null end,
      attendance_confirmed_by=case when user_id=any(coalesce(confirmed_attendees,'{}'::uuid[])) then auth.uid() else null end
  where session_id=target_session;

  update public.sessions set status='ended',ended_at=now() where id=target_session;
  return target_session;
end $$;

revoke all on function public.finish_session(uuid,uuid[]) from public,anon;
grant execute on function public.finish_session(uuid,uuid[]) to authenticated;

create or replace function public.award_finished_surf()
returns trigger language plpgsql security definer set search_path=public
as $$
declare attendee record;
begin
  if tg_op='INSERT' then
    new.points_awarded_at:=null;
    new.initiator_points_awarded_at:=null;
    return new;
  end if;
  if new.status='ended' and old.status is distinct from 'ended' and old.points_awarded_at is null then
    new.points_awarded_at:=now();
    if new.initiator_user is not null then
      perform public.record_activity(new.initiator_user,'post_session',10,new.id);
      new.initiator_points_awarded_at:=now();
    end if;
    if new.author is distinct from new.initiator_user then
      perform public.record_activity(new.author,'rsvp',5,new.id);
    end if;
    for attendee in
      select distinct user_id from public.session_rsvps
      where session_id=new.id and attendance_status='confirmed' and user_id is distinct from new.initiator_user
    loop
      perform public.record_activity(attendee.user_id,'rsvp',5,new.id);
    end loop;
  elsif old.initiator_user is null and new.initiator_user is not null
        and old.points_awarded_at is not null and old.initiator_points_awarded_at is null then
    perform public.record_activity(new.initiator_user,'post_session',10,new.id);
    new.initiator_points_awarded_at:=now();
    new.points_awarded_at:=old.points_awarded_at;
  else
    new.points_awarded_at:=old.points_awarded_at;
    new.initiator_points_awarded_at:=old.initiator_points_awarded_at;
  end if;
  return new;
end $$;

-- Keep the existing admin credit-correction path attendance-aware as well.
create or replace function public.normalize_session_initiator()
returns trigger language plpgsql security definer set search_path=public
as $$
declare resolved_name text; credit_change boolean:=false; credit_time timestamptz; attendee record;
begin
  if new.initiator_user is null and nullif(trim(new.initiator_name),'') is null then new.initiator_user:=new.author; end if;
  if new.initiator_user is not null then
    select name into resolved_name from public.profiles where id=new.initiator_user;
    if resolved_name is null then raise exception 'Initiator profile not found'; end if;
    new.initiator_name:=resolved_name;
    new.initiator_claimed_at:=coalesce(new.initiator_claimed_at,now());
  else
    new.initiator_name:=trim(new.initiator_name);
    new.initiator_claimed_at:=null;
  end if;
  if tg_op='UPDATE' and old.initiator_points_awarded_at is not null then
    credit_change:=new.initiator_user is distinct from old.initiator_user or new.initiator_name is distinct from old.initiator_name;
    if credit_change and not public.is_admin() then raise exception 'Initiator credit is locked after points are awarded'; end if;
  end if;
  if credit_change then
    credit_time:=coalesce(old.points_awarded_at,old.initiator_points_awarded_at,now());
    delete from public.points_events where source_id=new.id and action in ('post_session','rsvp');
    if new.initiator_user is not null then
      insert into public.points_events(user_id,action,points,source_id,created_at) values(new.initiator_user,'post_session',10,new.id,credit_time) on conflict do nothing;
      insert into public.points_events(user_id,action,points,created_at) values(new.initiator_user,'daily_active',5,credit_time) on conflict do nothing;
      new.initiator_points_awarded_at:=credit_time;
    else new.initiator_points_awarded_at:=null; end if;
    if new.author is distinct from new.initiator_user then
      insert into public.points_events(user_id,action,points,source_id,created_at) values(new.author,'rsvp',5,new.id,credit_time) on conflict do nothing;
      insert into public.points_events(user_id,action,points,created_at) values(new.author,'daily_active',5,credit_time) on conflict do nothing;
    end if;
    for attendee in select distinct user_id from public.session_rsvps where session_id=new.id and attendance_status='confirmed' and user_id is distinct from new.initiator_user loop
      insert into public.points_events(user_id,action,points,source_id,created_at) values(attendee.user_id,'rsvp',5,new.id,credit_time) on conflict do nothing;
      insert into public.points_events(user_id,action,points,created_at) values(attendee.user_id,'daily_active',5,credit_time) on conflict do nothing;
      perform public.rebuild_user_streak(attendee.user_id);
    end loop;
    delete from public.points_events daily where daily.user_id=old.initiator_user and daily.action='daily_active'
      and (daily.created_at at time zone 'UTC')::date=(credit_time at time zone 'UTC')::date
      and not exists(select 1 from public.points_events activity where activity.user_id=daily.user_id and activity.action<>'daily_active' and (activity.created_at at time zone 'UTC')::date=(credit_time at time zone 'UTC')::date);
    perform public.rebuild_user_streak(old.initiator_user);
    perform public.rebuild_user_streak(new.initiator_user);
    perform public.rebuild_user_streak(new.author);
  end if;
  return new;
end $$;

create or replace function public.get_profile_participation_stats(target_user uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare result jsonb;
begin
  if not public.is_member() then raise exception 'Community membership required'; end if;
  with completed as (
    select id,author,author_role,initiator_user,region_id from public.sessions where points_awarded_at is not null
  ), participation as (
    select id as session_id,author as user_id,author_role as role,region_id from completed
    union
    select session.id,rsvp.user_id,rsvp.role,session.region_id
    from completed session join public.session_rsvps rsvp on rsvp.session_id=session.id
    where rsvp.attendance_status='confirmed'
  )
  select jsonb_build_object(
    'surfed',(select count(distinct session_id) from participation where user_id=target_user and role='surf'),
    'filmed',(select count(distinct session_id) from participation where user_id=target_user and role='film'),
    'organized',(select count(*) from completed where initiator_user=target_user),
    'stoke',(select count(*) from public.posts where author=target_user),
    'locations',(select count(distinct region_id) from participation where user_id=target_user)
  ) into result;
  return result;
end $$;

revoke execute on function public.guard_session_attendance(),public.award_finished_surf(),public.normalize_session_initiator() from public,anon,authenticated;

commit;

select 'Sodium confirmed attendance enabled' as result;
