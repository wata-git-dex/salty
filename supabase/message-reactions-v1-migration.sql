-- Sodium message actions v1
-- Positive reactions plus safe owner editing for text-only DMs.

begin;

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  room_message_id uuid references public.room_messages(id) on delete cascade,
  dm_message_id uuid references public.dm_messages(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade not null,
  emoji text not null check (emoji in ('🌊', '🔥', '😂', '❤️')),
  created_at timestamptz not null default now(),
  check ((room_message_id is not null)::int + (dm_message_id is not null)::int = 1)
);

create unique index if not exists message_reactions_room_unique
  on public.message_reactions (room_message_id, user_id, emoji)
  where room_message_id is not null;
create unique index if not exists message_reactions_dm_unique
  on public.message_reactions (dm_message_id, user_id, emoji)
  where dm_message_id is not null;

alter table public.message_reactions enable row level security;

drop policy if exists message_reactions_read on public.message_reactions;
create policy message_reactions_read on public.message_reactions for select to authenticated using (
  public.is_member() and (
    (room_message_id is not null and exists (
      select 1 from public.room_messages message where message.id = room_message_id
    ))
    or
    (dm_message_id is not null and exists (
      select 1 from public.dm_messages message
      where message.id = dm_message_id and auth.uid() in (message.sender, message.recipient)
    ))
  )
);

drop policy if exists message_reactions_insert_own on public.message_reactions;
create policy message_reactions_insert_own on public.message_reactions for insert to authenticated with check (
  public.is_member() and user_id = auth.uid() and (
    (room_message_id is not null and exists (
      select 1 from public.room_messages message where message.id = room_message_id
    ))
    or
    (dm_message_id is not null and exists (
      select 1 from public.dm_messages message
      where message.id = dm_message_id and auth.uid() in (message.sender, message.recipient)
    ))
  )
);

drop policy if exists message_reactions_delete_own on public.message_reactions;
create policy message_reactions_delete_own on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists dms_update_sender on public.dm_messages;
create policy dms_update_sender on public.dm_messages for update to authenticated
  using (sender = auth.uid()) with check (sender = auth.uid());

grant select, insert, delete on public.message_reactions to authenticated;
grant update on public.dm_messages to authenticated;

do $realtime$
begin
  alter publication supabase_realtime add table public.message_reactions;
exception when duplicate_object then null;
end
$realtime$;

commit;
