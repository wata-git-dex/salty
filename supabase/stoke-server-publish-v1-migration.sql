-- Sodium Stoke: server-owned publication for Cloudflare Stream posts.
-- Existing posts stay published. New clip posts remain private until every
-- linked Stream video is ready, even if the phone is backgrounded or killed.

begin;

alter table public.posts
  add column if not exists status text not null default 'published',
  add column if not exists expected_media_count smallint not null default 0,
  add column if not exists publish_error text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('pending', 'published', 'failed'));

alter table public.posts drop constraint if exists posts_expected_media_count_check;
alter table public.posts add constraint posts_expected_media_count_check
  check (expected_media_count between 0 and 5);

alter table public.posts drop constraint if exists posts_pending_clip_count_check;
alter table public.posts add constraint posts_pending_clip_count_check
  check (status <> 'pending' or (media_type = 'clip' and expected_media_count between 1 and 5));

create index if not exists posts_published_created_at_idx
  on public.posts(created_at desc) where status = 'published';
create index if not exists posts_author_unpublished_idx
  on public.posts(author, updated_at desc) where status <> 'published';

create or replace function public.protect_post_publication_state()
returns trigger language plpgsql set search_path = public
as $$
begin
  if (new.status is distinct from old.status
      or new.expected_media_count is distinct from old.expected_media_count
      or new.publish_error is distinct from old.publish_error)
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Post publication state is server managed';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists protect_post_publication_state on public.posts;
create trigger protect_post_publication_state
before update on public.posts
for each row execute function public.protect_post_publication_state();

drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select to authenticated
using (
  public.is_member()
  and (status = 'published' or author = auth.uid() or public.is_admin())
);

drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts for insert to authenticated
with check (
  public.is_member()
  and author = auth.uid()
  and split_part(media_path, '/', 1) = auth.uid()::text
  and (
    (media_type = 'photo' and status = 'published' and expected_media_count = 0)
    or (media_type = 'clip' and status = 'pending' and expected_media_count between 1 and 5)
  )
);

drop policy if exists post_stream_media_read on public.post_stream_media;
create policy post_stream_media_read on public.post_stream_media for select to authenticated
using (
  public.is_member()
  and exists (
    select 1 from public.posts post
    where post.id = post_id
      and (post.status = 'published' or post.author = auth.uid() or public.is_admin())
  )
);

drop policy if exists post_stream_media_insert_own on public.post_stream_media;
create policy post_stream_media_insert_own on public.post_stream_media for insert to authenticated
with check (
  public.is_member()
  and creator = auth.uid()
  and exists (
    select 1 from public.posts post
    where post.id = post_id and post.author = auth.uid() and post.status = 'published'
  )
);

drop policy if exists post_stream_media_update_own on public.post_stream_media;
create policy post_stream_media_update_own on public.post_stream_media for update to authenticated
using (
  creator = auth.uid()
  and exists (
    select 1 from public.posts post
    where post.id = post_id and post.author = auth.uid() and post.status = 'published'
  )
)
with check (
  creator = auth.uid()
  and exists (
    select 1 from public.posts post
    where post.id = post_id and post.author = auth.uid() and post.status = 'published'
  )
);

drop policy if exists post_tags_read on public.post_tags;
create policy post_tags_read on public.post_tags for select to authenticated
using (
  public.is_member()
  and exists (
    select 1 from public.posts post
    where post.id = post_id
      and (post.status = 'published' or post.author = auth.uid() or public.is_admin())
  )
);

drop policy if exists comments_read on public.post_comments;
create policy comments_read on public.post_comments for select to authenticated
using (
  public.is_member()
  and exists (
    select 1 from public.posts post
    where post.id = post_id
      and (post.status = 'published' or post.author = auth.uid() or public.is_admin())
  )
);

drop policy if exists likes_read on public.post_likes;
create policy likes_read on public.post_likes for select to authenticated
using (
  public.is_member()
  and exists (
    select 1 from public.posts post
    where post.id = post_id
      and (post.status = 'published' or post.author = auth.uid() or public.is_admin())
  )
);

create or replace function public.points_from_action()
returns trigger language plpgsql security definer set search_path = public
as $$
declare activity_user uuid; activity_action text; activity_points int; activity_source uuid;
begin
  case tg_table_name
    when 'posts' then
      if new.status <> 'published'
         or (tg_op = 'UPDATE' and old.status = 'published') then
        return new;
      end if;
      activity_user := new.author; activity_action := 'post_clip'; activity_points := 15; activity_source := new.id;
    when 'post_comments' then activity_user := new.author; activity_action := 'comment'; activity_points := 3; activity_source := new.id;
    when 'event_rsvps' then activity_user := new.user_id; activity_action := 'attend_event'; activity_points := 10; activity_source := new.event_id;
    else return new;
  end case;
  perform public.record_activity(activity_user, activity_action, activity_points, activity_source);
  return new;
end $$;

drop trigger if exists points_post on public.posts;
create trigger points_post
after insert or update of status on public.posts
for each row execute function public.points_from_action();

create or replace function public.notify_new_stoke()
returns trigger language plpgsql security definer set search_path = public
as $$
declare member record; author_name text;
begin
  if new.status <> 'published'
     or (tg_op = 'UPDATE' and old.status = 'published') then
    return new;
  end if;
  select name into author_name from public.profiles where id = new.author;
  for member in select id from public.profiles where onboarding_complete and id <> new.author loop
    perform public.enqueue_notification(member.id, 'new_stoke', 'New Stoke',
      coalesce(author_name, 'A friend') || ' shared a ' || case when new.media_type = 'clip' then 'clip.' else 'photo.' end,
      './?open=feed', new.id);
  end loop;
  return new;
end $$;

drop trigger if exists notify_new_stoke on public.posts;
create trigger notify_new_stoke
after insert or update of status on public.posts
for each row execute function public.notify_new_stoke();

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
    select count(*)::bigint as clip_handoffs,
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
    'stoke', (select count(*) from public.posts where author = target_user and status = 'published'),
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

select 'Sodium server-owned Stoke publication ready' as result;
