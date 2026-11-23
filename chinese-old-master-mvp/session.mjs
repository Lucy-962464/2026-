import {advance,orderFor,RULES,score,start} from './model.mjs';
export const STORAGE_KEY='chinese-old-master/mvp-1.0';
export const newSession=()=>({version:RULES.version,state:start(),task:null});
export function prepare(session) {
  const {state}=session;
  if(session.task||state.paused||state.report) return session;
  return {...session,task:{...orderFor(state.trials.length+1,state.size),answer:[],events:[],hinted:false}};
}
export function record(session,status,responseMs=null) {
  const {state,task}=session;
  if(!task) return session;
  const result=status==='SUBMIT'?score(task.target,task.answer):null;
  if(status==='SUBMIT'&&!result) throw new Error('请选择至少一道菜再提交');
  const input={status:result&&task.hinted?'HINT':status,items:result?.items??null,hits:result?.hits??null,
    responseMs:result?responseMs:null,target:task.target,answer:task.answer,events:task.events,undoCount:task.events.filter(e=>e.action==='UNDO').length};
  return {...session,state:advance(state,input),task:null};
}
export function restore(raw) {
  if(!raw) return newSession();
  const session=JSON.parse(raw);
  if(session.version!==RULES.version||!Array.isArray(session.state?.trials)) throw new Error('存档版本或内容无效');
  // Interrupted presentation or response cannot be scored after a reload.
  return session.task?record(session,'INTERRUPTED'):session;
}

