-- Sodium session attribution + contextual invitations v1
-- Separates who entered a session from who initiated it, supports pending
-- nonmember credit, and lets invitation redemption claim sessions or clips.

begin;

alter table public.sessions add column if not exists initiator_user uuid references public.profiles(id) on delete set null;
alter table public.sessions add column if not exists initiator_name text;
alter table public.sessions add column if not exists initiator_claimed_at timestamptz;
alter table public.sessions add column if not exists initiator_points_awarded_at timestamptz;

update public.sessions session
set initiator_user = session.author,
    initiator_name = profile.name,
    initiator_claimed_at = coalesce(session.created_at, now()),
    initiator_points_awarded_at = case when session.points_awarded_at is not null then session.points_awarded_at else null end
from public.profiles profile
where profile.id = session.author
  and session.initiator_user is null
  and nullif(trim(session.initiator_name), '') is null;

alter table public.sessions drop constraint if exists sessions_initiator_name_check;
alter table public.sessions add constraint sessions_initiator_name_check
  check (initiator_name is null or char_length(trim(initiator_name)) between 1 and 80);

create index if not exists sessions_initiator_user_idx on public.sessions(initiator_user, created_at desc);

create or replace function public.normalize_session_initiator()
returns trigger language plpgsql security definer set search_path = public
as $$
declare resolved_name text;
begin
  if tg_op = 'UPDATE' and old.initiator_points_awarded_at is not null
     and (new.initiator_user is distinct from old.initiator_user or new.initiator_name is distinct from old.initiator_name) then
    raise exception 'Initiator credit is locked after points are awarded';
  end if;

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
  return new;
end $$;

drop trigger if exists normalize_session_initiator on public.sessions;
create trigger normalize_session_initiator
before insert or update of author, initiator_user, initiator_name
on public.sessions for each row execute function public.normalize_session_initiator();

create or replace function public.award_finished_surf()
returns trigger language plpgsql security definer set search_path = public
as $$
declare attendee record;
begin
  if tg_op = 'INSERT' then
    new.points_awarded_at := null;
    new.initiator_points_awarded_at := null;
    return new;
  end if;

  if new.status = 'ended' and old.status is distinct from 'ended' and old.points_awarded_at is null then
    new.points_awarded_at := now();

    if new.initiator_user is not null then
      perform public.record_activity(new.initiator_user, 'post_session', 10, new.id);
      new.initiator_points_awarded_at := now();
    end if;

    -- When someone entered the surf on another person's behalf, the creator
    -- still earns participation credit for surfing or filming it.
    if new.author is distinct from new.initiator_user then
      perform public.record_activity(new.author, 'rsvp', 5, new.id);
    end if;

    for attendee in
      select distinct user_id from public.session_rsvps
      where session_id = new.id and user_id is distinct from new.initiator_user
    loop
      perform public.record_activity(attendee.user_id, 'rsvp', 5, new.id);
    end loop;
  elsif old.initiator_user is null and new.initiator_user is not null
        and old.points_awarded_at is not null and old.initiator_points_awarded_at is null then
    -- A nonmember initiator claimed an already-finished surf. Award the
    -- organizer credit now; record_activity's unique source prevents repeats.
    perform public.record_activity(new.initiator_user, 'post_session', 10, new.id);
    new.initiator_points_awarded_at := now();
    new.points_awarded_at := old.points_awarded_at;
  else
    new.points_awarded_at := old.points_awarded_at;
    new.initiator_points_awarded_at := old.initiator_points_awarded_at;
  end if;
  return new;
end $$;

drop trigger if exists award_finished_surf on public.sessions;
create trigger award_finished_surf
before insert or update on public.sessions
for each row execute function public.award_finished_surf();

create or replace function public.get_profile_participation_stats(target_user uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_member() then raise exception 'Community membership required'; end if;
  with completed as (
    select id, author, author_role, initiator_user, region_id
    from public.sessions where points_awarded_at is not null
  ), participation as (
    select id as session_id, author as user_id, author_role as role, region_id from completed
    union
    select session.id, rsvp.user_id, rsvp.role, session.region_id
    from completed session join public.session_rsvps rsvp on rsvp.session_id = session.id
  )
  select jsonb_build_object(
    'surfed', (select count(distinct session_id) from participation where user_id = target_user and role = 'surf'),
    'filmed', (select count(distinct session_id) from participation where user_id = target_user and role = 'film'),
    'organized', (select count(*) from completed where initiator_user = target_user),
    'stoke', (select count(*) from public.posts where author = target_user),
    'locations', (select count(distinct region_id) from participation where user_id = target_user and role = 'surf')
  ) into result;
  return result;
end $$;

-- A clip handoff can be prepared before the recipient joins Sodium.
alter table public.clip_deliveries alter column recipient drop not null;
alter table public.clip_deliveries add column if not exists recipient_name text;
alter table public.clip_deliveries add column if not exists guest_access_token uuid unique;
alter table public.clip_deliveries drop constraint if exists clip_deliveries_recipient_name_check;
alter table public.clip_deliveries add constraint clip_deliveries_recipient_name_check
  check (recipient is not null or char_length(trim(recipient_name)) between 1 and 80);

update public.clip_deliveries delivery
set recipient_name = profile.name
from public.profiles profile
where profile.id = delivery.recipient and nullif(trim(delivery.recipient_name), '') is null;

drop policy if exists clip_deliveries_read_parties on public.clip_deliveries;
create policy clip_deliveries_read_parties on public.clip_deliveries for select
  using (public.is_member() and (sender = auth.uid() or recipient = auth.uid()));

drop policy if exists clip_deliveries_insert_sender on public.clip_deliveries;
create policy clip_deliveries_insert_sender on public.clip_deliveries for insert
  with check (
    public.is_member() and sender = auth.uid() and recipient is distinct from auth.uid()
    and (
      (recipient is not null and exists (select 1 from public.profiles where id = recipient and onboarding_complete))
      or (recipient is null and char_length(trim(recipient_name)) between 1 and 80)
    )
  );

drop policy if exists clip_deliveries_update_sender on public.clip_deliveries;
create policy clip_deliveries_update_sender on public.clip_deliveries for update
  using (sender = auth.uid())
  with check (sender = auth.uid() and recipient is distinct from auth.uid());

create or replace function public.lock_claimed_clip_recipient()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.recipient is not null and new.recipient is distinct from old.recipient then
    raise exception 'The claimed clip recipient cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists lock_claimed_clip_recipient on public.clip_deliveries;
create trigger lock_claimed_clip_recipient before update of recipient on public.clip_deliveries
for each row execute function public.lock_claimed_clip_recipient();

create table if not exists public.clip_delivery_messages (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.clip_deliveries(id) on delete cascade,
  sender_user uuid references public.profiles(id) on delete set null,
  guest_name text,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  check (sender_user is not null or char_length(trim(guest_name)) between 1 and 80)
);
create index if not exists clip_delivery_messages_delivery_idx on public.clip_delivery_messages(delivery_id, created_at);
alter table public.clip_delivery_messages enable row level security;
drop policy if exists clip_delivery_messages_parties_read on public.clip_delivery_messages;
create policy clip_delivery_messages_parties_read on public.clip_delivery_messages for select using (
  public.is_member() and exists (
    select 1 from public.clip_deliveries delivery where delivery.id = delivery_id
      and (delivery.sender = auth.uid() or delivery.recipient = auth.uid())
  )
);
drop policy if exists clip_delivery_messages_parties_insert on public.clip_delivery_messages;
create policy clip_delivery_messages_parties_insert on public.clip_delivery_messages for insert with check (
  sender_user = auth.uid() and exists (
    select 1 from public.clip_deliveries delivery where delivery.id = delivery_id
      and (delivery.sender = auth.uid() or delivery.recipient = auth.uid())
  )
);

create or replace function public.create_guest_clip_link(target_delivery uuid)
returns text language plpgsql security definer set search_path = public
as $$
declare token uuid;
begin
  if not public.is_member() then raise exception 'Community membership required'; end if;
  select guest_access_token into token from public.clip_deliveries
    where id = target_delivery and sender = auth.uid() for update;
  if not found then raise exception 'Clip delivery not found'; end if;
  if token is null then
    token := gen_random_uuid();
    update public.clip_deliveries set guest_access_token = token where id = target_delivery;
  end if;
  return token::text;
end $$;

create or replace function public.get_guest_clip_delivery(access_token text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare token uuid; result jsonb;
begin
  begin token := access_token::uuid; exception when others then return null; end;
  select jsonb_build_object(
    'id', delivery.id, 'subject_names', delivery.subject_names, 'provider', delivery.provider,
    'folder_url', delivery.folder_url, 'expected_count', delivery.expected_count,
    'uploaded_count', delivery.uploaded_count, 'status', delivery.status, 'note', delivery.note,
    'updated_at', delivery.updated_at, 'sender_name', sender.name,
    'session_spot', spot.name, 'session_location', spot.general_location,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', message.id, 'name', coalesce(profile.name, message.guest_name), 'body', message.body, 'created_at', message.created_at) order by message.created_at)
      from public.clip_delivery_messages message left join public.profiles profile on profile.id = message.sender_user where message.delivery_id = delivery.id), '[]'::jsonb)
  ) into result
  from public.clip_deliveries delivery
  join public.profiles sender on sender.id = delivery.sender
  left join public.sessions session on session.id = delivery.session_id
  left join public.spots spot on spot.id = session.spot_id
  where delivery.guest_access_token = token and delivery.status <> 'cancelled';
  return result;
end $$;

create or replace function public.add_guest_clip_message(access_token text, display_name text, message_body text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare token uuid; delivery_uuid uuid; new_id uuid;
begin
  begin token := access_token::uuid; exception when others then raise exception 'Invalid guest link'; end;
  if char_length(trim(display_name)) not between 1 and 80 then raise exception 'Add your first name'; end if;
  if char_length(trim(message_body)) not between 1 and 1000 then raise exception 'Message must be 1 to 1000 characters'; end if;
  select id into delivery_uuid from public.clip_deliveries where guest_access_token = token and status <> 'cancelled';
  if delivery_uuid is null then raise exception 'Guest link is invalid or no longer active'; end if;
  insert into public.clip_delivery_messages(delivery_id, guest_name, body)
    values(delivery_uuid, trim(display_name), trim(message_body)) returning id into new_id;
  return new_id;
end $$;

create or replace function public.notify_clip_delivery_message()
returns trigger language plpgsql security definer set search_path = public
as $$
declare delivery public.clip_deliveries; target uuid; sender_label text;
begin
  select * into delivery from public.clip_deliveries where id = new.delivery_id;
  if new.sender_user is null then
    target := delivery.sender; sender_label := coalesce(new.guest_name, delivery.recipient_name, 'Your guest');
  elsif new.sender_user = delivery.sender then
    target := delivery.recipient; select name into sender_label from public.profiles where id = delivery.sender;
  else
    target := delivery.sender; select name into sender_label from public.profiles where id = new.sender_user;
  end if;
  if target is not null then
    perform public.enqueue_notification(target, 'clip_delivery', 'New clip delivery message',
      coalesce(sender_label, 'Someone') || ': ' || left(new.body, 140), './?open=clips&delivery=' || delivery.id, delivery.id);
  end if;
  return new;
end $$;
drop trigger if exists notify_clip_delivery_message on public.clip_delivery_messages;
create trigger notify_clip_delivery_message after insert on public.clip_delivery_messages
for each row execute function public.notify_clip_delivery_message();

-- Context stored on an existing one-use invite. Community invites remain the default.
alter table public.invites add column if not exists purpose text not null default 'community';
alter table public.invites add column if not exists session_id uuid references public.sessions(id) on delete set null;
alter table public.invites add column if not exists clip_delivery_id uuid references public.clip_deliveries(id) on delete set null;
alter table public.invites add column if not exists intended_name text;
alter table public.invites add column if not exists claim_completed_at timestamptz;
alter table public.invites drop constraint if exists invites_purpose_check;
alter table public.invites add constraint invites_purpose_check
  check (purpose in ('community','plan_session','claim_session','claim_delivery'));

create or replace function public.create_context_invite(
  invite_region uuid default null,
  invite_purpose text default 'community',
  claim_session uuid default null,
  claim_delivery uuid default null,
  invite_name text default null
) returns text language plpgsql security definer set search_path = public
as $$
declare new_code text;
begin
  if not public.is_member() then raise exception 'Community membership required'; end if;
  if invite_purpose not in ('community','plan_session','claim_session','claim_delivery') then raise exception 'Unknown invite purpose'; end if;
  if invite_region is not null and not exists (select 1 from public.regions where id = invite_region and is_active) then raise exception 'Location not found'; end if;
  if invite_name is not null and char_length(trim(invite_name)) not between 1 and 80 then raise exception 'Use a first name under 80 characters'; end if;

  if invite_purpose = 'claim_session' and not exists (
    select 1 from public.sessions where id = claim_session and author = auth.uid() and initiator_user is null
  ) then raise exception 'That session cannot be claimed'; end if;

  if invite_purpose = 'claim_delivery' and not exists (
    select 1 from public.clip_deliveries where id = claim_delivery and sender = auth.uid() and recipient is null
  ) then raise exception 'That clip delivery cannot be claimed'; end if;

  new_code := 'SODIUM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.invites(code, created_by, max_uses, region_id, purpose, session_id, clip_delivery_id, intended_name)
  values(new_code, auth.uid(), 1, invite_region, invite_purpose, claim_session, claim_delivery, nullif(trim(invite_name), ''));
  return new_code;
end $$;

create or replace function public.redeem_invite(
  invite_code text,
  profile_name text default null,
  profile_phone text default null,
  profile_region text default null
) returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare
  invite_row public.invites;
  region_uuid uuid;
  result public.profiles;
  resolved_name text;
  resolved_phone text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into invite_row from public.invites
  where upper(code) = upper(trim(invite_code))
    and revoked_at is null
    and (expires_at is null or expires_at > now())
    and use_count < max_uses
  for update;
  if not found then raise exception 'This invite is invalid, expired, or already used'; end if;

  select * into result from public.profiles where id = auth.uid();
  if not found then
    resolved_name := coalesce(
      nullif(trim(profile_name), ''),
      nullif(trim(auth.jwt() -> 'user_metadata' ->> 'name'), ''),
      nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
      'New member'
    );
    resolved_phone := coalesce(nullif(trim(profile_phone), ''), nullif(trim(auth.jwt() -> 'user_metadata' ->> 'phone'), ''));
    select id into region_uuid from public.regions
    where lower(name) = lower(coalesce(profile_region, auth.jwt() -> 'user_metadata' ->> 'home_region', 'California')) limit 1;

    insert into public.profiles(id, name, phone, home_region)
    values(auth.uid(), resolved_name, resolved_phone, region_uuid)
    returning * into result;
  end if;

  if invite_row.region_id is not null then
    insert into public.region_memberships(user_id, region_id, notifications_enabled)
    values(auth.uid(), invite_row.region_id, true)
    on conflict (user_id, region_id) do update set notifications_enabled = true;
  end if;

  if invite_row.purpose = 'claim_session' then
    update public.sessions
    set initiator_user = auth.uid(), initiator_name = result.name, initiator_claimed_at = now()
    where id = invite_row.session_id and initiator_user is null;
    if not found then raise exception 'This session was already claimed'; end if;
  elsif invite_row.purpose = 'claim_delivery' then
    update public.clip_deliveries
    set recipient = auth.uid(), recipient_name = result.name
    where id = invite_row.clip_delivery_id and recipient is null;
    if not found then raise exception 'This clip delivery was already claimed'; end if;
  end if;

  update public.invites
  set use_count = use_count + 1,
      used_by = auth.uid(),
      claim_completed_at = case when purpose in ('claim_session','claim_delivery') then now() else claim_completed_at end
  where id = invite_row.id;
  return result;
end $$;

-- Notify a recipient when a pending clip handoff becomes theirs.
create or replace function public.notify_clip_delivery()
returns trigger language plpgsql security definer set search_path = public
as $$
declare sender_name text;
begin
  select name into sender_name from public.profiles where id = new.sender;
  if new.recipient is null then return new; end if;

  if (tg_op = 'INSERT' and new.status = 'ready')
     or (tg_op = 'UPDATE' and old.recipient is null and new.recipient is not null and new.status = 'ready') then
    perform public.enqueue_notification(new.recipient,'clip_delivery','Your clips are ready',
      new.expected_count || ' clips of ' || array_to_string(new.subject_names, ', ') || ' from ' || coalesce(sender_name, 'your filmer') || ' are ready.',
      './?open=clips&delivery=' || new.id,new.id);
  elsif tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.recipient is null and new.recipient is not null) then
    perform public.enqueue_notification(new.recipient,'clip_delivery','Clips are on the way',
      coalesce(sender_name, 'A filmer') || ' is sending you ' || new.expected_count || ' clips of ' || array_to_string(new.subject_names, ', ') || '.',
      './?open=clips&delivery=' || new.id,new.id);
  elsif new.status = 'ready' and old.status is distinct from 'ready' then
    perform public.enqueue_notification(new.recipient,'clip_delivery','Your clips are ready',
      new.expected_count || ' clips of ' || array_to_string(new.subject_names, ', ') || ' from ' || coalesce(sender_name, 'your filmer') || ' are ready.',
      './?open=clips&delivery=' || new.id,new.id);
  end if;
  return new;
end $$;

revoke all on function public.create_context_invite(uuid,text,uuid,uuid,text) from public, anon;
grant execute on function public.create_context_invite(uuid,text,uuid,uuid,text) to authenticated;
grant execute on function public.redeem_invite(text,text,text,text) to authenticated;
revoke all on function public.create_guest_clip_link(uuid) from public, anon;
grant execute on function public.create_guest_clip_link(uuid) to authenticated;
grant execute on function public.get_guest_clip_delivery(text), public.add_guest_clip_message(text,text,text) to anon, authenticated;
revoke execute on function public.normalize_session_initiator(), public.award_finished_surf(), public.notify_clip_delivery()
from public, anon, authenticated;
revoke execute on function public.lock_claimed_clip_recipient() from public, anon, authenticated;
revoke execute on function public.notify_clip_delivery_message() from public, anon, authenticated;

commit;

select 'Sodium session attribution and contextual invites complete' as result;
