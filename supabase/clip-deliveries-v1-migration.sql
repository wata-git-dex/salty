-- Sodium clip deliveries v1
-- Provider-neutral delivery tracking for Google Drive, Dropbox, iCloud, and other links.
-- Videos remain with the storage provider; Sodium stores only delivery metadata.

begin;

create table if not exists public.clip_deliveries (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references public.profiles(id) on delete cascade,
  recipient uuid not null references public.profiles(id) on delete cascade,
  subject_names text[] not null default '{}'
    check (cardinality(subject_names) between 1 and 20),
  session_id uuid references public.sessions(id) on delete set null,
  provider text not null default 'other'
    check (provider in ('google_drive','dropbox','icloud','other')),
  folder_url text not null
    check (char_length(folder_url) between 8 and 2048 and folder_url ~ '^https://'),
  expected_count integer not null check (expected_count between 1 and 2000),
  uploaded_count integer not null default 0 check (uploaded_count between 0 and 2000),
  tracking_mode text not null default 'manual'
    check (tracking_mode in ('manual','google_drive','dropbox')),
  status text not null default 'uploading'
    check (status in ('uploading','ready','cancelled')),
  note text check (note is null or char_length(trim(note)) between 1 and 500),
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sender <> recipient)
);

create index if not exists clip_deliveries_sender_created_idx
  on public.clip_deliveries(sender, created_at desc);
create index if not exists clip_deliveries_recipient_created_idx
  on public.clip_deliveries(recipient, created_at desc);
create index if not exists clip_deliveries_session_idx
  on public.clip_deliveries(session_id) where session_id is not null;

create or replace function public.normalize_clip_delivery()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.uploaded_count := greatest(0, least(new.uploaded_count, 2000));
  new.updated_at := now();

  if new.status <> 'cancelled' then
    if new.uploaded_count >= new.expected_count then
      new.status := 'ready';
      new.ready_at := coalesce(new.ready_at, now());
    else
      new.status := 'uploading';
      new.ready_at := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists normalize_clip_delivery on public.clip_deliveries;
create trigger normalize_clip_delivery
before insert or update of expected_count, uploaded_count, status, folder_url, note, session_id
on public.clip_deliveries for each row execute function public.normalize_clip_delivery();

alter table public.clip_deliveries enable row level security;

drop policy if exists clip_deliveries_read_parties on public.clip_deliveries;
create policy clip_deliveries_read_parties on public.clip_deliveries for select
  using (public.is_member() and auth.uid() in (sender, recipient));

drop policy if exists clip_deliveries_insert_sender on public.clip_deliveries;
create policy clip_deliveries_insert_sender on public.clip_deliveries for insert
  with check (
    public.is_member() and sender = auth.uid() and recipient <> auth.uid()
    and exists (select 1 from public.profiles where id = recipient and onboarding_complete)
  );

drop policy if exists clip_deliveries_update_sender on public.clip_deliveries;
create policy clip_deliveries_update_sender on public.clip_deliveries for update
  using (sender = auth.uid()) with check (sender = auth.uid() and recipient <> auth.uid());

drop policy if exists clip_deliveries_delete_sender on public.clip_deliveries;
create policy clip_deliveries_delete_sender on public.clip_deliveries for delete
  using (sender = auth.uid());

grant select, insert, update, delete on public.clip_deliveries to authenticated;

-- Clip deliveries have their own preference so members can silence them
-- without disabling ordinary private-message notifications.
alter table public.notification_preferences
  add column if not exists clip_deliveries boolean not null default true;

alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check
  check (kind in ('new_session','new_stoke','direct_message','event','session_update','community_chat','clip_delivery'));

create or replace function public.notification_allowed(target_user uuid, notification_kind text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.push_subscriptions s where s.user_id = target_user)
    and coalesce((select p.master_enabled from public.notification_preferences p where p.user_id = target_user), true)
    and case notification_kind
      when 'new_session' then coalesce((select p.new_sessions from public.notification_preferences p where p.user_id = target_user), true)
      when 'new_stoke' then coalesce((select p.new_stoke from public.notification_preferences p where p.user_id = target_user), true)
      when 'direct_message' then coalesce((select p.direct_messages from public.notification_preferences p where p.user_id = target_user), true)
      when 'event' then coalesce((select p.events from public.notification_preferences p where p.user_id = target_user), true)
      when 'session_update' then coalesce((select p.session_updates from public.notification_preferences p where p.user_id = target_user), true)
      when 'community_chat' then coalesce((select p.community_chat from public.notification_preferences p where p.user_id = target_user), false)
      when 'clip_delivery' then coalesce((select p.clip_deliveries from public.notification_preferences p where p.user_id = target_user), true)
      else false end
$$;

create or replace function public.notify_clip_delivery()
returns trigger language plpgsql security definer set search_path = public
as $$
declare sender_name text;
begin
  select name into sender_name from public.profiles where id = new.sender;

  if tg_op = 'INSERT' and new.status = 'ready' then
    perform public.enqueue_notification(
      new.recipient,
      'clip_delivery',
      'Your clips are ready',
      new.expected_count || ' clips of ' || array_to_string(new.subject_names, ', ') || ' from ' || coalesce(sender_name, 'your filmer') || ' are ready.',
      './?open=clips&delivery=' || new.id,
      new.id
    );
  elsif tg_op = 'INSERT' then
    perform public.enqueue_notification(
      new.recipient,
      'clip_delivery',
      'Clips are on the way',
      coalesce(sender_name, 'A filmer') || ' is sending you ' || new.expected_count || ' clips of ' || array_to_string(new.subject_names, ', ') || '.',
      './?open=clips&delivery=' || new.id,
      new.id
    );
  elsif new.status = 'ready' and old.status is distinct from 'ready' then
    perform public.enqueue_notification(
      new.recipient,
      'clip_delivery',
      'Your clips are ready',
      new.expected_count || ' clips of ' || array_to_string(new.subject_names, ', ') || ' from ' || coalesce(sender_name, 'your filmer') || ' are ready.',
      './?open=clips&delivery=' || new.id,
      new.id
    );
  end if;
  return new;
end $$;

drop trigger if exists notify_clip_delivery on public.clip_deliveries;
create trigger notify_clip_delivery
after insert or update on public.clip_deliveries
for each row execute function public.notify_clip_delivery();

revoke execute on function public.normalize_clip_delivery(), public.notify_clip_delivery()
  from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clip_deliveries'
  ) then
    alter publication supabase_realtime add table public.clip_deliveries;
  end if;
end $$;

commit;

select 'Sodium clip deliveries v1 complete' as result;
