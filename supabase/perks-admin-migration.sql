-- Salty v24: editable perks plus the first Saltyviewfinder and WATA discounts.
-- Safe to run more than once.

begin;

alter table public.rewards
  add column if not exists brand_name text,
  add column if not exists offer_text text,
  add column if not exists description text,
  add column if not exists discount_code text,
  add column if not exists store_url text,
  add column if not exists active boolean not null default true,
  add column if not exists sort_order int not null default 100,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.rewards drop constraint if exists rewards_brand_name_check;
alter table public.rewards add constraint rewards_brand_name_check
  check (brand_name is null or char_length(trim(brand_name)) between 1 and 80);
alter table public.rewards drop constraint if exists rewards_offer_text_check;
alter table public.rewards add constraint rewards_offer_text_check
  check (offer_text is null or char_length(trim(offer_text)) between 1 and 120);
alter table public.rewards drop constraint if exists rewards_store_url_check;
alter table public.rewards add constraint rewards_store_url_check
  check (store_url is null or store_url ~ '^https?://');

-- Retire the original placeholder rewards without deleting any historical claims.
update public.rewards
set active = false, updated_at = now()
where name in ('Sodium — 20% off', 'Salty Viewfinder — 15% off', 'Water Merch community hoodie', 'Snake Eyes — 10% off fins');

insert into public.rewards (name, points_cost, type, brand_name, offer_text, description, store_url, active, sort_order)
select 'Saltyviewfinder Store Discount', 0, 'discount', 'Saltyviewfinder', 'Salty member discount',
       'Sodium merch, prints, and more.', 'https://saltyviewfinder.com', true, 10
where not exists (select 1 from public.rewards where name = 'Saltyviewfinder Store Discount');

insert into public.rewards (name, points_cost, type, brand_name, offer_text, description, store_url, active, sort_order)
select 'WATA Store Discount', 0, 'discount', 'WATA', 'Salty member discount',
       'Support WATA and save on store gear.', 'https://cleanwata.org', true, 20
where not exists (select 1 from public.rewards where name = 'WATA Store Discount');

insert into public.brands (name) values ('WATA') on conflict (name) do nothing;

-- Bootstrap the owner's existing Salty profile as the first perks admin.
update public.profiles as profile
set is_admin = true
from auth.users account
where profile.id = account.id
  and lower(account.email) = 'saltyviewfinder@gmail.com';

commit;

select 'Salty perks + admin migration complete' as result;
