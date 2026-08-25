-- Sodium admin correction for finished-session organizer credit.
-- Keeps the anti-cheating lock for members while letting an admin correct
-- attribution without duplicating organizer or participation points.

begin;

create or replace function public.rebuild_user_streak(target_user uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  activity_date date;
  previous_date date;
  rebuilt_streak integer := 0;
begin
  if target_user is null then return; end if;
  for activity_date in
    select distinct (created_at at time zone 'UTC')::date
    from public.points_events
    where user_id = target_user
    order by 1
  loop
    rebuilt_streak := case
      when previous_date is not null and previous_date >= activity_date - 7 then rebuilt_streak + 1
      else 1
    end;
    previous_date := activity_date;
  end loop;

  if previous_date is null then
    delete from public.streaks where user_id = target_user;
  else
    insert into public.streaks (user_id, last_active_date, current_streak)
    values (target_user, previous_date, rebuilt_streak)
    on conflict (user_id) do update set
      last_active_date = excluded.last_active_date,
      current_streak = excluded.current_streak;
  end if;
end $$;

create or replace function public.normalize_session_initiator()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  resolved_name text;
  credit_change boolean := false;
  credit_time timestamptz;
  attendee record;
begin
  if new.initiator_user is null and nullif(trim(new.initiator_name), '') is null then
    new.initiator_user := new.author;
  end if;

  if new.initiator_user is not null then
    select name into resolved_name from public.profiles where id = new.initiator_user;
    if resolved_name is null then raise exception 'Initiator profile not found'; end if;
    new.initiator_name := resolved_name;
    new.initiator_claimed_at := coalesce(new.initiator_claimed_at, now());
  else
    new.initiator_name := trim(new.initiator_name);
    new.initiator_claimed_at := null;
  end if;

  if tg_op = 'UPDATE' and old.initiator_points_awarded_at is not null then
    credit_change := new.initiator_user is distinct from old.initiator_user
      or new.initiator_name is distinct from old.initiator_name;
    if credit_change and not public.is_admin() then
      raise exception 'Initiator credit is locked after points are awarded';
    end if;
  end if;

  if credit_change then
    credit_time := coalesce(old.points_awarded_at, old.initiator_points_awarded_at, now());

    -- Rebuild only the source-linked points for this surf. This makes the
    -- operation repeat-safe and prevents stacking organizer + RSVP credit.
    delete from public.points_events
    where source_id = new.id and action in ('post_session', 'rsvp');

    if new.initiator_user is not null then
      insert into public.points_events (user_id, action, points, source_id, created_at)
      values (new.initiator_user, 'post_session', 10, new.id, credit_time)
      on conflict do nothing;
      insert into public.points_events (user_id, action, points, created_at)
      values (new.initiator_user, 'daily_active', 5, credit_time)
      on conflict do nothing;
      new.initiator_points_awarded_at := credit_time;
    else
      new.initiator_points_awarded_at := null;
    end if;

    if new.author is distinct from new.initiator_user then
      insert into public.points_events (user_id, action, points, source_id, created_at)
      values (new.author, 'rsvp', 5, new.id, credit_time)
      on conflict do nothing;
      insert into public.points_events (user_id, action, points, created_at)
      values (new.author, 'daily_active', 5, credit_time)
      on conflict do nothing;
    end if;

    for attendee in
      select distinct user_id from public.session_rsvps
      where session_id = new.id and user_id is distinct from new.initiator_user
    loop
      insert into public.points_events (user_id, action, points, source_id, created_at)
      values (attendee.user_id, 'rsvp', 5, new.id, credit_time)
      on conflict do nothing;
      insert into public.points_events (user_id, action, points, created_at)
      values (attendee.user_id, 'daily_active', 5, credit_time)
      on conflict do nothing;
      perform public.rebuild_user_streak(attendee.user_id);
    end loop;

    -- Remove an orphaned daily bonus only when the former organizer has no
    -- other qualifying activity on that original day.
    delete from public.points_events daily
    where daily.user_id = old.initiator_user
      and daily.action = 'daily_active'
      and (daily.created_at at time zone 'UTC')::date = (credit_time at time zone 'UTC')::date
      and not exists (
        select 1 from public.points_events activity
        where activity.user_id = daily.user_id
          and activity.action <> 'daily_active'
          and (activity.created_at at time zone 'UTC')::date = (credit_time at time zone 'UTC')::date
      );

    perform public.rebuild_user_streak(old.initiator_user);
    perform public.rebuild_user_streak(new.initiator_user);
    perform public.rebuild_user_streak(new.author);
  end if;
  return new;
end $$;

revoke execute on function public.rebuild_user_streak(uuid) from public, anon, authenticated;

commit;

select 'Sodium finished-session credit correction enabled' as result;
