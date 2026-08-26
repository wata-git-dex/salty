-- Sodium profile quick reactions v1
-- Add four account-synced quick message reactions without changing existing profiles.

begin;

alter table public.profiles
  add column if not exists quick_reactions text[] not null
  default array['🌊','🔥','😂','❤️']::text[];

alter table public.profiles
  drop constraint if exists profiles_quick_reactions_check;

alter table public.profiles
  add constraint profiles_quick_reactions_check
  check (
    cardinality(quick_reactions) = 4
    and array_position(quick_reactions, null) is null
  );

grant update (quick_reactions) on public.profiles to authenticated;

commit;

select 'Sodium profile quick reactions ready' as result;
