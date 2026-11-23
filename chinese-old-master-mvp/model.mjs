export const RULES = Object.freeze({
  version:'mvp-1.0', start:2, min:2, max:5, window:3, up:3, down:1, cooldown:0,
  storyQuota:8, extraLimit:12, minValid:32, finalGroups:1, pauseAfter:3, showMs:1300, gapMs:250, retentionMs:800
});
export const CHAPTERS = Object.freeze(['孙子的便当','女儿的便当','爷爷的便当','全家的便当']);
export const SPEAKERS = Object.freeze(['孙子','女儿','爷爷','奶奶']);
export const DISHES = Object.freeze(['番茄炒蛋','清炒西兰花','红烧肉','蒸南瓜','家常豆腐','凉拌黄瓜','鱼香茄子','蒸鸡蛋羹','糖醋里脊']);
export const DECISIONS = Object.freeze({
  EXCLUDED:'排除本轮，无新增有效证据',COLLECT:'有效证据继续累计',
  UP:'3/3 完整正确，下一轮增加 1 道',DOWN:'0–1/3 完整正确，下一轮减少 1 道',
  HOLD:'2/3 完整正确，维持菜数',MIN:'达到降级条件，已在 2 道菜下限',
  MAX:'达到升级条件，已在 5 道菜上限',STALE:'收尾未满组，保留记录'
});
export function start() {
  return {level:1,size:RULES.start,trials:[],submittedInLevel:0,extra:0,valid:0,openGroup:[],
    recentGroups:0,lastGroup:null,lastChange:null,exclusionStreak:0,paused:false,report:null};
}
export function orderFor(trial,size) {
  const target=Array.from({length:size},(_,i)=>DISHES[((trial-1)*2+i*4)%DISHES.length]);
  const rotation=1+(trial-1)%(size-1);
  return {target,choices:target.slice(rotation).concat(target.slice(0,rotation))};
}
export function score(target,answer) {
  if(!Array.isArray(target)||target.length<RULES.min||target.length>RULES.max||
    new Set(target).size!==target.length||!target.every(dish=>DISHES.includes(dish))||
    !Array.isArray(answer)||answer.length<1||answer.length>target.length||
    new Set(answer).size!==answer.length||!answer.every(dish=>target.includes(dish))) return null;
  const hits=answer.filter((dish,i)=>dish===target[i]).length;
  return {items:answer.length,hits,positionAccuracy:hits/target.length,completion:answer.length/target.length,exact:hits===target.length};
}
function validCounts(n,items,hits) {
  return Number.isInteger(items)&&items>=1&&items<=n&&Number.isInteger(hits)&&hits>=0&&hits<=items&&
    !(items===n&&hits===n-1);
}
function outcome(s,basis,pending,valid,recentGroups) {
  const reasons=[];
  if(valid<RULES.minValid) reasons.push('全程有效试次未达 32 次');
  if(recentGroups<RULES.finalGroups||basis?.size!==s.size) reasons.push('当前菜数下，最近调难后尚无完整证据组');
  const sufficient=reasons.length===0;
  return {status:sufficient?'COMPLETED':'INSUFFICIENT',recommendedSize:sufficient?s.size:null,
    suggestedProbe:sufficient&&basis.candidate!==s.size?basis.candidate:null,reasons,
    evidence:sufficient?basis:null,deferred:pending};
}
export function advance(s,input) {
  if(s.report||s.paused) throw new Error('当前测评已结束或暂停');
  const n=s.size,trial=s.trials.length+1;
  const submitted=['SUBMIT','HINT'].includes(input.status)&&validCounts(n,input.items,input.hits);
  const valid=submitted&&input.status==='SUBMIT';
  const exact=submitted?input.hits===n:null;
  const exclusion=valid?null:submitted?'提示提交':({ABORT:'主动中止',TECH:'设备异常',INTERRUPTED:'中断未提交'})[input.status]??'无效提交';
  const evidence=valid?[...s.openGroup,{trial,exact}]:s.openGroup;
  const settled=evidence.length===RULES.window;
  const correct=evidence.filter(x=>x.exact).length;
  const validTotal=s.valid+Number(valid);
  const submittedInLevel=s.submittedInLevel+Number(submitted);
  const extra=s.extra+Number(s.submittedInLevel>=RULES.storyQuota);
  const quota=submittedInLevel>=RULES.storyQuota;
  const ended=quota&&s.level===CHAPTERS.length;
  const capped=quota&&!settled&&evidence.length>0&&extra>=RULES.extraLimit;
  const changeLevel=quota&&!ended&&(settled||evidence.length===0||capped);
  let decision=valid?'COLLECT':'EXCLUDED',candidate=n;
  if(settled) {
    candidate=correct>=RULES.up?Math.min(RULES.max,n+1):correct<=RULES.down?Math.max(RULES.min,n-1):n;
    decision=correct>=RULES.up?(n===candidate?'MAX':'UP'):correct<=RULES.down?(n===candidate?'MIN':'DOWN'):'HOLD';
  } else if(ended&&valid) decision='STALE';
  const basis=settled?{trials:evidence.map(t=>t.trial),size:n,correct,candidate}:s.lastGroup;
  const recentGroups=s.recentGroups+Number(settled);
  const pending=settled?[]:evidence;
  const report=ended?outcome(s,basis,pending,validTotal,recentGroups):null;
  const nextSize=ended?null:candidate;
  const applied=nextSize!==null&&nextSize!==n;
  const level=ended?null:s.level+Number(changeLevel);
  const exclusionStreak=valid?0:s.exclusionStreak+1;
  const reason=ended&&candidate!==n?(decision==='UP'?'3/3 完整正确，达到升级条件':'0–1/3 完整正确，达到降级条件')+
    '。末轮已结束，未实际调难。':DECISIONS[decision];
  const row={trial,level:s.level,size:n,input,submitted,valid,exact,exclusion,
    positionAccuracy:submitted?input.hits/n:null,completion:submitted?input.items/n:null,
    evidenceTrials:evidence.map(t=>t.trial),correct,settled,decision,reason,
    proposedSize:candidate,nextSize,nextLevel:level,storyCapReached:changeLevel&&capped,finalStatus:report?.status??null};
  return {level,size:nextSize,trials:[...s.trials,row],submittedInLevel:changeLevel?0:submittedInLevel,
    extra:changeLevel?0:extra,valid:validTotal,openGroup:changeLevel?[]:pending,recentGroups:applied?0:recentGroups,
    lastGroup:basis,lastChange:applied?trial:s.lastChange,exclusionStreak,paused:!ended&&exclusionStreak>=RULES.pauseAfter,report};
}
export function resume(s) {
  return s.paused?{...s,paused:false,exclusionStreak:0}:s;
}
export function terminate(s,reason) {
  return s.report?s:{...s,paused:false,report:{status:'ABNORMAL',recommendedSize:null,reasons:[reason],deferred:s.openGroup}};
}

