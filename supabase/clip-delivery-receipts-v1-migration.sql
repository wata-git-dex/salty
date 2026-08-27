-- Sodium clip-delivery receipts.
-- Additive only: preserves every delivery, guest link, and external folder.

begin;

alter table public.clip_deliveries
  add column if not exists first_delivery_viewed_at timestamptz,
  add column if not exists last_delivery_viewed_at timestamptz,
  add column if not exists delivery_view_count integer not null default 0,
  add column if not exists first_clips_opened_at timestamptz,
  add column if not exists last_clips_opened_at timestamptz,
  add column if not exists clips_open_count integer not null default 0;

alter table public.clip_deliveries drop constraint if exists clip_deliveries_view_count_check;
alter table public.clip_deliveries add constraint clip_deliveries_view_count_check
  check (delivery_view_count >= 0 and clips_open_count >= 0);

comment on column public.clip_deliveries.first_delivery_viewed_at is
  'First time the recipient opened this Sodium delivery. This is not proof that external files were downloaded.';
comment on column public.clip_deliveries.first_clips_opened_at is
  'First time the recipient tapped through to the external clip folder. This is not proof that external files were downloaded.';

create or replace function public.record_clip_delivery_receipt(
  target_delivery uuid default null,
  access_token text default null,
  receipt_kind text default 'viewed'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  guest_token uuid;
  matched boolean := false;
begin
  if receipt_kind not in ('viewed', 'clips_opened') then
    raise exception 'Unsupported clip receipt';
  end if;

  -- A logged-in receipt belongs only to the actual recipient. The sender
  -- reopening their outbox never creates a recipient receipt.
  if auth.uid() is not null and target_delivery is not null then
    if receipt_kind = 'viewed' then
      update public.clip_deliveries
         set first_delivery_viewed_at = coalesce(first_delivery_viewed_at, now()),
             last_delivery_viewed_at = now(),
             delivery_view_count = delivery_view_count + 1
       where id = target_delivery
         and recipient = auth.uid()
         and status <> 'cancelled'
      returning true into matched;
    else
      update public.clip_deliveries
         set first_clips_opened_at = coalesce(first_clips_opened_at, now()),
             last_clips_opened_at = now(),
             clips_open_count = clips_open_count + 1
       where id = target_delivery
         and recipient = auth.uid()
         and status <> 'cancelled'
      returning true into matched;
    end if;
    return coalesce(matched, false);
  end if;

  -- A guest receipt is authorized only by that delivery's unguessable token.
  begin
    guest_token := access_token::uuid;
  exception when others then
    return false;
  end;

  if receipt_kind = 'viewed' then
    update public.clip_deliveries
       set first_delivery_viewed_at = coalesce(first_delivery_viewed_at, now()),
           last_delivery_viewed_at = now(),
           delivery_view_count = delivery_view_count + 1
     where guest_access_token = guest_token
       and status <> 'cancelled'
    returning true into matched;
  else
    update public.clip_deliveries
       set first_clips_opened_at = coalesce(first_clips_opened_at, now()),
           last_clips_opened_at = now(),
           clips_open_count = clips_open_count + 1
     where guest_access_token = guest_token
       and status <> 'cancelled'
    returning true into matched;
  end if;

  return coalesce(matched, false);
end $$;

revoke all on function public.record_clip_delivery_receipt(uuid, text, text) from public;
grant execute on function public.record_clip_delivery_receipt(uuid, text, text) to anon, authenticated;

commit;

select 'Sodium clip delivery receipts migration complete' as status;
