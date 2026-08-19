-- Salty session places + multiple starting surfers migration
-- Run once after profile-auth-migration.sql and before testing release v13.

begin;

alter table public.spots
  add column if not exists general_location text;

alter table public.spots
  drop constraint if exists spots_general_location_check;

alter table public.spots
  add constraint spots_general_location_check
  check (general_location is null or char_length(trim(general_location)) between 1 and 160);

-- Give existing spots a useful broad location until their creator edits them.
update public.spots spot
set general_location = region.name
from public.regions region
where spot.region_id = region.id
  and nullif(trim(spot.general_location), '') is null;

-- Spot names can repeat inside a region when their broader locations differ.
alter table public.spots
  drop constraint if exists spots_name_region_id_key;

drop index if exists public.spots_name_location_region_key;
create unique index spots_name_location_region_key
  on public.spots (region_id, lower(name), lower(coalesce(general_location, '')));

alter table public.sessions
  add column if not exists participant_names text[] not null default '{}';

-- Preserve any single surfer entered before this migration.
update public.sessions
set participant_names = array[featured_surfer_name]
where featured_surfer_name is not null
  and cardinality(participant_names) = 0;

commit;

select 'Salty session places migration complete' as result;
