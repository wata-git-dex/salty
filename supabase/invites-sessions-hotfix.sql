-- Salty invite + multi-person surf hotfix
-- Safe to run more than once. Existing sessions and invites are preserved.

begin;

-- Some existing databases missed this column from session-places-migration.sql.
alter table public.sessions
  add column if not exists participant_names text[] not null default '{}';

-- Preserve the original single featured surfer in the multiple-name field.
update public.sessions
set participant_names = array[featured_surfer_name]
where featured_surfer_name is not null
  and cardinality(participant_names) = 0;

-- Use PostgreSQL's built-in random UUID generator so invite creation does not
-- depend on pgcrypto's gen_random_bytes() being exposed on the function path.
create or replace function public.create_invite(invite_max_uses int default 1)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare new_code text;
begin
  if not public.is_member() then
    raise exception 'Community membership required';
  end if;

  if invite_max_uses < 1 or invite_max_uses > 25 then
    raise exception 'max uses must be between 1 and 25';
  end if;

  new_code := 'SALTY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.invites (code, created_by, max_uses)
  values (new_code, auth.uid(), invite_max_uses);

  return new_code;
end $$;

grant execute on function public.create_invite(int) to authenticated;

-- Make PostgREST pick up the new column immediately.
notify pgrst, 'reload schema';

commit;

select 'Salty invite + session hotfix complete' as result;
