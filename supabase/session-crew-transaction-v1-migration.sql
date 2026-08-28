-- Sodium v1.126: atomic session + crew saves with explicit member identity.
-- Additive and data-preserving. This does not auto-link legacy guest names.

begin;

create or replace function public.save_session_with_crew(
  target_session uuid,
  target_spot uuid,
  target_region uuid,
  target_when_label text,
  target_surf_time timestamptz,
  target_started_at timestamptz,
  target_author_role text,
  target_wants_filmer boolean,
  target_note text,
  target_status text,
  target_ended_at timestamptz,
  target_initiator_user uuid,
  target_initiator_name text,
  linked_crew jsonb,
  guest_names text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  selected_session public.sessions;
  saved_session public.sessions;
  saved_id uuid;
  cleaned_guests text[] := '{}'::text[];
  linked_user_ids uuid[] := '{}'::uuid[];
  linked_count integer := 0;
  linked_item jsonb;
  linked_user uuid;
  linked_role text;
  actor_is_admin boolean := false;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  actor_is_admin := public.is_admin();

  if target_author_role not in ('surf','film') then raise exception 'Invalid session role'; end if;
  if target_when_label not in ('Now','Scheduled','Logged') then raise exception 'Invalid session timing'; end if;
  if target_status not in ('active','ended','archived') then raise exception 'Invalid session status'; end if;
  if target_region is null or not exists(select 1 from public.regions where id=target_region) then raise exception 'Location not found'; end if;
  if target_spot is null or not exists(select 1 from public.spots where id=target_spot and region_id=target_region) then raise exception 'Surf spot not found in that location'; end if;
  if target_surf_time is null then raise exception 'Session time is required'; end if;
  if target_status='active' and target_ended_at is not null then raise exception 'Active sessions cannot have an end time'; end if;
  if target_status<>'active' and target_ended_at is null then raise exception 'Finished sessions require an end time'; end if;
  if target_note is not null and char_length(target_note)>500 then raise exception 'Session note is too long'; end if;
  if jsonb_typeof(coalesce(linked_crew,'[]'::jsonb)) <> 'array' then raise exception 'Linked crew must be a list'; end if;

  select coalesce(array_agg(clean_name order by first_position),'{}'::text[])
  into cleaned_guests
  from (
    select
      min(position) as first_position,
      min(trim(raw_name)) as clean_name
    from unnest(coalesce(guest_names,'{}'::text[])) with ordinality as names(raw_name,position)
    where nullif(trim(raw_name),'') is not null
    group by lower(regexp_replace(trim(raw_name),'\s+',' ','g'))
  ) normalized_guests;

  if exists(select 1 from unnest(cleaned_guests) name where char_length(name)>100) then raise exception 'A guest name is too long'; end if;

  for linked_item in select value from jsonb_array_elements(coalesce(linked_crew,'[]'::jsonb))
  loop
    if nullif(linked_item->>'user_id','') is null then raise exception 'Linked member id is required'; end if;
    linked_user := (linked_item->>'user_id')::uuid;
    linked_role := linked_item->>'role';
    if linked_role not in ('surf','film') then raise exception 'Invalid linked member role'; end if;
    if linked_user=actor then raise exception 'The organizer is already part of this session'; end if;
    if linked_user=any(linked_user_ids) then raise exception 'A member can only be added once'; end if;
    if not exists(select 1 from public.profiles where id=linked_user and onboarding_complete) then raise exception 'That Sodium member is not available'; end if;
    linked_user_ids := array_append(linked_user_ids,linked_user);
    linked_count := linked_count+1;
  end loop;

  if cardinality(cleaned_guests)+linked_count>20 then raise exception 'A session can include up to 20 people'; end if;

  if target_session is null then
    insert into public.sessions(
      author,spot_id,region_id,when_label,surf_time,started_at,author_role,
      featured_surfer_name,featured_surfer_user,participant_names,wants_filmer,note,
      status,ended_at,initiator_user,initiator_name
    ) values (
      actor,target_spot,target_region,target_when_label,target_surf_time,target_started_at,target_author_role,
      null,null,cleaned_guests,target_wants_filmer,nullif(trim(target_note),''),
      target_status,target_ended_at,
      case when actor_is_admin then target_initiator_user else actor end,
      case when actor_is_admin then nullif(trim(target_initiator_name),'') else null end
    ) returning * into saved_session;
  else
    select * into selected_session from public.sessions where id=target_session for update;
    if selected_session.id is null then raise exception 'Session not found'; end if;
    if selected_session.author<>actor and not actor_is_admin then raise exception 'Only the session organizer can edit it'; end if;

    if selected_session.points_awarded_at is not null and exists(
      select 1 from public.session_rsvps existing
      where existing.session_id=target_session and existing.user_id<>all(linked_user_ids)
    ) then
      raise exception 'Confirmed crew cannot be removed after Stokens are awarded';
    end if;

    update public.sessions set
      spot_id=target_spot,
      region_id=target_region,
      when_label=target_when_label,
      surf_time=target_surf_time,
      started_at=target_started_at,
      author_role=target_author_role,
      featured_surfer_name=null,
      featured_surfer_user=null,
      participant_names=cleaned_guests,
      wants_filmer=target_wants_filmer,
      note=nullif(trim(target_note),''),
      status=target_status,
      ended_at=target_ended_at,
      initiator_user=case when actor_is_admin then target_initiator_user else selected_session.initiator_user end,
      initiator_name=case when actor_is_admin then nullif(trim(target_initiator_name),'') else selected_session.initiator_name end
    where id=target_session
    returning * into saved_session;
  end if;

  saved_id := saved_session.id;

  delete from public.session_rsvps existing
  where existing.session_id=saved_id
    and existing.user_id<>all(linked_user_ids);

  for linked_item in select value from jsonb_array_elements(coalesce(linked_crew,'[]'::jsonb))
  loop
    linked_user := (linked_item->>'user_id')::uuid;
    linked_role := linked_item->>'role';
    insert into public.session_rsvps(session_id,user_id,role)
    values(saved_id,linked_user,linked_role)
    on conflict(session_id,user_id) do update set role=excluded.role;
  end loop;

  return jsonb_build_object(
    'session_id',saved_id,
    'guest_names',cleaned_guests,
    'linked_crew',coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id',rsvp.user_id,
        'name',profile.name,
        'role',rsvp.role
      ) order by profile.name,rsvp.user_id)
      from public.session_rsvps rsvp
      join public.profiles profile on profile.id=rsvp.user_id
      where rsvp.session_id=saved_id
    ),'[]'::jsonb)
  );
end $$;

-- session-lifecycle-v1 accidentally compared sessions.general_location even
-- though location belongs to spots. PostgreSQL resolves OLD/NEW fields at
-- runtime, so that stale reference blocked every session update. Keep the
-- notification behavior and remove only the nonexistent-column comparison.
create or replace function public.notify_session_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare attendee record; author_name text; message text; selected_id uuid; selected_author uuid; selected_region uuid; selected_when text;
begin
  if tg_op='DELETE' then selected_id:=old.id; selected_author:=old.author; selected_region:=old.region_id; selected_when:=old.when_label;
  else selected_id:=new.id; selected_author:=new.author; selected_region:=new.region_id; selected_when:=new.when_label; end if;
  if selected_when='Logged' then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='UPDATE' and not (
    old.status is distinct from new.status or old.when_label is distinct from new.when_label or
    old.surf_time is distinct from new.surf_time or old.spot_id is distinct from new.spot_id or
    old.participant_names is distinct from new.participant_names or
    old.wants_filmer is distinct from new.wants_filmer or old.featured_surfer_name is distinct from new.featured_surfer_name or
    old.featured_surfer_user is distinct from new.featured_surfer_user or old.initiator_user is distinct from new.initiator_user
  ) then return new; end if;
  select name into author_name from public.profiles where id=selected_author;
  if tg_op='DELETE' then message:=coalesce(author_name,'The organizer')||' cancelled a surf.';
  elsif new.status='ended' and old.status is distinct from 'ended' then message:=coalesce(author_name,'The organizer')||' finished the surf.';
  elsif new.when_label='Now' and old.when_label is distinct from 'Now' then message:=coalesce(author_name,'The organizer')||' started the surf.';
  else message:=coalesce(author_name,'The organizer')||' updated a surf.'; end if;
  for attendee in
    select distinct member_id from (
      select case when tg_op='DELETE' then old.initiator_user else new.initiator_user end as member_id
      union all select case when tg_op='DELETE' then old.featured_surfer_user else new.featured_surfer_user end
      union all select rsvp.user_id from public.session_rsvps rsvp where rsvp.session_id=selected_id
    ) crew where member_id is not null and member_id<>selected_author
  loop
    perform public.enqueue_notification(attendee.member_id,'session_update','Surf update',message,
      './?open=surfing&session='||selected_id::text||'&region='||selected_region::text,selected_id);
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

revoke all on function public.save_session_with_crew(
  uuid,uuid,uuid,text,timestamptz,timestamptz,text,boolean,text,text,timestamptz,uuid,text,jsonb,text[]
) from public,anon;
grant execute on function public.save_session_with_crew(
  uuid,uuid,uuid,text,timestamptz,timestamptz,text,boolean,text,text,timestamptz,uuid,text,jsonb,text[]
) to authenticated;

commit;

select 'Sodium transactional session crew save ready' as result;
