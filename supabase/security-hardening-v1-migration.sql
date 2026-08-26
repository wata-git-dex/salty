-- Salty security hardening v1
-- Run once after the existing Salty schema and feature migrations.

begin;

-- Authenticated members may fetch their own private profile fields (phone and
-- admin flag), but the general profiles table exposes only community-safe data.
create or replace function public.get_my_profile()
returns public.profiles
language sql
stable
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
  select profile
  from public.profiles profile
  where profile.id = auth.uid()
  limit 1
$$;

revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

-- Prevent untrusted roles from creating objects where privileged functions
-- resolve names, then keep temporary schemas last in every public definer path.
revoke create on schema public from public, anon, authenticated;

do $hardening$
declare
  function_signature regprocedure;
begin
  for function_signature in
    select procedure.oid::regprocedure
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      function_signature
    );
    execute format(
      'alter function %s set search_path = pg_catalog, public, auth, extensions, pg_temp',
      function_signature
    );
  end loop;
end
$hardening$;

-- Re-open only the RPC surface that the browser application actually uses.
-- Trigger helpers, queue writers, point awarders, and connection helpers remain
-- executable only by their owner and cannot be called directly through PostgREST.
grant execute on function public.invite_is_valid(text) to anon, authenticated;
grant execute on function public.is_member(uuid), public.is_admin(uuid) to authenticated;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.redeem_invite(text,text,text,text) to authenticated;
grant execute on function public.create_invite(int,uuid) to authenticated;
grant execute on function public.create_or_join_location(text,text) to authenticated;
grant execute on function public.join_location(uuid) to authenticated;
grant execute on function public.set_home_location(uuid) to authenticated;
grant execute on function public.get_profile_participation_stats(uuid) to authenticated;
grant execute on function public.mark_dm_read(uuid) to authenticated;

-- Least privilege at the SQL grant layer. RLS remains the row-by-row control.
revoke all privileges on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

grant select on public.regions to authenticated;
grant select (id, name, nickname, home_region, sponsors, social_url, avatar_path, onboarding_complete, created_at)
  on public.profiles to authenticated;
grant update (name, nickname, phone, home_region, sponsors, social_url, avatar_path, onboarding_complete)
  on public.profiles to authenticated;
grant select, insert, update, delete on public.spots to authenticated;
grant select, insert, update, delete on public.brands to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.session_rsvps to authenticated;
grant select, insert, update, delete on public.posts to authenticated;
grant select, insert, delete on public.post_tags to authenticated;
grant select, insert, update, delete on public.post_comments to authenticated;
grant select, insert, delete on public.post_likes to authenticated;
grant select on public.connections to authenticated;
grant select, insert, update, delete on public.room_messages to authenticated;
grant select, insert, update, delete on public.dm_messages to authenticated;
grant select, insert, delete on public.message_reactions to authenticated;
grant select, insert, update, delete on public.events to authenticated;
grant select, insert, delete on public.event_rsvps to authenticated;
grant select on public.points_events to authenticated;
grant select on public.streaks to authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notification_queue to authenticated;
grant select, insert, update, delete on public.rewards to authenticated;
grant select, insert, update on public.reward_claims to authenticated;
grant select, insert, delete on public.mutes to authenticated;
grant select, insert, update on public.reports to authenticated;
grant select, insert, update, delete on public.beta_issue_reports to authenticated;
grant select, insert, update, delete on public.region_memberships to authenticated;

-- A post may only point at media inside its author's own Storage folder.
drop policy if exists posts_insert_own on public.posts;
drop policy if exists posts_update_own on public.posts;
create policy posts_insert_own on public.posts
for insert to authenticated
with check (
  public.is_member()
  and author = auth.uid()
  and split_part(media_path, '/', 1) = auth.uid()::text
);
create policy posts_update_own on public.posts
for update to authenticated
using (author = auth.uid())
with check (
  author = auth.uid()
  and split_part(media_path, '/', 1) = auth.uid()::text
);

-- Feedback rows may reference only the reporter's own private screenshot path.
drop policy if exists beta_issue_reports_insert_own on public.beta_issue_reports;
create policy beta_issue_reports_insert_own on public.beta_issue_reports
for insert to authenticated
with check (
  public.is_member()
  and reporter = auth.uid()
  and (screenshot_path is null or split_part(screenshot_path, '/', 1) = auth.uid()::text)
);

-- Stoke is community-global, not internet-public. Members receive short-lived
-- signed URLs after RLS confirms membership.
update storage.buckets
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm']
where id = 'salty-media';

drop policy if exists salty_media_read on storage.objects;
create policy salty_media_read on storage.objects
for select to authenticated
using (bucket_id = 'salty-media' and public.is_member());

commit;

select 'Salty security hardening v1 complete' as result;
