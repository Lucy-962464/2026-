-- Run as the project owner. Edit the codes and the invitation expiry for your study.
-- Keep the returned tokens in research-team storage. Do not commit them to GitHub.
with new_invites as materialized (
  select code, replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') as token
  from (values ('P001'),('P002'),('P003')) as wanted(code)
), saved as (
  insert into bento_research.invites (participant_code,token_hash,expires_at)
  select code,sha256(convert_to(token,'UTF8')),now()+interval '30 days' from new_invites
  returning participant_code
)
select code as participant_code,token from new_invites join saved on saved.participant_code=new_invites.code order by code;
