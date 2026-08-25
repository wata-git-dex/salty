-- Sodium v1.61: let each signed-in member verify their own push setup.
-- The function is deliberately self-only and rate-limited.

create or replace function public.send_test_notification()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := auth.uid();
begin
  if target is null then
    raise exception 'Sign in before sending a test notification.';
  end if;

  if not exists (select 1 from public.push_subscriptions where user_id = target) then
    raise exception 'Enable notifications on this device first.';
  end if;

  if exists (
    select 1 from public.notification_queue
    where recipient = target
      and title = 'Sodium notifications are working'
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception 'Wait a minute before sending another test.';
  end if;

  insert into public.notification_queue(recipient, kind, title, body, url)
  values (
    target,
    'session_update',
    'Sodium notifications are working',
    'You will get alerts from the crew based on your Settings choices.',
    './?open=settings'
  );

  return true;
end;
$$;

revoke execute on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;

select 'Sodium push test function complete' as result;
