-- Lets the holder of a private clip-delivery link choose to join Sodium.
-- The bearer token can create or retrieve exactly one one-use invite tied to
-- that delivery. It never creates a general or reusable community invite.

begin;

create or replace function public.get_or_create_guest_clip_invite(access_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  token uuid;
  delivery_row record;
  existing_code text;
  new_code text;
begin
  begin
    token := access_token::uuid;
  exception when others then
    raise exception 'This private clip link is invalid';
  end;

  select delivery.id, delivery.sender, delivery.recipient, delivery.recipient_name,
         coalesce(session.region_id, profile.home_region) as region_id
  into delivery_row
  from public.clip_deliveries delivery
  join public.profiles profile on profile.id = delivery.sender
  left join public.sessions session on session.id = delivery.session_id
  where delivery.guest_access_token = token
    and delivery.status <> 'cancelled'
  for update of delivery;

  if not found then raise exception 'This private clip link is no longer active'; end if;
  if delivery_row.recipient is not null then
    raise exception 'These clips are already connected to a Sodium member';
  end if;

  select invite.code into existing_code
  from public.invites invite
  where invite.clip_delivery_id = delivery_row.id
    and invite.purpose = 'claim_delivery'
    and invite.revoked_at is null
    and (invite.expires_at is null or invite.expires_at > now())
    and invite.use_count < invite.max_uses
  order by invite.created_at desc
  limit 1;

  if existing_code is not null then return existing_code; end if;

  new_code := 'SODIUM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.invites(
    code, created_by, max_uses, region_id, purpose, clip_delivery_id, intended_name
  ) values (
    new_code, delivery_row.sender, 1, delivery_row.region_id, 'claim_delivery',
    delivery_row.id, nullif(trim(delivery_row.recipient_name), '')
  );
  return new_code;
end;
$$;

revoke all on function public.get_or_create_guest_clip_invite(text) from public;
grant execute on function public.get_or_create_guest_clip_invite(text) to anon, authenticated;

commit;

select 'Sodium guest clip join flow complete' as result;
