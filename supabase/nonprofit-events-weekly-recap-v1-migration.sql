-- Nonprofit events + automatic weekly recap support.
-- Additive and safe for an existing Sodium database. Existing events remain community events.

create table if not exists public.nonprofit_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 160),
  website_url text,
  logo_url text,
  logo_path text,
  summary text check (summary is null or char_length(trim(summary)) between 1 and 500),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (website_url is null or website_url ~ '^https://'),
  check (logo_url is null or logo_url ~ '^https://')
);

create unique index if not exists nonprofit_organizations_name_key
  on public.nonprofit_organizations (lower(name));

alter table public.nonprofit_organizations
  add column if not exists logo_path text;

insert into public.nonprofit_organizations (name, website_url, logo_url, summary, active)
select
  'Water Access To All',
  'https://www.cleanwata.org/',
  'https://static.wixstatic.com/media/db3616_5f5b48a47c2546be9449580e11170c9a~mv2.png/v1/fill/w_240,h_240,al_c,q_90/Wata%20-%20Icon%20-%20Black%20and%20Blue.png',
  'Clean-water access through sustainable filtration systems and community-led partnerships.',
  true
where not exists (
  select 1 from public.nonprofit_organizations where lower(name) = lower('Water Access To All')
);

update public.nonprofit_organizations
set website_url = 'https://www.cleanwata.org/',
    logo_url = coalesce(logo_url, 'https://static.wixstatic.com/media/db3616_5f5b48a47c2546be9449580e11170c9a~mv2.png/v1/fill/w_240,h_240,al_c,q_90/Wata%20-%20Icon%20-%20Black%20and%20Blue.png'),
    summary = coalesce(summary, 'Clean-water access through sustainable filtration systems and community-led partnerships.'),
    active = true,
    updated_at = now()
where lower(name) = lower('Water Access To All');

alter table public.events
  add column if not exists event_kind text not null default 'community',
  add column if not exists nonprofit_id uuid references public.nonprofit_organizations(id) on delete set null,
  add column if not exists official_url text,
  add column if not exists external_source text not null default 'manual',
  add column if not exists external_event_id text;

alter table public.events drop constraint if exists events_event_kind_check;
alter table public.events add constraint events_event_kind_check
  check (event_kind in ('community', 'nonprofit'));

alter table public.events drop constraint if exists events_nonprofit_kind_check;
alter table public.events add constraint events_nonprofit_kind_check
  check (event_kind = 'community' or nonprofit_id is not null);

alter table public.events drop constraint if exists events_official_url_check;
alter table public.events add constraint events_official_url_check
  check (official_url is null or official_url ~ '^https://');

alter table public.events drop constraint if exists events_external_source_check;
alter table public.events add constraint events_external_source_check
  check (external_source in ('manual', 'calendar_feed'));

create unique index if not exists events_external_source_key
  on public.events (nonprofit_id, external_source, external_event_id)
  where external_event_id is not null;

alter table public.nonprofit_organizations enable row level security;

drop policy if exists nonprofit_organizations_read on public.nonprofit_organizations;
create policy nonprofit_organizations_read on public.nonprofit_organizations for select
  using (public.is_member() and (active or public.is_admin()));

drop policy if exists nonprofit_organizations_admin_write on public.nonprofit_organizations;
create policy nonprofit_organizations_admin_write on public.nonprofit_organizations for all
  using (public.is_admin()) with check (public.is_admin());

-- Members can continue creating their own community events. Only admins can attach
-- an event to a nonprofit, which prevents an unverified partnership from appearing.
drop policy if exists events_insert_own on public.events;
create policy events_insert_own on public.events for insert
  with check (
    public.is_member() and author = auth.uid()
    and (event_kind = 'community' or public.is_admin())
  );

drop policy if exists events_update_own on public.events;
create policy events_update_own on public.events for update
  using (author = auth.uid() or public.is_admin())
  with check (
    (author = auth.uid() or public.is_admin())
    and (event_kind = 'community' or public.is_admin())
  );

drop policy if exists events_delete_own on public.events;
create policy events_delete_own on public.events for delete
  using (author = auth.uid() or public.is_admin());

grant select on public.nonprofit_organizations to authenticated;
grant insert, update, delete on public.nonprofit_organizations to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sodium-nonprofits', 'sodium-nonprofits', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sodium_nonprofits_read on storage.objects;
create policy sodium_nonprofits_read on storage.objects for select to authenticated
  using (bucket_id = 'sodium-nonprofits' and public.is_member());
drop policy if exists sodium_nonprofits_insert_admin on storage.objects;
create policy sodium_nonprofits_insert_admin on storage.objects for insert to authenticated
  with check (bucket_id = 'sodium-nonprofits' and public.is_admin());
drop policy if exists sodium_nonprofits_update_admin on storage.objects;
create policy sodium_nonprofits_update_admin on storage.objects for update to authenticated
  using (bucket_id = 'sodium-nonprofits' and public.is_admin())
  with check (bucket_id = 'sodium-nonprofits' and public.is_admin());
drop policy if exists sodium_nonprofits_delete_admin on storage.objects;
create policy sodium_nonprofits_delete_admin on storage.objects for delete to authenticated
  using (bucket_id = 'sodium-nonprofits' and public.is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'nonprofit_organizations'
  ) then
    alter publication supabase_realtime add table public.nonprofit_organizations;
  end if;
end $$;
