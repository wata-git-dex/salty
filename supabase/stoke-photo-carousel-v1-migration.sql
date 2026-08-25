-- Sodium Stoke photo carousels
-- Safe additive migration: existing single-photo and clip posts remain unchanged.

begin;

alter table public.posts
  add column if not exists media_paths text[] not null default '{}'::text[];

update public.posts
set media_paths = array[media_path]
where cardinality(media_paths) = 0
  and media_path is not null
  and media_type = 'photo';

alter table public.posts
  drop constraint if exists posts_media_paths_count_check;

alter table public.posts
  add constraint posts_media_paths_count_check
  check (cardinality(media_paths) between 0 and 10);

commit;

select 'Sodium Stoke photo carousel migration complete' as result;
