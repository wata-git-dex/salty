-- Salty beta feedback: member issue reports + private screenshots + admin workflow.
-- Run once in the Supabase SQL Editor before using v1.48.

begin;

create table if not exists public.beta_issue_reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('broken','confusing','suggestion','other')),
  description text not null check (char_length(trim(description)) between 1 and 2000),
  expected_behavior text check (expected_behavior is null or char_length(trim(expected_behavior)) between 1 and 2000),
  screen text check (screen is null or char_length(screen) <= 120),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  user_agent text check (user_agent is null or char_length(user_agent) <= 1000),
  screenshot_path text check (
    screenshot_path is null
    or split_part(screenshot_path, '/', 1) = reporter::text
  ),
  status text not null default 'new' check (status in ('new','reviewing','fixed','closed')),
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists beta_issue_reports_status_created_idx
  on public.beta_issue_reports (status, created_at desc);
create index if not exists beta_issue_reports_reporter_created_idx
  on public.beta_issue_reports (reporter, created_at desc);

alter table public.beta_issue_reports enable row level security;

drop policy if exists beta_issue_reports_insert_own on public.beta_issue_reports;
drop policy if exists beta_issue_reports_read_own_or_admin on public.beta_issue_reports;
drop policy if exists beta_issue_reports_update_admin on public.beta_issue_reports;
drop policy if exists beta_issue_reports_delete_admin on public.beta_issue_reports;

create policy beta_issue_reports_insert_own on public.beta_issue_reports
for insert to authenticated
with check (public.is_member() and reporter = auth.uid());

create policy beta_issue_reports_read_own_or_admin on public.beta_issue_reports
for select to authenticated
using (reporter = auth.uid() or public.is_admin());

create policy beta_issue_reports_update_admin on public.beta_issue_reports
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy beta_issue_reports_delete_admin on public.beta_issue_reports
for delete to authenticated
using (public.is_admin());

grant select, insert, update, delete on public.beta_issue_reports to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('salty-feedback', 'salty-feedback', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists salty_feedback_insert_own on storage.objects;
drop policy if exists salty_feedback_read_own_or_admin on storage.objects;
drop policy if exists salty_feedback_delete_admin on storage.objects;
drop policy if exists salty_feedback_delete_own_or_admin on storage.objects;

create policy salty_feedback_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'salty-feedback'
  and public.is_member()
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy salty_feedback_read_own_or_admin on storage.objects
for select to authenticated
using (
  bucket_id = 'salty-feedback'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

create policy salty_feedback_delete_own_or_admin on storage.objects
for delete to authenticated
using (
  bucket_id = 'salty-feedback'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

commit;

select 'Salty beta feedback migration complete' as result;
