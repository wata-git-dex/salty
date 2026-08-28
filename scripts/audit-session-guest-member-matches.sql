-- Read-only incident worklist for legacy session guest names that may belong
-- to an existing Sodium member. This intentionally does not link or mutate
-- anything: identical display names can belong to different people.

begin transaction read only;

with guest_names as (
  select
    sessions.id as session_id,
    trim(guest_text) as guest_text
  from public.sessions
  cross join lateral unnest(
    coalesce(sessions.participant_names, '{}'::text[])
  ) as guest_text
  where nullif(trim(guest_text), '') is not null
),
normalized_profiles as (
  select
    profiles.id as matching_profile_id,
    lower(regexp_replace(trim(profiles.name), '\s+', ' ', 'g')) as normalized_name
  from public.profiles
  where nullif(trim(profiles.name), '') is not null
)
select
  guest_names.session_id,
  guest_names.guest_text,
  normalized_profiles.matching_profile_id
from guest_names
join normalized_profiles
  on normalized_profiles.normalized_name =
     lower(regexp_replace(guest_names.guest_text, '\s+', ' ', 'g'))
order by
  guest_names.session_id,
  lower(guest_names.guest_text),
  normalized_profiles.matching_profile_id;

rollback;
