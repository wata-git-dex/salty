-- Sodium member Marketplace: a lightweight directory, never a commerce system.
-- Safe to run after the existing Sodium schema.
begin;

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  brand_name text check (brand_name is null or char_length(trim(brand_name)) between 1 and 120),
  description text not null check (char_length(trim(description)) between 1 and 1200),
  category text not null check (category in ('Boards & Shaping','Repair & Glass','Photography & Film','Art & Prints','Clothing & Gear','Services','Coaching','Other')),
  image_path text,
  external_url text not null check (external_url ~ '^https?://'),
  social_url text check (social_url is null or social_url ~ '^https?://'),
  location text check (location is null or char_length(trim(location)) <= 160),
  has_member_perk boolean not null default false,
  perk_description text check (perk_description is null or char_length(trim(perk_description)) <= 300),
  discount_code text check (discount_code is null or char_length(trim(discount_code)) <= 80),
  status text not null default 'pending' check (status in ('draft','pending','approved','rejected','inactive')),
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (has_member_perk or (perk_description is null and discount_code is null))
);

create index if not exists marketplace_listings_owner_idx on public.marketplace_listings(owner_id, created_at desc);
create index if not exists marketplace_listings_browse_idx on public.marketplace_listings(status, featured desc, created_at desc);

create or replace function public.protect_marketplace_listing()
returns trigger
language plpgsql
set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  new.updated_at := now();
  -- Dashboard/migrations run as postgres without an authenticated JWT.
  if auth.uid() is null then return new; end if;
  if public.is_admin() then return new; end if;
  if new.owner_id <> auth.uid() then raise exception 'A listing must belong to you'; end if;
  if tg_op = 'UPDATE' and new.owner_id <> old.owner_id then raise exception 'Listing owner cannot be changed'; end if;
  if new.featured then raise exception 'Only a Sodium admin can feature a listing'; end if;
  if tg_op = 'INSERT' and new.status not in ('draft','pending') then raise exception 'New listings must be submitted for review'; end if;
  if tg_op = 'UPDATE' and new.status not in ('draft','pending','inactive',old.status) then raise exception 'Only a Sodium admin can approve a listing'; end if;
  return new;
end
$$;

drop trigger if exists marketplace_listings_protect on public.marketplace_listings;
create trigger marketplace_listings_protect before insert or update on public.marketplace_listings
for each row execute function public.protect_marketplace_listing();

alter table public.marketplace_listings enable row level security;
drop policy if exists marketplace_listings_read on public.marketplace_listings;
drop policy if exists marketplace_listings_insert_own on public.marketplace_listings;
drop policy if exists marketplace_listings_update_own on public.marketplace_listings;
drop policy if exists marketplace_listings_delete_own on public.marketplace_listings;
create policy marketplace_listings_read on public.marketplace_listings for select to authenticated
using (public.is_member() and (status = 'approved' or owner_id = auth.uid() or public.is_admin()));
create policy marketplace_listings_insert_own on public.marketplace_listings for insert to authenticated
with check (public.is_member() and (owner_id = auth.uid() or public.is_admin()));
create policy marketplace_listings_update_own on public.marketplace_listings for update to authenticated
using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
create policy marketplace_listings_delete_own on public.marketplace_listings for delete to authenticated
using (owner_id = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.marketplace_listings to authenticated;
revoke all on function public.protect_marketplace_listing() from public, anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sodium-marketplace','sodium-marketplace',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sodium_marketplace_read on storage.objects;
drop policy if exists sodium_marketplace_insert_own on storage.objects;
drop policy if exists sodium_marketplace_update_own on storage.objects;
drop policy if exists sodium_marketplace_delete_own on storage.objects;
create policy sodium_marketplace_read on storage.objects for select to authenticated
using (bucket_id = 'sodium-marketplace' and public.is_member());
create policy sodium_marketplace_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'sodium-marketplace' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy sodium_marketplace_update_own on storage.objects for update to authenticated
using (bucket_id = 'sodium-marketplace' and owner_id = auth.uid()::text)
with check (bucket_id = 'sodium-marketplace' and owner_id = auth.uid()::text);
create policy sodium_marketplace_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'sodium-marketplace' and (owner_id = auth.uid()::text or public.is_admin()));

-- Controlled first listings. They are only seeded when the founding admin exists.
insert into public.marketplace_listings (owner_id,title,brand_name,description,category,external_url,has_member_perk,perk_description,status,featured)
select profile.id,'Saltyviewfinder Store','Saltyviewfinder','Photography, prints, and projects from the crew.','Photography & Film','https://saltyviewfinder.com',true,'Sodium member discount.','approved',true
from public.profiles profile join auth.users account on account.id = profile.id
where lower(account.email) = 'saltyviewfinder@gmail.com' and profile.is_admin
  and not exists (select 1 from public.marketplace_listings where owner_id = profile.id and title = 'Saltyviewfinder Store');

insert into public.marketplace_listings (owner_id,title,brand_name,description,category,external_url,has_member_perk,perk_description,status,featured)
select profile.id,'Water Access To All Store','WATA','Support Water Access To All and its clean-water work.','Clothing & Gear','https://cleanwata.org',true,'Sodium member discount.','approved',false
from public.profiles profile join auth.users account on account.id = profile.id
where lower(account.email) = 'saltyviewfinder@gmail.com' and profile.is_admin
  and not exists (select 1 from public.marketplace_listings where owner_id = profile.id and title = 'Water Access To All Store');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'marketplace_listings'
  ) then alter publication supabase_realtime add table public.marketplace_listings; end if;
end $$;

commit;

select 'Sodium Marketplace migration complete' as result;
