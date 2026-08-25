-- Sodium v1.88: count clip handoffs and combine surf/film locations by spot.
-- Stoke posts remain separate community activity and do not inflate delivery stats.
-- Additive and safe to run more than once. Existing data is preserved.

begin;

create or replace function public.get_profile_participation_stats(target_user uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_member() then raise exception 'Community membership required'; end if;

  with completed as (
    select id, author, author_role, initiator_user, region_id, spot_id, started_at, ended_at
    from public.sessions
    where points_awarded_at is not null
  ), participation as (
    select id as session_id, author as user_id, author_role as role, region_id, spot_id, started_at, ended_at
    from completed
    union
    select session.id, rsvp.user_id, rsvp.role, session.region_id, session.spot_id, session.started_at, session.ended_at
    from completed session
    join public.session_rsvps rsvp on rsvp.session_id = session.id
  ), valid_time as (
    select *, extract(epoch from (ended_at - started_at)) / 60.0 as minutes
    from participation
    where started_at is not null
      and ended_at is not null
      and ended_at > started_at
      and ended_at - started_at <= interval '12 hours'
  ), sent_clips as (
    select
      count(*)::bigint as clip_handoffs,
      coalesce(sum(delivery.expected_count), 0)::bigint as clips_delivered
    from public.clip_deliveries delivery
    where delivery.sender = target_user and delivery.status <> 'cancelled'
  ), delivered_clips as (
    select coalesce(sum(delivery.expected_count), 0)::bigint as clips_received
    from public.clip_deliveries delivery
    where delivery.recipient = target_user and delivery.status <> 'cancelled'
  )
  select jsonb_build_object(
    'surfed', (select count(distinct session_id) from participation where user_id = target_user and role = 'surf'),
    'filmed', (select count(distinct session_id) from participation where user_id = target_user and role = 'film'),
    'organized', (select count(*) from completed where initiator_user = target_user),
    'stoke', (select count(*) from public.posts where author = target_user),
    'locations', (select count(distinct spot_id) from participation where user_id = target_user and spot_id is not null),
    'surf_minutes', coalesce((select round(sum(minutes))::bigint from valid_time where user_id = target_user and role = 'surf'), 0),
    'film_minutes', coalesce((select round(sum(minutes))::bigint from valid_time where user_id = target_user and role = 'film'), 0),
    'clip_handoffs', (select clip_handoffs from sent_clips),
    'clips_shared', (select clips_delivered from sent_clips),
    'clips_received', (select clips_received from delivered_clips)
  ) into result;

  return result;
end $$;

revoke execute on function public.get_profile_participation_stats(uuid) from public, anon;
grant execute on function public.get_profile_participation_stats(uuid) to authenticated;

commit;

select 'Sodium profile activity stats v3 ready' as result;
