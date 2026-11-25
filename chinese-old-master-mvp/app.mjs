import {RULES,CHAPTERS,SPEAKERS,resume,terminate} from './model.mjs';
import {
  ARCHIVE_PREFIX,STORAGE_KEY,PRACTICE_LIMIT,newSession,prepare,record,restore,
  hasFormalSession,viewRules,practiceResults,preparePractice,recordPractice,beginFormal
} from './session.mjs?v=guide-1';

const $=id=>document.getElementById(id);
const reportNames={COMPLETED:'正常完成',INSUFFICIENT:'证据不足',ABNORMAL:'异常终止'};
const views={
  home:['home','home-title'],rules:['rules','rules-title'],
  game:['game','game-card'],practiceComplete:['practice-complete','practice-title']
};
let session=newSession(),timer,phase='ready',answerStart=0,otherTab=false,view='home';
let storageMessage='';
const isPractice=()=>!hasFormalSession(session);
const activeTask=()=>isPractice()?session.onboarding.task:session.task;
const needArchive=()=>hasFormalSession(session)||session.onboarding.attempts.length>0;
function display(name) {
  view=name;
  paint();
  $(views[name][1]).focus();
}
function save(next) {
  session=next;
  try {
    localStorage.setItem(STORAGE_KEY,JSON.stringify(session));
    storageMessage='进度已保存在此浏览器。';
  } catch {
    storageMessage='此浏览器无法保存进度。请在关闭前下载记录。';
  }
}
try {
  const previous=localStorage.getItem(STORAGE_KEY);
  if(previous) {
    const snapshot=JSON.parse(previous);
    const interrupted=Boolean(snapshot.task||snapshot.onboarding?.task);
    save(restore(previous));
    $('feedback').textContent=interrupted?'已恢复进度。中断订单已记为排除试次。':'已恢复进度。';
  } else save(session);
} catch {
  storageMessage='存档无法读取。可用当前页面开始新测评。';
}
window.addEventListener('storage',event=>{
  if(event.key!==STORAGE_KEY) return;
  otherTab=true;
  clearTimeout(timer);
  storageMessage='另一个标签页已更新进度，请刷新后继续。';
  paint();
});
function table(headers,rows) {
  const wrapper=document.createElement('div'), t=document.createElement('table');
  wrapper.className='scroll';
  const head=t.createTHead().insertRow();
  headers.forEach(label=>{const cell=document.createElement('th');cell.scope='col';cell.textContent=label;head.append(cell);});
  const body=t.createTBody();
  for(const row of rows) {
    const tr=body.insertRow();
    row.forEach(value=>{tr.insertCell().textContent=value??'—';});
  }
  wrapper.append(t);
  return wrapper;
}
const pct=x=>x===null?'—':Math.round(100*x)+'%';
function log(rows) {
  return table(['轮次','剧情','菜数','有效','完整','位置正确率','反应毫秒','证据 正确／有效','决策','下轮菜数'],rows.map(r=>
    [r.trial,'L'+r.level,r.size,r.valid?'是':r.exclusion,r.exact===null?'—':r.exact?'是':'否',
      pct(r.positionAccuracy),r.input.responseMs,r.correct+' / '+r.evidenceTrials.length,r.reason,r.nextSize]));
}
function stats(s) {
  const exact=s.trials.filter(r=>r.valid&&r.exact).length;
  const up=s.trials.filter(r=>r.nextSize!==null&&r.nextSize>r.size).length;
  const down=s.trials.filter(r=>r.nextSize!==null&&r.nextSize<r.size).length;
  return {attempts:s.trials.length,valid:s.valid,exact,up,down,
    floorHolds:s.trials.filter(r=>r.decision==='MIN').length,ceilingHolds:s.trials.filter(r=>r.decision==='MAX').length};
}
function reportText(r,s) {
  if(!r) return '';
  if(r.recommendedSize===null) return reportNames[r.status]+'。'+r.reasons.join('；')+
    (r.deferred.length?'。保留第 '+r.deferred.map(x=>x.trial).join('、')+' 轮。':'。');
  const e=r.evidence;
  const floorHolds=s.trials.filter(row=>row.decision==='MIN').length;
  const floorNote=e.size===RULES.min&&floorHolds>0?
    '本次有 '+floorHolds+' 组在 2 道菜仍达到降级条件，需人工复核最低难度是否适宜。':'';
  return '正常完成。建议继续试做 '+r.recommendedSize+' 道菜。证据为第 '+e.trials.join('、')+
    ' 轮，'+e.correct+'/'+e.trials.length+' 完整正确。'+
    (r.deferred.length?'收尾第 '+r.deferred.map(x=>x.trial).join('、')+' 轮已保留，未纳入。':'')+
    (r.suggestedProbe?'规则另提出试做 '+r.suggestedProbe+' 道菜。':'')+
    floorNote;
}
function paint() {
  for(const [name,[id]] of Object.entries(views)) $(id).hidden=name!==view;
  const practice=isPractice(),completed=practiceResults(session);
  $('home-start').textContent=!practice?'继续正式游戏':completed.length?'查看练习结果':'开始游戏';
  $('home-start').disabled=$('home-rules').disabled=$('rules-practice').disabled=otherTab;
  $('home-reset').hidden=view==='game'&&!practice||!needArchive();
  $('home-reset').disabled=otherTab;
  $('home-status').textContent=storageMessage;
  $('rules-practice').textContent=!practice?'继续正式游戏':completed.length?'查看练习结果':'我知道了，开始练习';
  const lastPractice=completed.at(-1);
  if(view==='practiceComplete'&&lastPractice) {
    $('practice-feedback').textContent=lastPractice.exact
      ?'您已经按顺序装好了两道菜！'
      :'可以对照下面的顺序。点错时，记得可以撤销最后一道菜。';
    $('practice-target').textContent=lastPractice.input.target.join(' → ');
    $('practice-answer').textContent=lastPractice.input.answer.join(' → ');
    $('practice-retry').hidden=completed.length>=PRACTICE_LIMIT;
    $('practice-retry').disabled=$('formal-start').disabled=otherTab;
  }
  if(view!=='game') return;

  const {state:s}=session;
  const task=activeTask();
  $('storage').textContent=storageMessage;
  $('chapters').hidden=$('formal-log').hidden=$('formal-actions').hidden=practice;
  const done=s.report!==null,answering=phase==='answer'&&task&&!otherTab;
  $('chapters').replaceChildren(...CHAPTERS.map((name,i)=>{
    const card=document.createElement('div'),level=i+1;
    if(s.level===level) card.setAttribute('aria-current','step');
    card.textContent='L'+level+' '+name+' · '+(s.level===null||s.level>level?'完成':s.level===level?'当前':'待解锁');
    return card;
  }));
  $('order').textContent=practice?'新手练习 · 2 道菜':done?'本次测评结束':SPEAKERS[s.level-1]+'点单 · '+s.size+' 道菜';
  $('progress').textContent=practice?'练习记录单独保存':'关内提交 '+s.submittedInLevel+' / '+RULES.storyQuota+' · 全程有效 '+s.valid+' / '+RULES.minValid+
    ' · 本组有效 '+s.openGroup.length+' / '+RULES.window;
  $('begin').hidden=practice;
  $('begin').disabled=Boolean(task)||s.paused||done||otherTab;
  $('resume').hidden=!s.paused||otherTab;
  $('abort').hidden=$('fault').hidden=!task||otherTab;
  $('undo').hidden=$('submit').hidden=$('hint').hidden=!answering;
  $('undo').disabled=!task?.answer.length;
  $('submit').disabled=!task?.answer.length||(practice&&task.answer.length!==task.target.length);
  $('hint').hidden=practice||!answering;
  $('submit').textContent=!practice&&task&&task.answer.length<s.size?'提交当前顺序（未选满）':'提交便当';
  $('end').disabled=done||otherTab;
  $('reset').disabled=otherTab;
  $('report').hidden=!done;
  $('report').textContent=reportText(s.report,s);
  const answer=$('answer');
  answer.hidden=!answering;
  answer.replaceChildren();
  if(answering) {
    for(let i=0;i<task.target.length;i++) {
      const slot=document.createElement('li');
      slot.textContent='第 '+(i+1)+' 格　'+(task.answer[i]??'待放入');
      answer.append(slot);
    }
  }
  $('choices').replaceChildren();
  if(answering) for(const dish of task.choices) {
    const button=document.createElement('button');
    button.textContent=dish;
    button.disabled=task.answer.includes(dish);
    button.onclick=()=>{
      editTask('SELECT',dish);
      ($('choices').querySelector('button:not(:disabled)')??$('submit')).focus();
    };
    $('choices').append(button);
  }
  if(!practice) $('gameLog').replaceChildren(log(s.trials));
}
function editTask(action,dish=null) {
  const task=activeTask();
  if(!task||phase!=='answer'||otherTab) return;
  const answer=action==='SELECT'?[...task.answer,dish]:action==='UNDO'?task.answer.slice(0,-1):task.answer;
  const event={action,dish:action==='UNDO'?task.answer.at(-1):dish,atMs:Math.round(performance.now()-answerStart)};
  const next={...task,answer,hinted:task.hinted||action==='HINT',events:[...task.events,event]};
  save(isPractice()?{...session,onboarding:{...session.onboarding,task:next}}:{...session,task:next});
  paint();
}
function present(index) {
  const {target}=activeTask();
  if(index===target.length) {
    $('stage').textContent='记住顺序…';
    timer=setTimeout(()=>{
      phase='answer';answerStart=performance.now();
      $('stage').textContent='请按原顺序依次点选菜品';paint();$('choices').querySelector('button')?.focus();
    },RULES.retentionMs);
    return;
  }
  $('stage').textContent=target[index];
  timer=setTimeout(()=>{
    if(index===target.length-1) present(index+1);
    else {$('stage').textContent='';timer=setTimeout(()=>present(index+1),RULES.gapMs);}
  },RULES.showMs);
}
function finish(status) {
  const task=activeTask();
  if(!task||otherTab||(status==='SUBMIT'&&(phase!=='answer'||!task.answer.length))) return;
  const elapsed=phase==='answer'?Math.round(performance.now()-answerStart):null;
  if(isPractice()) {
    const next=recordPractice(session,status,elapsed);
    if(next===session) return;
    clearTimeout(timer);
    save(next);
    phase='ready';
    if(status==='SUBMIT'||practiceResults(session).length) display('practiceComplete');
    else display('rules');
    return;
  }
  clearTimeout(timer);
  const next=record(session,status,elapsed);
  save(next);phase='ready';
  const last=session.state.trials.at(-1);
  $('feedback').textContent=(last.exclusion?last.exclusion+' · ':'')+last.reason+
    (last.nextLevel===null&&last.settled?'（剧情已结束，未生成下一轮）':'')+
    (session.state.paused?'。连续 3 轮排除，已暂停。':'');
  $('stage').textContent='本轮已记录';
  paint();
}
function download(filename,value) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function startOrder(practice) {
  if(otherTab||phase!=='ready') return;
  const next=practice?preparePractice(session):prepare(session);
  if(next===session) return;
  save(next);
  phase='show';
  $('feedback').textContent='';
  display('game');
  present(0);
}
function enterGame() {
  $('stage').textContent='准备好后开始订单';
  display('game');
}
function openRules() {
  if(otherTab) return;
  if(!session.onboarding.rulesViewedAt) save(viewRules(session));
  display('rules');
}
function continueGame() {
  if(otherTab) return;
  if(!isPractice()) enterGame();
  else if(practiceResults(session).length) display('practiceComplete');
  else openRules();
}
$('home-start').onclick=continueGame;
$('home-rules').onclick=openRules;
$('rules-back').onclick=()=>display('home');
$('rules-practice').onclick=()=>{
  if(isPractice()&&!practiceResults(session).length) startOrder(true);
  else continueGame();
};
$('practice-retry').onclick=()=>startOrder(true);
$('formal-start').onclick=()=>{
  if(otherTab) return;
  const next=beginFormal(session);
  if(next===session) return;
  save(next);
  $('feedback').textContent='正式游戏从第 1 轮开始。';
  enterGame();
};
$('begin').onclick=()=>{if(!isPractice()) startOrder(false);};
$('undo').onclick=()=>editTask('UNDO');
$('hint').onclick=()=>{editTask('HINT');$('stage').textContent=session.task.target.join(' → ');};
$('submit').onclick=()=>finish('SUBMIT');
$('abort').onclick=()=>finish('ABORT');
$('fault').onclick=()=>finish('TECH');
$('resume').onclick=()=>{save({...session,state:resume(session.state)});$('feedback').textContent='已继续测评';paint();};
$('end').onclick=()=>{
  if(!window.confirm('结束本次测评并保留已记录的试次？')) return;
  if(session.task) finish('ABORT');
  save({...session,state:terminate(session.state,'用户选择提前结束')});paint();
};
function exportSession(item) {
  const {state}=item;
  return {...item,rules:RULES,state:{...state,trials:state.trials.map(row=>({...row,mode:'formal'}))},metrics:stats(state)};
}
function resetSession() {
  if(otherTab) return;
  if(needArchive()) {
    if(!window.confirm('将本次记录存档，并为下一位重新开始？')) return;
    const archived=session.task?record(session,'INTERRUPTED'):
      session.onboarding.task?recordPractice(session,'INTERRUPTED'):session;
    try {
      localStorage.setItem(ARCHIVE_PREFIX+archived.id,JSON.stringify(archived));
    } catch {
      storageMessage='本机存档失败，当前记录已保留。请先下载记录。';
      paint();
      return;
    }
  }
  clearTimeout(timer);
  phase='ready';
  save(newSession());
  $('feedback').textContent='';
  $('stage').textContent='准备好后开始订单';
  display('home');
}
$('reset').onclick=$('home-reset').onclick=resetSession;
$('export').onclick=()=>download('old-master-mvp-'+session.id+'.json',exportSession(session));
$('export-local').onclick=()=>{
  const records=new Map();
  try {
    for(let i=0;i<localStorage.length;i++) {
      const key=localStorage.key(i);
      if(!key?.startsWith(ARCHIVE_PREFIX)) continue;
      const item=JSON.parse(localStorage.getItem(key));
      records.set(item.id,exportSession(item));
    }
  } catch {
    storageMessage='部分本机存档无法读取，将下载当前记录和已读取的存档。';
    paint();
  }
  records.set(session.id,exportSession(session));
  download('old-master-mvp-archive.json',{exportedAt:new Date().toISOString(),sessions:[...records.values()]});
};
paint();

