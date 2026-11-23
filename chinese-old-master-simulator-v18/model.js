const defaults = {
  window:3, up:3, down:1, quota:8, extraLimit:12, pauseAfter:3, xp:10, show:1300, gap:250, wait:800,
  startSize:2, minSize:2, maxSize:5, cooldown:0, minRecentGroups:1, minValid:32
};
const VERSION='1.8';
const RNG_VERSION='counter-hash-v1';
const RAPID_REVERSAL_TRIALS=3;
const assessmentLabels={COMPLETED:'正常完成',INSUFFICIENT_EVIDENCE:'证据不足',ABNORMAL_TERMINATION:'异常终止'};
const terminationReasons={WITHDRAWAL:'参与者退出',TECHNICAL_ISSUE:'设备故障',OTHER:'其他原因'};
const evidenceReasons={BELOW_MIN_VALID:'累计有效试次未达最低要求',
  BELOW_MIN_RECENT_GROUPS:'最近一次实际调难后的完整证据组未达最低要求'};
const titles = ['孙子的便当','女儿的便当','爷爷的便当','全家的便当'];
const speakers = ['孙子','女儿','爷爷','奶奶'];
const pool = ['番茄炒蛋','清炒西兰花','红烧肉','蒸南瓜','家常豆腐','凉拌黄瓜','鱼香茄子','蒸鸡蛋羹','糖醋里脊'];
const profiles = ['稳定高表现','中等 · 高难度困难','低起点表现','波动表现'];
const defaultRates=[[98,97,95,92],[90,85,48,30],[32,24,14,8],[61,50,46,39]];
const statuses = ['SUBMIT','HINT','ABORT','TECH'];
const decisions = {
  INVALID:'无效 · 不计入证据', COLLECT:'保持 · 累计中', UP:'升级', DOWN:'降级',
  MAX:'上限保持', MIN:'下限保持', HOLD:'普通保持', COOLDOWN:'冷却保持',
  FINAL_PRIOR_EVIDENCE:'收尾 · 使用最近完整组', FINAL_INSUFFICIENT:'证据不足 · 未形成最终判断'
};
const integer = (x,a,b) => Number.isInteger(x) && x>=a && x<=b;
function validConfig(c) {
  return integer(c.window,1,12) && integer(c.up,1,c.window) && integer(c.down,0,c.up-1)
    && integer(c.quota,1,16) && integer(c.extraLimit,0,30) && integer(c.pauseAfter,2,12) && integer(c.xp,0,1000) && integer(c.show,100,10000)
    && integer(c.gap,0,5000) && integer(c.wait,0,10000)
    && integer(c.minSize,2,5) && integer(c.maxSize,c.minSize,5) && integer(c.startSize,c.minSize,c.maxSize)
    && integer(c.cooldown,0,3) && integer(c.minValid,1,120) && integer(c.minRecentGroups,1,5);
}
function start(c) {
  return {level:1,n:c.startSize,done:0,extraTrials:0,v:0,k:0,xp:0,gameCompleted:false,paused:false,excludedStreak:0,
    lastDirection:null,cooldownRemaining:0,validTotal:0,groupsAtSize:0,lastAdjustmentTrial:null,
    lastSettled:null,pendingTrials:[],attempts:0,assessment:null};
}
function resume(s) {
  if(!s.paused) return s;
  return {...s,paused:false,excludedStreak:0};
}
function terminate(s,reason) {
  if(s.assessment||!Object.hasOwn(terminationReasons,reason)) return s;
  return {...s,paused:false,assessment:{status:'ABNORMAL_TERMINATION',reasons:[reason],recommendedSize:null}};
}
function finalize(c,{validTotal,groupsAtSize,lastAdjustmentTrial,lastSettled,pendingTrials,pendingCorrect,n}) {
  const reasons=[];
  if(validTotal<c.minValid) reasons.push('BELOW_MIN_VALID');
  if(groupsAtSize<c.minRecentGroups||lastSettled?.size!==n) reasons.push('BELOW_MIN_RECENT_GROUPS');
  return {status:reasons.length?'INSUFFICIENT_EVIDENCE':'COMPLETED',reasons,
    recommendedSize:reasons.length?null:n,
    suggestedProbeSize:reasons.length||lastSettled.candidate===n?null:lastSettled.candidate,
    basis:reasons.length?null:lastSettled,groupsAtSize,lastAdjustmentTrial,
    deferred:{trials:pendingTrials,correct:pendingCorrect}};
}
function synthetic(profile,i,n,performance=null) {
  const status = i===5?'ABORT':i===12?'HINT':i===19?'TECH':'SUBMIT';
  const baseline = profile===0 || (profile===1 && n<=3) ||
    (profile===2 && i%5===0) || (profile===3 && [1,2,4].includes(i%6));
  const phase=performance?.temporal&&profile===3?temporalPhase(i):null;
  const probability=performance?Math.max(0,Math.min(100,performance.rates[n-2]+(phase?.offset??0)))/100:null;
  const draw=performance?sample(performance.seed,profile,i):null;
  const exact = performance ? draw<probability : baseline;
  return {status, items:status==='SUBMIT'||status==='HINT'?(exact||profile!==2?n:n-1):null,
    hits:status==='SUBMIT'||status==='HINT'?(exact?n:profile===2?0:n-2):null,
    probability,draw,phase:phase?.name??null};
}
function temporalPhase(i) {
  if(i===4) return {name:'isolated_dip',offset:-35};
  if(i<=9) return {name:'initial',offset:20};
  if(i<=18) return {name:'sustained_low',offset:-35};
  if(i<=27) return {name:'recovery',offset:24};
  return {name:'alternating',offset:Math.floor((i-28)/2)%2===0?-25:25};
}
function sample(seed,profile,i) {
  let value=(seed+Math.imul(profile+1,0x9e3779b9)+Math.imul(i,0x85ebca6b))>>>0;
  value=Math.imul(value^(value>>>16),0x21f0aaad);
  value=Math.imul(value^(value>>>15),0x735a2d97);
  return ((value^(value>>>15))>>>0)/4294967296;
}
function countFromRate(rate,n) {
  if(!Number.isFinite(rate)||rate<0||rate>100) return null;
  const count=Math.round(rate*n/100);
  const exact=100*count/n;
  return rate===Math.round(exact)||Math.abs(rate-exact)<=0.005001?count:null;
}
function allowedRates(n,min=0) {
  return Array.from({length:n-min+1},(_,i)=>Math.round(100*(i+min)/n)+'%').join('、');
}
function validateRates(n,completion,accuracy) {
  const items=countFromRate(completion,n), hits=countFromRate(accuracy,n);
  let error=null;
  if(items===null||items===0) error='提交完成率 '+(Number.isFinite(completion)?completion+'%':'未填写')+
    '。'+n+' 道菜须至少提交 1 道，可填写 '+allowedRates(n,1)+'。';
  else if(hits===null) error='位置正确率 '+(Number.isFinite(accuracy)?accuracy+'%':'未填写')+
    ' 无法对应 '+n+' 道菜的整数位置数。可填写 '+allowedRates(n)+'。';
  else if(hits>items) error='正确位置数（'+hits+'）不能超过已提交菜数（'+items+'）。';
  else if(items===n&&hits===n-1) error='全量提交时，错位至少涉及两道菜，不能只有一个位置错误。';
  return {items,hits,error};
}
function step(c,s,input,validBudget=null) {
  if(s.assessment||s.gameCompleted) throw new Error('测评已结束');
  if(s.paused) throw new Error('测验已暂停');
  const {status,items,hits} = input;
  const submitted = ['SUBMIT','HINT'].includes(status) && integer(items,1,s.n) &&
    integer(hits,0,items) && !(items===s.n && hits===s.n-1);
  const valid = submitted && status==='SUBMIT';
  const exclusionReason=valid?null:status==='ABORT'?'ABORTED':status==='TECH'?'TECHNICAL_ISSUE':
    submitted?'HINTED_SUBMISSION':'INVALID_INPUT';
  const exact = submitted && hits===s.n;
  const v=s.v+Number(valid), k=s.k+Number(valid&&exact);
  const block=valid && v===c.window;
  let decision = !valid?'INVALID':'COLLECT', candidate=s.n;
  if(block) {
    if(k>=c.up) { candidate=Math.min(c.maxSize,s.n+1); decision=candidate>s.n?'UP':'MAX'; }
    else if(k<=c.down) { candidate=Math.max(c.minSize,s.n-1); decision=candidate<s.n?'DOWN':'MIN'; }
    else decision='HOLD';
  }
  const proposedDecision=decision;
  if(s.cooldownRemaining>0&&(decision==='UP'||decision==='DOWN')&&decision!==s.lastDirection) {
    decision='COOLDOWN';candidate=s.n;
  }
  const done=s.done+Number(submitted), quotaReached=validBudget===null&&done>=c.quota;
  const extraTrials=s.extraTrials+Number(validBudget===null&&s.done>=c.quota);
  const gameCompleted=quotaReached&&s.level===titles.length;
  const validTotal=s.validTotal+Number(valid);
  const ending=gameCompleted||(validBudget!==null&&validTotal>=validBudget);
  const attempts=s.attempts+1;
  const evidenceTrials=valid?[...s.pendingTrials,attempts]:s.pendingTrials;
  const groupsAtSize=s.groupsAtSize+Number(block);
  const lastSettled=block?{level:s.level,size:s.n,trials:evidenceTrials,correct:k,decision,candidate}:s.lastSettled;
  const assessment=ending?finalize(c,{validTotal,groupsAtSize,lastAdjustmentTrial:s.lastAdjustmentTrial,
    lastSettled,pendingTrials:block?[]:evidenceTrials,pendingCorrect:block?0:k,n:s.n}):null;
  const capped=quotaReached&&!gameCompleted&&!block&&v>0&&extraTrials>=c.extraLimit;
  const advance=quotaReached&&!gameCompleted&&(block||v===0||capped);
  const evidenceStatus=block?'SETTLED':v===0?'EMPTY':ending?'INCOMPLETE_AT_END':capped?'INCOMPLETE_AT_CHAPTER_CAP':'COLLECTING';
  const excludedStreak=valid?0:s.excludedStreak+1;
  const paused=!ending&&excludedStreak>=c.pauseAfter;
  const adjusted=!ending&&candidate!==s.n;
  if(ending&&valid&&!block) decision=assessment.status==='COMPLETED'?'FINAL_PRIOR_EVIDENCE':'FINAL_INSUFFICIENT';
  return {submitted,valid,exclusionReason,exact,v,k,decision,proposedDecision,candidate,advance,quotaReached,extraTrials,gameCompleted,evidenceStatus,evidenceTrials,
    pauseReason:paused?'CONSECUTIVE_EXCLUDED_TRIALS':null,
    stars:submitted?(valid?(exact?3:2):1):0,
    next:{level:ending?null:s.level+Number(advance),n:ending?null:candidate,done:advance?0:done,extraTrials:advance?0:extraTrials,
      v:block||advance?0:v,k:block||advance?0:k,xp:s.xp+(submitted?c.xp:0),gameCompleted,paused,excludedStreak,
      lastDirection:adjusted?decision:s.lastDirection,cooldownRemaining:adjusted?c.cooldown:Math.max(0,s.cooldownRemaining-Number(block)),
      validTotal,attempts,lastSettled,
      pendingTrials:block||advance?[]:evidenceTrials,
      groupsAtSize:adjusted?0:groupsAtSize,lastAdjustmentTrial:adjusted?attempts:s.lastAdjustmentTrial,assessment}};
}
function run(c,profile,performance=null,validBudget=null) {
  let s=start(c);
  const rows=[];
  for(let i=1;!s.assessment&&!s.paused;i++) {
    const input=synthetic(profile,i,s.n,performance), result=step(c,s,input,validBudget);
    rows.push({i,s,input,result});
    s=result.next;
  }
  return rows;
}
function summarize(c,rows) {
  const decisions={UP:0,DOWN:0,HOLD:0,MIN:0,MAX:0,COOLDOWN:0,COLLECT:0,INVALID:0,FINAL_PRIOR_EVIDENCE:0,FINAL_INSUFFICIENT:0};
  const bySize=Array.from({length:4},(_,i)=>({n:i+2,trials:0,valid:0,correct:0}));
  let validTrials=0,fullCorrectTrials=0,previous=null,reversals=0,rapidReversals=0,appliedUp=0,appliedDown=0,lastChange=0;
  for(const {s,result:r} of rows) {
    const bucket=bySize[s.n-2];
    bucket.trials++;
    decisions[r.decision]++;
    if(r.valid) {
      validTrials++;bucket.valid++;
      if(r.exact) {fullCorrectTrials++;bucket.correct++;}
    }
    if(r.next.n===null||r.next.n===s.n) continue;
    lastChange=validTrials;
    const direction=Math.sign(r.next.n-s.n);
    if(direction>0) appliedUp++;
    else appliedDown++;
    if(previous&&direction!==previous.direction) {
      reversals++;
      if(validTrials-previous.validIndex<=RAPID_REVERSAL_TRIALS) rapidReversals++;
    }
    previous={direction,validIndex:validTrials};
  }
  // A stable tail requires at least two windows with no further applied change.
  const stableAfterValid=validTrials-lastChange>=2*c.window?lastChange:null;
  return {validTrials,fullCorrectTrials,fullSequenceAccuracy:validTrials?fullCorrectTrials/validTrials:null,
    decisions,appliedUp,appliedDown,reversals,rapidReversals,stableAfterValid,bySize};
}
function rollingVolatility(rows) {
  const valid=rows.filter(row=>row.result.valid).map(row=>Number(row.result.exact));
  const rates=valid.slice(4).map((_,i)=>valid.slice(i,i+5).reduce((a,b)=>a+b,0)/5);
  if(!rates.length) return null;
  const mean=rates.reduce((sum,x)=>sum+x,0)/rates.length;
  return Math.sqrt(rates.reduce((sum,x)=>sum+(x-mean)**2,0)/rates.length);
}

