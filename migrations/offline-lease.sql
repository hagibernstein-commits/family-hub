-- Offline play: time leases ("שמורת זמן") reserved in advance from the child's daily allowance.
-- A lease's unreported seconds count as spent (fail-closed accounting) until the device
-- reconnects and reports actual use; unused seconds are then released back.

alter table family_private.settings add column if not exists lease_minutes integer not null default 10;
alter table family_private.settings add column if not exists lease_enabled boolean not null default true;
alter table family_private.settings drop constraint if exists settings_lease_minutes_check;
alter table family_private.settings add constraint settings_lease_minutes_check check (lease_minutes >= 0 and lease_minutes <= 120);

create table if not exists family_private.leases(
  id uuid primary key default gen_random_uuid(),
  day date not null,
  kid uuid not null references family_private.kids(id) on delete cascade,
  device uuid not null references family_private.devices(id) on delete cascade,
  seconds numeric not null check (seconds >= 0),
  settled numeric not null default 0 check (settled >= 0),
  closed boolean not null default false,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table family_private.leases enable row level security;
create index if not exists leases_kid_day on family_private.leases(kid, day);

-- Reserved-but-unaccounted seconds for a kid on a day.
-- Open lease: seconds - settled (pessimistically counted as spent).
-- Honest release shrinks seconds to settled first, freeing the unused part.
-- A forfeited lease (device lost state) keeps its full charge.
create or replace function family_private.reserved(p_kid uuid, p_day date)
returns numeric language sql stable security definer set search_path to 'pg_catalog' as
$$ select coalesce(sum(greatest(0, seconds - settled)), 0)
   from family_private.leases where kid = p_kid and day = p_day $$;

-- Gate: remaining allowance now nets out reserved lease seconds.
create or replace function public.fc_gate(token text, kid_id uuid default null, app_id text default null, session_id uuid default null, active boolean default false)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $function$
declare dev uuid; s family_private.settings; k family_private.kids; a family_private.apps; today date:=(now() at time zone 'Asia/Jerusalem')::date; tm time:=(now() at time zone 'Asia/Jerusalem')::time; used numeric; resv numeric:=0; allowed integer; bonus integer; last_at timestamptz; elapsed numeric:=0; reason text:=null;
begin
 select id into dev from family_private.devices where not revoked and token_hash=encode(sha256(convert_to(token,'UTF8')),'hex');
 if dev is null then raise exception 'Device not paired' using errcode='42501'; end if;
 if kid_id is null then return jsonb_build_object('apps',(select coalesce(jsonb_agg(catalog order by name),'[]') from family_private.apps catalog),'kids',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from family_private.kids)); end if;
 select * into k from family_private.kids where id=kid_id;
 select * into a from family_private.apps where id=app_id;
 if k.id is null or a.id is null or not a.managed then raise exception 'Invalid child or app'; end if;
 -- Serialize charging across devices playing as the same child.
 insert into family_private.last_charge(kid,charged_at) values(k.id,now()) on conflict do nothing;
 select charged_at into last_at from family_private.last_charge where kid=k.id for update;
 select * into s from family_private.settings;
 select coalesce(sum(seconds),0) into used from family_private.usage where day=today and kid=k.id;
 select coalesce((select seconds from family_private.bonus where day=today and kid=k.id),0) into bonus;
 select family_private.reserved(k.id,today) into resv;
 allowed:=greatest(0,coalesce(k.daily_minutes,s.daily_minutes)*60+bonus);
 if s.paused then reason:='paused'; elsif not a.enabled then reason:='disabled'; elsif tm<s.start_time or tm>=s.end_time then reason:='window'; elsif used+resv>=allowed then reason:='limit'; end if;
 if active and reason is null and session_id is not null then
  if exists(select 1 from family_private.presence where device=dev and session=session_id and kid=k.id and app=a.id and seen_at>now()-interval '20 seconds') then elapsed:=greatest(0,least(15,extract(epoch from now()-last_at),allowed-used-resv)); end if;
  insert into family_private.usage(day,kid,app,seconds) values(today,k.id,a.id,elapsed) on conflict(day,kid,app) do update set seconds=family_private.usage.seconds+excluded.seconds;
  update family_private.last_charge set charged_at=now() where kid=k.id;
  insert into family_private.presence(device,session,kid,app,seen_at) values(dev,session_id,k.id,a.id,now()) on conflict(device,session) do update set kid=excluded.kid,app=excluded.app,seen_at=now();
  used:=used+elapsed;
  if used+resv>=allowed then reason:='limit'; end if;
 elsif session_id is not null then delete from family_private.presence where device=dev and session=session_id;
 end if;
 return jsonb_build_object('ok',reason is null,'reason',reason,'remaining',greatest(0,allowed-used-resv),'reserved',resv,'name',k.name,'start',s.start_time,'end',s.end_time,'server_time',now(),'lease_enabled',s.lease_enabled,'lease_minutes',s.lease_minutes);
end $function$;
revoke all on function public.fc_gate(text,uuid,text,uuid,boolean) from public;
grant execute on function public.fc_gate(text,uuid,text,uuid,boolean) to anon, authenticated, service_role;

-- Lease RPC: settle actual offline use, release the unused part, and grant a fresh lease.
create or replace function public.fc_lease(token text, kid_id uuid, app_id text default null, settle numeric default null, release boolean default false, want integer default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $function$
declare dev uuid; k family_private.kids; s family_private.settings; a family_private.apps; today date:=(now() at time zone 'Asia/Jerusalem')::date; tm time:=(now() at time zone 'Asia/Jerusalem')::time; l family_private.leases; used numeric; resv numeric; allowed integer; bonus integer; granted integer; delta numeric; reason text:=null; new_id uuid; exp timestamptz;
begin
 select id into dev from family_private.devices where not revoked and token_hash=encode(sha256(convert_to(token,'UTF8')),'hex');
 if dev is null then raise exception 'Device not paired' using errcode='42501'; end if;
 select * into k from family_private.kids where id=kid_id;
 if k.id is null then raise exception 'Invalid child'; end if;
 if app_id is not null then select * into a from family_private.apps where id=app_id and managed; end if;
 select * into s from family_private.settings;

 -- Settle and close the current open lease for this device+child, if any.
 select * into l from family_private.leases where device=dev and kid=k.id and day=today and not closed order by granted_at desc limit 1 for update;
 if l.id is not null then
  if settle is not null then
   delta:=greatest(0,least(l.seconds,settle)-l.settled);
   if delta>0 and a.id is not null then
    insert into family_private.usage(day,kid,app,seconds) values(l.day,k.id,a.id,delta) on conflict(day,kid,app) do update set seconds=family_private.usage.seconds+excluded.seconds;
   end if;
   update family_private.leases set settled=least(l.seconds,settle) where id=l.id;
  end if;
  if release or settle is not null then
   -- honest report: unused reserved seconds go back to the day's allowance
   update family_private.leases set closed=true, seconds=least(l.seconds,coalesce(settle,l.settled)) where id=l.id;
  else
   -- re-grant without a report (device lost its state): keep the unaccounted part fully charged
   update family_private.leases set closed=true where id=l.id;
  end if;
 end if;

 if release then return jsonb_build_object('ok',true,'released',true,'server_time',now()); end if;

 select coalesce(sum(seconds),0) into used from family_private.usage where day=today and kid=k.id;
 select coalesce((select seconds from family_private.bonus where day=today and kid=k.id),0) into bonus;
 allowed:=greatest(0,coalesce(k.daily_minutes,s.daily_minutes)*60+bonus);
 select family_private.reserved(k.id,today) into resv;
 if not s.lease_enabled then reason:='off';
 elsif s.paused then reason:='paused';
 elsif tm<s.start_time or tm>=s.end_time then reason:='window';
 elsif used+resv>=allowed then reason:='limit'; end if;
 if reason is not null then return jsonb_build_object('ok',false,'reason',reason,'remaining',greatest(0,allowed-used-resv),'server_time',now()); end if;

 granted:=least(coalesce(want,s.lease_minutes*60),s.lease_minutes*60,floor(greatest(0,allowed-used-resv)));
 if granted<30 then return jsonb_build_object('ok',false,'reason','limit','remaining',greatest(0,allowed-used-resv),'server_time',now()); end if;
 exp:=least(now()+interval '12 hours', ((today + s.end_time) at time zone 'Asia/Jerusalem') + interval '1 hour');
 insert into family_private.leases(day,kid,device,seconds,expires_at) values(today,k.id,dev,granted,exp) returning id into new_id;
 return jsonb_build_object('ok',true,'lease',jsonb_build_object('id',new_id,'seconds',granted,'expires_at',exp),'start',s.start_time,'end',s.end_time,'remaining',greatest(0,allowed-used-resv-granted),'server_time',now());
end $function$;
revoke all on function public.fc_lease(text,uuid,text,numeric,boolean,integer) from public;
grant execute on function public.fc_lease(text,uuid,text,numeric,boolean,integer) to anon, authenticated, service_role;

-- Dashboard: show today's leases so parents see what is reserved offline.
create or replace function public.fc_dashboard(parent_token text default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $function$
begin
 if not public.fc_is_parent(parent_token) then raise exception 'Unauthorized' using errcode='42501'; end if;
 return jsonb_build_object('today',(now() at time zone 'Asia/Jerusalem')::date,'settings',(select to_jsonb(s) from family_private.settings s),'kids',(select coalesce(jsonb_agg(k order by name),'[]') from family_private.kids k),'apps',(select coalesce(jsonb_agg(a order by name),'[]') from family_private.apps a),'usage',(select coalesce(jsonb_agg(u),'[]') from family_private.usage u where day>=(now() at time zone 'Asia/Jerusalem')::date-6),'bonus',(select coalesce(jsonb_agg(b),'[]') from family_private.bonus b where day=(now() at time zone 'Asia/Jerusalem')::date),'presence',(select coalesce(jsonb_agg(p),'[]') from family_private.presence p where seen_at>now()-interval '30 seconds'),'devices',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'revoked',revoked)),'[]') from family_private.devices),'parents',(select jsonb_agg(email) from family_private.parents),'leases',(select coalesce(jsonb_agg(jsonb_build_object('kid',l.kid,'label',d.label,'seconds',l.seconds,'settled',l.settled,'closed',l.closed,'granted_at',l.granted_at,'expires_at',l.expires_at)),'[]') from family_private.leases l join family_private.devices d on d.id=l.device where l.day=(now() at time zone 'Asia/Jerusalem')::date));
end $function$;
revoke all on function public.fc_dashboard(text) from public;
grant execute on function public.fc_dashboard(text) to anon, authenticated, service_role;

-- Settings update: parents control offline minutes and on/off.
create or replace function public.fc_update(action text, payload jsonb, parent_token text default null)
returns boolean language plpgsql security definer set search_path to 'pg_catalog' as $function$
begin
 if not public.fc_is_parent(parent_token) then raise exception 'Unauthorized' using errcode='42501'; end if;
 case action
 when 'pause' then update family_private.settings set paused=(payload->>'paused')::boolean where id=true;
 when 'settings' then
  if (payload->>'start')::time >= (payload->>'end')::time then raise exception 'Invalid window'; end if;
  update family_private.settings set start_time=(payload->>'start')::time,end_time=(payload->>'end')::time,daily_minutes=(payload->>'minutes')::integer,lease_minutes=coalesce(nullif(payload->>'lease_minutes','')::integer,lease_minutes),lease_enabled=coalesce((payload->>'lease_enabled')::boolean,lease_enabled) where id=true;
 when 'app' then update family_private.apps set enabled=(payload->>'enabled')::boolean where id=payload->>'id';
 when 'limit' then update family_private.kids set daily_minutes=nullif(payload->>'minutes','')::integer where id=(payload->>'id')::uuid;
 when 'bonus' then
  if abs((payload->>'seconds')::integer)>36000 then raise exception 'Invalid bonus'; end if;
  insert into family_private.bonus(day,kid,seconds) values((now() at time zone 'Asia/Jerusalem')::date,(payload->>'id')::uuid,(payload->>'seconds')::integer) on conflict(day,kid) do update set seconds=family_private.bonus.seconds+excluded.seconds;
 when 'parent' then
  if length(payload->>'email')>254 or (payload->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid email'; end if;
  insert into family_private.parents values(lower(payload->>'email')) on conflict do nothing;
 when 'revoke' then update family_private.devices set revoked=true where id=(payload->>'id')::uuid;
 else raise exception 'Unknown action';
 end case;
 return true;
end $function$;
revoke all on function public.fc_update(text,jsonb,text) from public;
grant execute on function public.fc_update(text,jsonb,text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
