-- Sodium: notify the inviter when a new member redeems their invite.
-- Safe to run more than once.

begin;

alter table public.notification_preferences
  add column if not exists new_members boolean not null default true;

alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check
  check (kind in ('new_session','new_stoke','direct_message','event','session_update','community_chat','clip_delivery','new_member'));

create or replace function public.notification_allowed(target_user uuid, notification_kind text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.push_subscriptions s where s.user_id = target_user)
    and coalesce((select p.master_enabled from public.notification_preferences p where p.user_id = target_user), true)
    and case notification_kind
      when 'new_session' then coalesce((select p.new_sessions from public.notification_preferences p where p.user_id = target_user), true)
      when 'new_stoke' then coalesce((select p.new_stoke from public.notification_preferences p where p.user_id = target_user), true)
      when 'direct_message' then coalesce((select p.direct_messages from public.notification_preferences p where p.user_id = target_user), true)
      when 'event' then coalesce((select p.events from public.notification_preferences p where p.user_id = target_user), true)
      when 'session_update' then coalesce((select p.session_updates from public.notification_preferences p where p.user_id = target_user), true)
      when 'community_chat' then coalesce((select p.community_chat from public.notification_preferences p where p.user_id = target_user), false)
      when 'clip_delivery' then coalesce((select p.clip_deliveries from public.notification_preferences p where p.user_id = target_user), true)
      when 'new_member' then coalesce((select p.new_members from public.notification_preferences p where p.user_id = target_user), true)
      else false end
$$;

create or replace function public.notify_inviter_when_member_joins()
returns trigger language plpgsql security definer set search_path = public
as $$
declare member_name text;
begin
  if new.used_by is null or old.used_by is not null or new.used_by = new.created_by then return new; end if;
  select name into member_name from public.profiles where id = new.used_by;
  perform public.enqueue_notification(
    new.created_by,
    'new_member',
    coalesce(member_name, 'A new member') || ' joined Sodium',
    coalesce(member_name, 'Someone you invited') || ' accepted your invite and is now in the community.',
    './?open=members',
    new.id
  );
  return new;
end $$;

drop trigger if exists notify_inviter_when_member_joins on public.invites;
create trigger notify_inviter_when_member_joins
after update of used_by on public.invites
for each row execute function public.notify_inviter_when_member_joins();

revoke execute on function public.notify_inviter_when_member_joins() from public, anon, authenticated;

commit;

select 'Sodium new-member notifications installed' as status;
