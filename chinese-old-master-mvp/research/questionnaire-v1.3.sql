begin;

create table if not exists bento_research.difficulty_feedback (
  participant_id text not null references bento_research.invites(participant_code),
  session_id text not null,
  trial_no integer not null check (trial_no between 1 and 500),
  story_level integer not null check (story_level between 1 and 4),
  decision_trial_no integer not null,
  question_kind text not null check (question_kind in ('preference','difficulty')),
  questionnaire_version text not null check (questionnaire_version = 'V1.3'),
  dish_count_before integer not null check (dish_count_before between 2 and 5),
  dish_count_after integer not null check (dish_count_after between 2 and 5),
  algorithm_action integer not null check (algorithm_action in (-1,0,1)),
  actual_action integer not null check (actual_action in (-1,0,1)),
  preference_response text,
  difficulty_response text,
  valid_trials integer not null check (valid_trials >= 3),
  response_time timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (participant_id, session_id, trial_no, question_kind, questionnaire_version),
  check (
    (question_kind = 'preference' and preference_response is not null and difficulty_response is null)
    or (question_kind = 'difficulty' and difficulty_response is not null and preference_response is null)
  )
);
alter table bento_research.difficulty_feedback enable row level security;
revoke all on bento_research.difficulty_feedback from public, anon, authenticated;

create or replace function public.receive_bento_feedback(p_token text, p_session text, p_feedback jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $body$
declare
  invite_id text;
  kind text;
  trial_id integer;
  current_trial jsonb;
  source_trial jsonb;
  previous_change integer;
  source_id integer;
  before_size integer;
  after_size integer;
  desired_action integer;
  actual_direction integer;
  valid_count integer;
  preference text;
  difficulty text;
  answered_at timestamptz;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_session is null or p_session !~ '^[a-f0-9]{32}$' then
    raise sqlstate 'PT403' using message='研究链接不可用';
  end if;
  select participant_code into invite_id from bento_research.invites
    where token_hash=pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8'))
      and enrolled_session=p_session and revoked_at is null and expires_at>pg_catalog.now()
    for update;
  if not found then raise sqlstate 'PT403' using message='研究链接不可用'; end if;
  if p_feedback is null then return; end if;

  if pg_catalog.jsonb_typeof(p_feedback) is distinct from 'object'
     or pg_catalog.octet_length(p_feedback::text)>4000
     or p_feedback->>'questionnaire_version' is distinct from 'V1.3' then
    raise sqlstate 'PT400' using message='难度反馈格式无效';
  end if;
  kind:=p_feedback->>'question_kind';
  trial_id:=(p_feedback->>'trial_no')::integer;
  preference:=p_feedback->>'preference_response';
  difficulty:=p_feedback->>'difficulty_response';
  answered_at:=(p_feedback->>'response_time')::timestamptz;
  if trial_id is null or trial_id not between 1 and 500 or answered_at is null
     or kind is null or kind not in ('preference','difficulty')
     or (kind='preference' and (difficulty is not null or preference is null or preference not in ('increase','keep','decrease','unsure')))
     or (kind='difficulty' and (preference is not null or difficulty is null or difficulty not in ('very_easy','easy','appropriate','hard','very_hard','unsure'))) then
    raise sqlstate 'PT400' using message='难度反馈选项无效';
  end if;

  select payload into current_trial from bento_research.trials
    where participant_code=invite_id and session_id=p_session and mode='formal' and trial_number=trial_id;
  if not found or current_trial->>'valid' is distinct from 'true' then
    raise sqlstate 'PT400' using message='难度反馈须关联有效的正式试次';
  end if;
  select max(trial_number) into previous_change from bento_research.trials
    where participant_code=invite_id and session_id=p_session and mode='formal' and trial_number<trial_id
      and payload->>'next_size' is not null and payload->>'next_size'<>payload->>'size';
  select count(*)::integer into valid_count from bento_research.trials
    where participant_code=invite_id and session_id=p_session and mode='formal'
      and trial_number>coalesce(previous_change,0) and trial_number<=trial_id
      and payload->>'valid'='true' and payload->>'size'=current_trial->>'size';

  if kind='preference' then
    source_trial:=current_trial;
    source_id:=trial_id;
    if valid_count<3 or source_trial->>'decision' is null or source_trial->>'decision' not in ('UP','DOWN','HOLD','MIN','MAX') then
      raise sqlstate 'PT400' using message='没有可关联的难度决策';
    end if;
  else
    source_id:=previous_change;
    select payload into source_trial from bento_research.trials
      where participant_code=invite_id and session_id=p_session and mode='formal' and trial_number=source_id;
    if not found or valid_count<>3 or source_trial->>'next_size' is distinct from current_trial->>'size' then
      raise sqlstate 'PT400' using message='尚未完成调整后的三次有效试次';
    end if;
  end if;
  before_size:=(source_trial->>'size')::integer;
  after_size:=(source_trial->>'next_size')::integer;
  if after_size is null then raise sqlstate 'PT400' using message='该试次没有下一轮难度'; end if;
  desired_action:=case source_trial->>'decision' when 'UP' then 1 when 'MAX' then 1 when 'DOWN' then -1 when 'MIN' then -1 else 0 end;
  actual_direction:=pg_catalog.sign(after_size-before_size)::integer;

  insert into bento_research.difficulty_feedback (
    participant_id,session_id,trial_no,story_level,decision_trial_no,question_kind,questionnaire_version,
    dish_count_before,dish_count_after,algorithm_action,actual_action,preference_response,difficulty_response,valid_trials,response_time
  ) values (
    invite_id,p_session,trial_id,(current_trial->>'level')::integer,source_id,kind,'V1.3',
    before_size,after_size,desired_action,actual_direction,preference,difficulty,valid_count,answered_at
  ) on conflict (participant_id,session_id,trial_no,question_kind,questionnaire_version) do nothing;
  if not found and not exists (
    select 1 from bento_research.difficulty_feedback f
    where f.participant_id=invite_id and f.session_id=p_session and f.trial_no=trial_id and f.question_kind=kind
      and f.questionnaire_version='V1.3' and f.preference_response is not distinct from preference
      and f.difficulty_response is not distinct from difficulty and f.response_time=answered_at
  ) then raise sqlstate 'PT409' using message='同一题已有不同反馈'; end if;
end
$body$;

revoke all on function public.receive_bento_feedback(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.receive_bento_feedback(text,text,jsonb) to anon;

create or replace view bento_research.feedback_export as
select participant_id,session_id,trial_no,story_level,question_kind,questionnaire_version,decision_trial_no,
       dish_count_before,dish_count_after,algorithm_action,actual_action,preference_response,
       difficulty_response,valid_trials,response_time,received_at,
       case preference_response when 'increase' then 1 when 'keep' then 0 when 'decrease' then -1 end as preference_direction,
       case difficulty_response when 'very_easy' then 1 when 'easy' then 2 when 'appropriate' then 3
         when 'hard' then 4 when 'very_hard' then 5 end as difficulty_score
from bento_research.difficulty_feedback;
revoke all on bento_research.feedback_export from public, anon, authenticated;

commit;

select to_regclass('bento_research.difficulty_feedback') is not null as feedback_created,
       has_function_privilege('anon','public.receive_bento_feedback(text,text,jsonb)','EXECUTE') as submit_allowed,
       has_table_privilege('anon','bento_research.feedback_export','SELECT') as public_can_export;
