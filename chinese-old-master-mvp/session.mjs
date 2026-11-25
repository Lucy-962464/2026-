import {advance,orderFor,RULES,score,start} from './model.mjs';

export const STORAGE_KEY='chinese-old-master/mvp-1.0';
export const ARCHIVE_PREFIX=STORAGE_KEY+'/archive/';
export const GUIDE_VERSION='bento-guide-1';
export const PRACTICE_LIMIT=2;
const PRACTICE_ORDERS=[
  ['番茄炒蛋','家常豆腐'],
  ['蒸南瓜','糖醋里脊']
];
const emptyTask=order=>({...order,answer:[],events:[],hinted:false});
const newId=()=>Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('');
const newOnboarding=()=>({version:GUIDE_VERSION,rulesViewedAt:null,formalStartedAt:null,attempts:[],task:null});

export const newSession=()=>({
  id:newId(),createdAt:new Date().toISOString(),version:RULES.version,state:start(),task:null,onboarding:newOnboarding()
});

export function hasFormalSession(session) {
  return Boolean(session.onboarding?.formalStartedAt||session.task||session.state.trials.length||session.state.report);
}

export function viewRules(session) {
  const {onboarding}=session;
  if(onboarding.rulesViewedAt) return session;
  return {...session,onboarding:{...onboarding,rulesViewedAt:new Date().toISOString()}};
}

export function practiceResults(session) {
  return session.onboarding.attempts.filter(row=>row.status==='SUBMIT');
}

export function preparePractice(session) {
  const {onboarding}=session;
  const count=practiceResults(session).length;
  if(!onboarding.rulesViewedAt||onboarding.task||hasFormalSession(session)||count>=PRACTICE_LIMIT) return session;
  const target=PRACTICE_ORDERS[count];
  return {...session,onboarding:{...onboarding,task:emptyTask({target,choices:[...target].reverse()})}};
}

export function beginFormal(session) {
  if(hasFormalSession(session)||session.onboarding.task||!practiceResults(session).length) return session;
  return {...session,state:start(),task:null,onboarding:{...session.onboarding,formalStartedAt:new Date().toISOString()}};
}

export function prepare(session) {
  const {state}=session;
  if(session.task||state.paused||state.report) return session;
  return {...session,task:emptyTask(orderFor(state.trials.length+1,state.size))};
}

function trialInput(task,status,responseMs) {
  const result=status==='SUBMIT'?score(task.target,task.answer):null;
  if(status==='SUBMIT'&&!result) throw new Error('请选择至少一道菜再提交');
  return {
    status:result&&task.hinted?'HINT':status,items:result?.items??null,hits:result?.hits??null,
    exact:result?.exact??null,positionAccuracy:result?.positionAccuracy??null,completion:result?.completion??null,
    responseMs:status==='INTERRUPTED'?null:responseMs,target:task.target,answer:task.answer,
    events:task.events,undoCount:task.events.filter(e=>e.action==='UNDO').length
  };
}

export function recordPractice(session,status,responseMs=null) {
  const {onboarding}=session;
  const task=onboarding.task;
  if(!task) return session;
  if(status==='SUBMIT'&&task.answer.length!==task.target.length) return session;
  const input=trialInput(task,status,responseMs);
  const row={
    mode:'practice',attempt:onboarding.attempts.length+1,status,size:task.target.length,
    exact:input.exact,positionAccuracy:input.positionAccuracy,completion:task.answer.length/task.target.length,
    input,savedAt:new Date().toISOString()
  };
  return {...session,onboarding:{...onboarding,task:null,attempts:[...onboarding.attempts,row]}};
}

export function record(session,status,responseMs=null) {
  const {state,task}=session;
  if(!task) return session;
  const input=trialInput(task,status,responseMs);
  const next=advance(state,input);
  const last=next.trials.at(-1);
  last.mode='formal';
  last.savedAt=new Date().toISOString();
  return {...session,state:next,task:null};
}

export function restore(raw) {
  if(!raw) return newSession();
  const parsed=JSON.parse(raw);
  if(parsed.version!==RULES.version||!Array.isArray(parsed.state?.trials)) throw new Error('存档版本或内容无效');
  const session={
    ...parsed,id:parsed.id??newId(),createdAt:parsed.createdAt??null,
    onboarding:parsed.onboarding??newOnboarding()
  };
  if(session.task) return record(session,'INTERRUPTED');
  if(session.onboarding.task) return recordPractice(session,'INTERRUPTED');
  return session;
}
