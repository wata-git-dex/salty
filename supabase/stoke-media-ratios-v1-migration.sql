-- Sodium Stoke media orientation + optional crop shapes.
-- Safe additive migration: every existing post defaults to its original aspect ratio.

begin;

alter table public.posts
  add column if not exists media_ratio text not null default 'original';

alter table public.posts
  drop constraint if exists posts_media_ratio_check;

alter table public.posts
  add constraint posts_media_ratio_check
  check (media_ratio in ('original', 'square', 'portrait', 'landscape'));

commit;

select 'Sodium Stoke media ratios ready' as result;
