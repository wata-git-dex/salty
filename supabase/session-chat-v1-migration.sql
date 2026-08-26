-- Sodium session chat
-- Private, text-only crew threads tied to a surf session.

begin;

create table if not exists public.session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete cascade not null,
  author uuid references public.profiles(id) on delete cascade not null,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists session_messages_session_created_idx
  on public.session_messages(session_id, created_at);

create table if not exists public.session_message_reads (
  session_id uuid references public.sessions(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  last_read_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create or replace function public.is_session_chat_member(target_session uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.sessions session
    where session.id = target_session
      and (
        session.author = auth.uid()
        or session.initiator_user = auth.uid()
        or session.featured_surfer_user = auth.uid()
        or exists (
          select 1 from public.session_rsvps rsvp
          where rsvp.session_id = session.id and rsvp.user_id = auth.uid()
        )
      )
  )
$$;

alter table public.session_messages enable row level security;
alter table public.session_message_reads enable row level security;

drop policy if exists session_messages_read_crew on public.session_messages;
create policy session_messages_read_crew on public.session_messages for select to authenticated
using (public.is_member() and public.is_session_chat_member(session_id));

drop policy if exists session_messages_insert_crew on public.session_messages;
create policy session_messages_insert_crew on public.session_messages for insert to authenticated
with check (public.is_member() and author = auth.uid() and public.is_session_chat_member(session_id));

drop policy if exists session_messages_update_own on public.session_messages;
create policy session_messages_update_own on public.session_messages for update to authenticated
using (author = auth.uid() and public.is_session_chat_member(session_id))
with check (author = auth.uid() and public.is_session_chat_member(session_id));

drop policy if exists session_messages_delete_own on public.session_messages;
create policy session_messages_delete_own on public.session_messages for delete to authenticated
using (author = auth.uid() and public.is_session_chat_member(session_id));

drop policy if exists session_message_reads_own on public.session_message_reads;
create policy session_message_reads_own on public.session_message_reads for all to authenticated
using (user_id = auth.uid() and public.is_session_chat_member(session_id))
with check (user_id = auth.uid() and public.is_session_chat_member(session_id));

alter table public.message_reactions
  add column if not exists session_message_id uuid references public.session_messages(id) on delete cascade;
alter table public.message_reactions drop constraint if exists message_reactions_check;
alter table public.message_reactions drop constraint if exists message_reactions_one_parent_check;
alter table public.message_reactions add constraint message_reactions_one_parent_check check (
  (room_message_id is not null)::int
  + (dm_message_id is not null)::int
  + (session_message_id is not null)::int = 1
);
create unique index if not exists message_reactions_session_unique
  on public.message_reactions(session_message_id, user_id, emoji)
  where session_message_id is not null;

drop policy if exists message_reactions_read on public.message_reactions;
create policy message_reactions_read on public.message_reactions for select to authenticated using (
  public.is_member() and (
    (room_message_id is not null and exists (select 1 from public.room_messages message where message.id = room_message_id))
    or (dm_message_id is not null and exists (select 1 from public.dm_messages message where message.id = dm_message_id and auth.uid() in (message.sender, message.recipient)))
    or (session_message_id is not null and exists (select 1 from public.session_messages message where message.id = session_message_id and public.is_session_chat_member(message.session_id)))
  )
);

drop policy if exists message_reactions_insert_own on public.message_reactions;
create policy message_reactions_insert_own on public.message_reactions for insert to authenticated with check (
  public.is_member() and user_id = auth.uid() and (
    (room_message_id is not null and exists (select 1 from public.room_messages message where message.id = room_message_id))
    or (dm_message_id is not null and exists (select 1 from public.dm_messages message where message.id = dm_message_id and auth.uid() in (message.sender, message.recipient)))
    or (session_message_id is not null and exists (select 1 from public.session_messages message where message.id = session_message_id and public.is_session_chat_member(message.session_id)))
  )
);

create or replace function public.touch_session_message_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists touch_session_message_updated_at on public.session_messages;
create trigger touch_session_message_updated_at before update on public.session_messages
for each row execute function public.touch_session_message_updated_at();

create or replace function public.notify_new_session_message()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  crew_member record;
  sender_name text;
  place_name text;
  session_region uuid;
  notification_body text;
begin
  select name into sender_name from public.profiles where id = new.author;
  select spot.name, session.region_id into place_name, session_region
  from public.sessions session left join public.spots spot on spot.id = session.spot_id
  where session.id = new.session_id;
  notification_body := case when char_length(new.body) > 120 then left(new.body, 117) || '…' else new.body end;

  for crew_member in
    select distinct member_id from (
      select session.author as member_id from public.sessions session where session.id = new.session_id
      union all select session.initiator_user from public.sessions session where session.id = new.session_id
      union all select session.featured_surfer_user from public.sessions session where session.id = new.session_id
      union all select rsvp.user_id from public.session_rsvps rsvp where rsvp.session_id = new.session_id
    ) crew
    where member_id is not null and member_id <> new.author
  loop
    perform public.enqueue_notification(
      crew_member.member_id,
      'direct_message',
      coalesce(place_name, 'Session chat'),
      coalesce(sender_name, 'A friend') || ': ' || notification_body,
      './?open=session-chat&session=' || new.session_id::text || '&region=' || session_region::text,
      new.id
    );
  end loop;
  return new;
end $$;

drop trigger if exists notify_new_session_message on public.session_messages;
create trigger notify_new_session_message after insert on public.session_messages
for each row execute function public.notify_new_session_message();

grant select, insert, update, delete on public.session_messages to authenticated;
grant select, insert, update, delete on public.session_message_reads to authenticated;
revoke all on function public.is_session_chat_member(uuid) from public, anon;
grant execute on function public.is_session_chat_member(uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.session_messages;
exception when duplicate_object then null;
end $$;

commit;
