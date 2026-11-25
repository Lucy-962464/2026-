begin;

create schema if not exists bento_research;
revoke all on schema bento_research from public, anon, authenticated;

create table bento_research.invites (
  participant_code text primary key check (participant_code ~ '^[A-Z]{1,4}[0-9]{3,8}$'),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  enrolled_session text,
  enrolled_at timestamptz,
  revoked_at timestamptz
);
create table bento_research.trials (
  participant_code text not null references bento_research.invites,
  session_id text not null,
  mode text not null check (mode in ('practice','formal')),
  trial_number integer not null check (trial_number between 1 and 500),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  primary key (participant_code, mode, trial_number)
);
alter table bento_research.invites enable row level security;
alter table bento_research.trials enable row level security;
revoke all on all tables in schema bento_research from public, anon, authenticated;

-- The public API can enroll an invite or append its trials. It returns no research records.
create function public.receive_bento_study_trial(p_token text, p_session text, p_trial jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $body$
declare
  invite bento_research.invites%rowtype;
  mode_value text;
  trial_no integer;
  size_value integer;
  status_value text;
  target_list text[];
  answer_list text[];
  allowed_dishes constant text[] := array[
    '番茄炒蛋','清炒西兰花','红烧肉','蒸南瓜','家常豆腐','凉拌黄瓜',
    '鱼香茄子','蒸鸡蛋羹','糖醋里脊'
  ];
  clean jsonb;
  existing jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$'
     or p_session is null or p_session !~ '^[a-f0-9]{32}$' then
    raise sqlstate 'PT403' using message = '研究链接不可用';
  end if;
  select * into invite from bento_research.invites
    where token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
      and revoked_at is null and expires_at > pg_catalog.now()
    for update;
  if not found or (invite.enrolled_session is not null and invite.enrolled_session <> p_session) then
    raise sqlstate 'PT403' using message = '研究链接不可用';
  end if;
  if p_trial is null then
    update bento_research.invites
      set enrolled_session = p_session, enrolled_at = coalesce(enrolled_at, pg_catalog.now())
      where participant_code = invite.participant_code;
    return;
  end if;
  if invite.enrolled_session is null then
    raise sqlstate 'PT403' using message = '尚未开始本次研究';
  end if;

  if pg_catalog.jsonb_typeof(p_trial) is distinct from 'object'
     or pg_catalog.octet_length(p_trial::text) > 32000
     or pg_catalog.jsonb_typeof(p_trial->'target') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_trial->'answer') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_trial->'events') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_trial->'valid') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(p_trial->'number') is distinct from 'number'
     or pg_catalog.jsonb_typeof(p_trial->'size') is distinct from 'number'
     or p_trial->>'rules_version' is distinct from 'mvp-1.0'
     or p_trial->>'guide_version' is distinct from 'bento-guide-1' then
    raise sqlstate 'PT400' using message = '试次格式无效';
  end if;
  mode_value := p_trial->>'mode';
  trial_no := (p_trial->>'number')::integer;
  size_value := (p_trial->>'size')::integer;
  status_value := p_trial->>'status';
  if mode_value is null or mode_value not in ('practice','formal')
     or trial_no not between 1 and 500 or size_value not between 2 and 5
     or status_value is null or status_value not in ('SUBMIT','HINT','ABORT','TECH','INTERRUPTED')
     or (p_trial->>'valid')::boolean is distinct from (mode_value='formal' and status_value='SUBMIT')
     or (mode_value='practice' and size_value<>2)
     or pg_catalog.jsonb_array_length(p_trial->'events')>250 then
    raise sqlstate 'PT400' using message = '试次参数无效';
  end if;

  select array(select pg_catalog.jsonb_array_elements_text(p_trial->'target')) into target_list;
  select array(select pg_catalog.jsonb_array_elements_text(p_trial->'answer')) into answer_list;
  if pg_catalog.cardinality(target_list) <> size_value
     or pg_catalog.cardinality(answer_list) > size_value
     or not target_list <@ allowed_dishes or not answer_list <@ target_list
     or (select count(distinct dish) from pg_catalog.unnest(target_list) as x(dish)) <> size_value
     or (select count(distinct dish) from pg_catalog.unnest(answer_list) as x(dish)) <> pg_catalog.cardinality(answer_list)
     or (status_value in ('SUBMIT','HINT') and pg_catalog.cardinality(answer_list) = 0)
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(p_trial->'events') as e(event)
       where event->>'action' is null or event->>'action' not in ('SELECT','UNDO','HINT')
          or (event->>'dish' is not null and not (event->>'dish' = any(target_list)))
          or pg_catalog.jsonb_typeof(event->'at_ms') is distinct from 'number'
     )
     or (p_trial->>'decision' is not null and p_trial->>'decision' not in ('EXCLUDED','COLLECT','UP','DOWN','HOLD','MIN','MAX','STALE')) then
    raise sqlstate 'PT400' using message = '菜品或事件记录无效';
  end if;

  clean := pg_catalog.jsonb_build_object(
    'mode',mode_value,'number',trial_no,'size',size_value,'level',(p_trial->>'level')::int,
    'status',status_value,'valid',(p_trial->>'valid')::boolean,'exact',(p_trial->>'exact')::boolean,
    'position_accuracy',(p_trial->>'position_accuracy')::numeric,'completion',(p_trial->>'completion')::numeric,
    'response_ms',(p_trial->>'response_ms')::int,'target',target_list,'answer',answer_list,
    'undo_count',(p_trial->>'undo_count')::int,'next_size',(p_trial->>'next_size')::int,
    'decision',p_trial->>'decision','rules_version','mvp-1.0','guide_version','bento-guide-1',
    'rules_viewed_at',(p_trial->>'rules_viewed_at')::timestamptz,
    'formal_started_at',(p_trial->>'formal_started_at')::timestamptz,
    'recorded_at',(p_trial->>'recorded_at')::timestamptz,
    'events',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'action',event->>'action','dish',event->>'dish','at_ms',(event->>'at_ms')::int
      ) order by seq) from pg_catalog.jsonb_array_elements(p_trial->'events') with ordinality as e(event,seq)), '[]'::jsonb)
  );
  select payload into existing from bento_research.trials
    where participant_code=invite.participant_code and mode=mode_value and trial_number=trial_no;
  if found then
    if existing is distinct from clean then
      raise sqlstate 'PT409' using message = '同一轮已有不同记录';
    end if;
    return;
  end if;
  insert into bento_research.trials (participant_code,session_id,mode,trial_number,payload)
    values (invite.participant_code,p_session,mode_value,trial_no,clean);
end
$body$;

revoke all on function public.receive_bento_study_trial(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.receive_bento_study_trial(text,text,jsonb) to anon;

create view bento_research.trial_export as
select participant_code, session_id, mode, trial_number,
  (payload->>'size')::int as dish_count, (payload->>'level')::int as chapter,
  payload->>'status' as status, (payload->>'valid')::boolean as valid,
  (payload->>'exact')::boolean as exact,
  (payload->>'position_accuracy')::numeric as position_accuracy,
  (payload->>'completion')::numeric as completion,
  (payload->>'response_ms')::int as response_ms,
  payload->'target' as target, payload->'answer' as answer, payload->'events' as events,
  (payload->>'undo_count')::int as undo_count, payload->>'decision' as decision,
  (payload->>'next_size')::int as next_size,
  payload->>'rules_version' as rules_version, payload->>'guide_version' as guide_version,
  (payload->>'rules_viewed_at')::timestamptz as rules_viewed_at,
  (payload->>'formal_started_at')::timestamptz as formal_started_at,
  (payload->>'recorded_at')::timestamptz as recorded_at, received_at
from bento_research.trials;
revoke all on bento_research.trial_export from public, anon, authenticated;
commit;
