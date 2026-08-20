-- Salty Events v2: real venues, map locations, and start/end times.
-- Safe to run more than once.

begin;

-- Some early databases predate the broader location field used by Surfing.
alter table public.spots
  add column if not exists general_location text;

alter table public.spots
  drop constraint if exists spots_general_location_check;

alter table public.spots
  add constraint spots_general_location_check
  check (general_location is null or char_length(trim(general_location)) between 1 and 160);

alter table public.events
  add column if not exists end_time timestamptz,
  add column if not exists venue_name text,
  add column if not exists location_text text;

alter table public.events
  drop constraint if exists events_time_order_check;

alter table public.events
  add constraint events_time_order_check
  check (end_time is null or start_time is null or end_time > start_time);

alter table public.events
  drop constraint if exists events_venue_name_check;

alter table public.events
  add constraint events_venue_name_check
  check (venue_name is null or char_length(trim(venue_name)) between 1 and 160);

alter table public.events
  drop constraint if exists events_location_text_check;

alter table public.events
  add constraint events_location_text_check
  check (location_text is null or char_length(trim(location_text)) between 1 and 300);

-- Preserve useful place information on events made with the original spot-based form.
update public.events as event
set venue_name = coalesce(event.venue_name, spot.name),
    location_text = coalesce(event.location_text, spot.general_location),
    end_time = coalesce(event.end_time, event.start_time + interval '2 hours')
from public.spots spot
where event.spot_id = spot.id;

update public.events
set end_time = start_time + interval '2 hours'
where start_time is not null and end_time is null;

commit;

select 'Salty Events v2 migration complete' as result;
