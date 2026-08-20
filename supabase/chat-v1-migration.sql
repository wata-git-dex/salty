-- Salty community chat + text-only DM migration
-- Run once in Supabase SQL Editor before publishing the chat release.

begin;

alter table public.room_messages alter column body drop not null;
alter table public.room_messages add column if not exists attachment_path text;
alter table public.room_messages add column if not exists attachment_type text;
alter table public.room_messages add column if not exists attachment_name text;
alter table public.room_messages add column if not exists attachment_size int;

alter table public.room_messages drop constraint if exists room_messages_body_check;
alter table public.room_messages drop constraint if exists room_messages_attachment_type_check;
alter table public.room_messages drop constraint if exists room_messages_attachment_size_check;
alter table public.room_messages drop constraint if exists room_messages_content_check;
alter table public.room_messages drop constraint if exists room_messages_attachment_complete_check;
alter table public.room_messages add constraint room_messages_body_check
  check (body is null or char_length(trim(body)) between 1 and 2000);
alter table public.room_messages add constraint room_messages_attachment_type_check
  check (attachment_type is null or attachment_type in ('image/jpeg','image/png','image/webp','image/gif'));
alter table public.room_messages add constraint room_messages_attachment_size_check
  check (attachment_size is null or attachment_size between 1 and 10485760);
alter table public.room_messages add constraint room_messages_content_check
  check (nullif(trim(body), '') is not null or attachment_path is not null);
alter table public.room_messages add constraint room_messages_attachment_complete_check
  check ((attachment_path is null and attachment_type is null and attachment_name is null and attachment_size is null)
    or (attachment_path is not null and attachment_type is not null and attachment_size is not null));

-- DMs are intentionally text-only. These columns remain for a safe additive
-- migration, but the database rejects any DM attachment now or later.
alter table public.dm_messages drop constraint if exists dm_messages_text_only_check;
alter table public.dm_messages add constraint dm_messages_text_only_check
  check (attachment_path is null and attachment_type is null and attachment_name is null and attachment_size is null)
  not valid;
alter table public.dm_messages validate constraint dm_messages_text_only_check;

-- Remove the legacy client upload permission for the unused DM bucket.
drop policy if exists salty_dm_insert on storage.objects;

drop policy if exists room_messages_insert_own on public.room_messages;
create policy room_messages_insert_own on public.room_messages for insert with check (
  public.is_member() and author = auth.uid()
  and (attachment_path is null or split_part(attachment_path, '/', 1) = auth.uid()::text)
);

-- Recipients can mark messages read without receiving permission to edit the
-- sender's text.
drop policy if exists dms_update_recipient on public.dm_messages;
revoke update on public.dm_messages from authenticated;
create or replace function public.mark_dm_read(other_user uuid)
returns void language sql security definer set search_path = public
as $$
  update public.dm_messages set read_at = now()
  where sender = other_user and recipient = auth.uid() and read_at is null;
$$;
revoke all on function public.mark_dm_read(uuid) from public, anon;
grant execute on function public.mark_dm_read(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('salty-chat', 'salty-chat', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists salty_chat_read on storage.objects;
drop policy if exists salty_chat_insert on storage.objects;
drop policy if exists salty_chat_delete_own on storage.objects;
create policy salty_chat_read on storage.objects for select to authenticated
using (bucket_id = 'salty-chat' and public.is_member());
create policy salty_chat_insert on storage.objects for insert to authenticated
with check (bucket_id = 'salty-chat' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy salty_chat_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'salty-chat' and owner_id = auth.uid()::text);

commit;

select 'Salty chat migration complete' as result;
