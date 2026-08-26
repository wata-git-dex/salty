-- Sodium message reactions: accept any single phone emoji.
-- The client enforces one Unicode grapheme; the database safely caps storage.

begin;

alter table public.message_reactions
  drop constraint if exists message_reactions_emoji_check;
alter table public.message_reactions
  add constraint message_reactions_emoji_check
  check (emoji = btrim(emoji) and char_length(emoji) between 1 and 32);

commit;
