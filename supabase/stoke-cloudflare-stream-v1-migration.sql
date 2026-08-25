-- Sodium Stoke: Cloudflare Stream video carousels.
-- Safe additive migration. Existing Supabase photo and legacy clip posts remain unchanged.

begin;

create table if not exists public.post_stream_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  creator uuid not null references public.profiles(id) on delete cascade,
  position smallint not null check (position between 0 and 4),
  stream_uid text not null check (stream_uid ~ '^[A-Za-z0-9_-]{20,80}$'),
  status text not null default 'processing' check (status in ('uploading','processing','ready','error')),
  duration_seconds numeric,
  input_width integer,
  input_height integer,
  preview_url text,
  thumbnail_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, position),
  unique (stream_uid)
);

create index if not exists post_stream_media_post_id_idx
  on public.post_stream_media(post_id, position);

alter table public.post_stream_media enable row level security;

drop policy if exists post_stream_media_read on public.post_stream_media;
create policy post_stream_media_read on public.post_stream_media
for select to authenticated
using (public.is_member());

drop policy if exists post_stream_media_insert_own on public.post_stream_media;
create policy post_stream_media_insert_own on public.post_stream_media
for insert to authenticated
with check (
  public.is_member()
  and creator = auth.uid()
  and exists (
    select 1 from public.posts p
    where p.id = post_id and p.author = auth.uid()
  )
);

drop policy if exists post_stream_media_update_own on public.post_stream_media;
create policy post_stream_media_update_own on public.post_stream_media
for update to authenticated
using (creator = auth.uid())
with check (
  creator = auth.uid()
  and exists (
    select 1 from public.posts p
    where p.id = post_id and p.author = auth.uid()
  )
);

drop policy if exists post_stream_media_delete_own on public.post_stream_media;
create policy post_stream_media_delete_own on public.post_stream_media
for delete to authenticated
using (
  creator = auth.uid()
  or public.is_admin()
);

grant select, insert, update, delete on public.post_stream_media to authenticated;

commit;

select 'Sodium Cloudflare Stream media schema ready' as result;
