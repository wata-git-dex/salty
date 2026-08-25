-- Sodium v1.87: trustworthy surf / film duration and richer profile activity stats.
-- Additive and safe to run more than once. Existing counts and records are preserved.

begin;

alter table public.sessions
  add column if not exists started_at timestamptz;

-- Only backfill sessions whose existing timestamps clearly describe a real,
-- manually started surf. Scheduled and long auto-archived sessions remain
-- un-timed instead of inflating a member's totals.
update public.sessions
set started_at = surf_time
where started_at is null
  and when_label = 'Now'
  and surf_time is not null
  and (
    status = 'active'
    or (
      ended_at is not null
      and ended_at > surf_time
      and ended_at - surf_time <= interval '12 hours'
    )
  );

create or replace function public.get_profile_participation_stats(target_user uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_member() then raise exception 'Community membership required'; end if;

  with completed as (
    select id, author, author_role, initiator_user, region_id, started_at, ended_at
    from public.sessions
    where points_awarded_at is not null
  ), participation as (
    select id as session_id, author as user_id, author_role as role, region_id, started_at, ended_at
    from completed
    union
    select session.id, rsvp.user_id, rsvp.role, session.region_id, session.started_at, session.ended_at
    from completed session
    join public.session_rsvps rsvp on rsvp.session_id = session.id
  ), valid_time as (
    select *, extract(epoch from (ended_at - started_at)) / 60.0 as minutes
    from participation
    where started_at is not null
      and ended_at is not null
      and ended_at > started_at
      and ended_at - started_at <= interval '12 hours'
  ), authored_media as (
    select
      coalesce(sum(case when post.media_type = 'photo'
        then greatest(cardinality(post.media_paths), 1) else 0 end), 0)::bigint as photos_shared,
      coalesce(sum(case when post.media_type = 'clip'
        then greatest((select count(*) from public.post_stream_media media where media.post_id = post.id), 1) else 0 end), 0)::bigint as clips_shared
    from public.posts post
    where post.filmer_user = target_user
       or (post.filmer_user is null and post.author = target_user)
  ), tagged_photos as (
    select coalesce(sum(greatest(cardinality(post.media_paths), 1)), 0)::bigint as photos_received
    from public.posts post
    join public.post_tags tag on tag.post_id = post.id
    where tag.user_id = target_user and tag.role = 'surfer' and post.media_type = 'photo'
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
    'locations', (select count(distinct region_id) from participation where user_id = target_user and role = 'surf'),
    'surf_minutes', coalesce((select round(sum(minutes))::bigint from valid_time where user_id = target_user and role = 'surf'), 0),
    'film_minutes', coalesce((select round(sum(minutes))::bigint from valid_time where user_id = target_user and role = 'film'), 0),
    'photos_shared', (select photos_shared from authored_media),
    'clips_shared', (select clips_shared from authored_media),
    'photos_received', (select photos_received from tagged_photos),
    'clips_received', (select clips_received from delivered_clips)
  ) into result;

  return result;
end $$;

revoke execute on function public.get_profile_participation_stats(uuid) from public, anon;
grant execute on function public.get_profile_participation_stats(uuid) to authenticated;

commit;

select 'Sodium profile activity stats ready' as result;
