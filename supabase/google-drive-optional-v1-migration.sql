-- Sodium optional Google Drive folder picker + clip counting.
-- Additive only. Existing manual clip links and delivery history remain unchanged.

begin;

alter table public.clip_deliveries add column if not exists google_folder_id text;
alter table public.clip_deliveries add column if not exists google_folder_name text;

alter table public.clip_deliveries drop constraint if exists clip_deliveries_google_folder_id_check;
alter table public.clip_deliveries add constraint clip_deliveries_google_folder_id_check
  check (google_folder_id is null or char_length(google_folder_id) between 10 and 200);

alter table public.clip_deliveries drop constraint if exists clip_deliveries_google_folder_name_check;
alter table public.clip_deliveries add constraint clip_deliveries_google_folder_name_check
  check (google_folder_name is null or char_length(google_folder_name) between 1 and 240);

create table if not exists public.google_drive_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  encrypted_refresh_token text not null check (char_length(encrypted_refresh_token) between 40 and 4096),
  google_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_drive_connections enable row level security;
revoke all on table public.google_drive_connections from public, anon, authenticated;

comment on table public.google_drive_connections is
  'Private server-only OAuth refresh tokens encrypted by the Sodium Cloudflare function.';
comment on column public.clip_deliveries.google_folder_id is
  'Google Picker folder ID used only when tracking_mode is google_drive.';

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
    'tracking_mode', delivery.tracking_mode, 'google_folder_id', delivery.google_folder_id,
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

grant execute on function public.get_guest_clip_delivery(text) to anon, authenticated;

commit;

select 'Sodium optional Google Drive migration complete' as status;
