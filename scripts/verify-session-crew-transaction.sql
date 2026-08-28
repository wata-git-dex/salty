-- Rollback-safe production smoke test for save_session_with_crew.
-- It re-saves one existing session with its exact current crew, then rolls back.

begin;

select set_config(
  'request.jwt.claim.sub',
  (
    select sessions.author::text
    from public.sessions
    join public.profiles on profiles.id=sessions.author
    where profiles.onboarding_complete
      and sessions.spot_id is not null
      and sessions.region_id is not null
    order by sessions.created_at desc
    limit 1
  ),
  true
);

with target as (
  select sessions.*
  from public.sessions
  where sessions.author=auth.uid()
    and sessions.spot_id is not null
    and sessions.region_id is not null
  order by sessions.created_at desc
  limit 1
)
select public.save_session_with_crew(
  target.id,
  target.spot_id,
  target.region_id,
  target.when_label,
  target.surf_time,
  target.started_at,
  target.author_role,
  target.wants_filmer,
  target.note,
  target.status,
  target.ended_at,
  target.initiator_user,
  target.initiator_name,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', session_rsvps.user_id,
      'role', session_rsvps.role
    ) order by session_rsvps.user_id)
    from public.session_rsvps
    where session_rsvps.session_id=target.id
      and session_rsvps.user_id<>target.author
  ), '[]'::jsonb),
  coalesce(target.participant_names, '{}'::text[])
) as rollback_safe_result
from target;

with template as (
  select sessions.spot_id, sessions.region_id
  from public.sessions
  where sessions.author=auth.uid()
    and sessions.spot_id is not null
    and sessions.region_id is not null
  order by sessions.created_at desc
  limit 1
), linked_member as (
  select profiles.id
  from public.profiles
  where profiles.onboarding_complete
    and profiles.id<>auth.uid()
  order by profiles.created_at
  limit 1
)
select public.save_session_with_crew(
  null,
  template.spot_id,
  template.region_id,
  'Scheduled',
  now()+interval '7 days',
  null,
  'surf',
  false,
  'Rollback-only transaction smoke test',
  'active',
  null,
  auth.uid(),
  null,
  jsonb_build_array(jsonb_build_object('user_id',linked_member.id,'role','surf')),
  array['Rollback Guest']::text[]
) as rollback_safe_create_result
from template cross join linked_member;

rollback;

select count(*) as retained_smoke_test_rows
from public.sessions
where note='Rollback-only transaction smoke test';
