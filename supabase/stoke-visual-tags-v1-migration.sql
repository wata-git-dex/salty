-- Sodium v1.82: multiple linked member tags already use public.post_tags.
-- This additive field stores author-written visual labels such as a board,
-- brand, crew name, or a person who is not yet a Sodium member.

begin;

alter table public.posts
  add column if not exists custom_tags text[] not null default '{}'::text[];

alter table public.posts
  drop constraint if exists posts_custom_tags_count_check;

alter table public.posts
  add constraint posts_custom_tags_count_check
  check (cardinality(custom_tags) between 0 and 12);

commit;

select 'Sodium Stoke visual tags ready' as result;
