import {RULES,CHAPTERS,SPEAKERS,resume,terminate} from './model.mjs';
import {PROFILES,simulate} from './simulation.mjs';
import {STORAGE_KEY,newSession,prepare,record,restore} from './session.mjs';

const $=id=>document.getElementById(id);
const reportNames={COMPLETED:'正常完成',INSUFFICIENT:'证据不足',ABNORMAL:'异常终止'};
let session=newSession(),timer,phase='ready',answerStart=0,runs=[],otherTab=false;
function save(next) {
  session=next;
  try {
    localStorage.setItem(STORAGE_KEY,JSON.stringify(session));
    $('storage').textContent='进度已保存在此浏览器。';
  } catch {
    $('storage').textContent='此浏览器无法保存进度。请在关闭前下载记录。';
  }
}
try {
  const previous=localStorage.getItem(STORAGE_KEY);
  if(previous) {
    const interrupted=Boolean(JSON.parse(previous).task);
    save(restore(previous));
    $('feedback').textContent=interrupted?'已恢复进度。中断订单已记为排除试次。':'已恢复进度。';
  } else save(session);
} catch {
  $('storage').textContent='存档无法读取。可开始新测评并下载本次记录。';
}
window.addEventListener('storage',event=>{
  if(event.key!==STORAGE_KEY) return;
  otherTab=true;
  clearTimeout(timer);
  $('storage').textContent='另一个标签页已更新进度，请刷新后继续。';
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
function reportText(r) {
  if(!r) return '';
  if(r.recommendedSize===null) return reportNames[r.status]+'。'+r.reasons.join('；')+
    (r.deferred.length?'。保留第 '+r.deferred.map(x=>x.trial).join('、')+' 轮。':'。');
  const e=r.evidence;
  return '正常完成。建议继续试做 '+r.recommendedSize+' 道菜。证据为第 '+e.trials.join('、')+
    ' 轮，'+e.correct+'/'+e.trials.length+' 完整正确。'+
    (r.deferred.length?'收尾第 '+r.deferred.map(x=>x.trial).join('、')+' 轮已保留，未纳入。':'')+
    (r.suggestedProbe?'规则另提出试做 '+r.suggestedProbe+' 道菜。':'')+
    (e.correct<=RULES.down&&e.size===RULES.min?'已达下限，当前表现仍困难，需人工复核任务适宜性。':'');
}
function paint() {
  const {state:s,task}=session;
  const done=s.report!==null,answering=phase==='answer'&&task&&!otherTab;
  $('chapters').replaceChildren(...CHAPTERS.map((name,i)=>{
    const card=document.createElement('div'),level=i+1;
    if(s.level===level) card.setAttribute('aria-current','step');
    card.textContent='L'+level+' '+name+' · '+(s.level===null||s.level>level?'完成':s.level===level?'当前':'待解锁');
    return card;
  }));
  $('order').textContent=done?'本次测评结束':SPEAKERS[s.level-1]+'点单 · '+s.size+' 道菜';
  $('progress').textContent='关内提交 '+s.submittedInLevel+' / '+RULES.storyQuota+' · 全程有效 '+s.valid+' / '+RULES.minValid+
    ' · 本组有效 '+s.openGroup.length+' / '+RULES.window;
  $('begin').disabled=Boolean(task)||s.paused||done||otherTab;
  $('resume').hidden=!s.paused||otherTab;
  $('abort').hidden=$('fault').hidden=!task||otherTab;
  $('undo').hidden=$('submit').hidden=$('hint').hidden=!answering;
  $('undo').disabled=$('submit').disabled=!task?.answer.length;
  $('submit').textContent=task&&task.answer.length<s.size?'提交当前顺序（未选满）':'提交便当';
  $('end').disabled=done||otherTab;
  $('reset').disabled=otherTab;
  $('report').hidden=!done;
  $('report').textContent=reportText(s.report);
  $('answer').textContent=answering?'已选：'+(task.answer.join(' → ')||'—'):'';
  $('choices').replaceChildren();
  if(answering) for(const dish of task.choices) {
    const button=document.createElement('button');
    button.textContent=dish;
    button.disabled=task.answer.includes(dish);
    button.onclick=()=>editTask('SELECT',dish);
    $('choices').append(button);
  }
  $('gameLog').replaceChildren(log(s.trials));
}
function editTask(action,dish=null) {
  const task=session.task;
  const answer=action==='SELECT'?[...task.answer,dish]:action==='UNDO'?task.answer.slice(0,-1):task.answer;
  const event={action,dish:action==='UNDO'?task.answer.at(-1):dish,atMs:Math.round(performance.now()-answerStart)};
  save({...session,task:{...task,answer,hinted:task.hinted||action==='HINT',events:[...task.events,event]}});
  paint();
}
function present(index) {
  const {target}=session.task;
  if(index===target.length) {
    $('stage').textContent='记住顺序…';
    timer=setTimeout(()=>{
      phase='answer';answerStart=performance.now();
      $('stage').textContent='请按原顺序选择菜品';paint();$('choices').querySelector('button')?.focus();
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
  if(!session.task||otherTab) return;
  clearTimeout(timer);
  const elapsed=phase==='answer'?Math.round(performance.now()-answerStart):null;
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
$('begin').onclick=()=>{save(prepare(session));phase='show';$('feedback').textContent='';paint();present(0);};
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
$('reset').onclick=()=>{
  if(session.state.trials.length||session.task||session.state.report) {
    if(!window.confirm('开始新测评会替换现有存档。确定开始？')) return;
  }
  clearTimeout(timer);phase='ready';save(newSession());
  $('feedback').textContent='';$('stage').textContent='准备好后开始订单';paint();
};
$('export').onclick=()=>download('old-master-mvp-play.json',{rules:RULES,...session,metrics:stats(session.state)});
function view(isGame) {
  $('game').hidden=!isGame;$('simulation').hidden=isGame;
  $('gameView').setAttribute('aria-pressed',String(isGame));$('simView').setAttribute('aria-pressed',String(!isGame));
}
$('gameView').onclick=()=>view(true);$('simView').onclick=()=>view(false);
function showTrajectory(s) {
  const el=document.createElement('div');
  const position=(i,n)=>[40+i*660/Math.max(1,s.trials.length-1),112-30*(n-2)];
  const guides=[2,3,4,5].map(n=>{
    const [,y]=position(0,n);
    return '<text x="6" y="'+(y+4)+'" fill="#43605a">'+n+'</text><path d="M40 '+y+'H700" stroke="#d7e1d6"/>';
  }).join('');
  const points=s.trials.map((r,i)=>position(i,r.size).join(',')).join(' ');
  el.innerHTML='<svg viewBox="0 0 720 146" width="100%" role="img" aria-label="横轴为试次轮次、纵轴为实际菜数">'+
    guides+'<polyline points="'+points+'" fill="none" stroke="#19594b" stroke-width="3"/>'+
    '<text x="340" y="139" fill="#43605a">试次轮次</text></svg>';
  return el;
}
function showSimulation() {
  const s=runs[Number($('inspect').value)];
  $('simLog').replaceChildren(showTrajectory(s),log(s.trials));
}
$('simulate').onclick=()=>{
  try {runs=PROFILES.map((_,i)=>simulate(i,$('seed').valueAsNumber));}
  catch {$('simStatus').textContent='请输入 0 至 4294967295 的整数种子。';return;}
  $('simStatus').textContent='本次使用种子 '+$('seed').valueAsNumber;
  $('simExport').disabled=false;
  $('simExport').onclick=()=>{
    download('old-master-mvp-simulation.json',{rules:RULES,seed:runsSeed,profiles:PROFILES.map((p,i)=>({profile:p,...runs[i],metrics:stats(runs[i])}))});
  };
  const runsSeed=$('seed').valueAsNumber;
  $('simResults').replaceChildren(table(['画像','尝试','完整正确／有效','实升／实降','触及下限保持','结果'],runs.map((s,i)=>{
    const m=stats(s);
    return [PROFILES[i].name,m.attempts,m.exact+'/'+m.valid,m.up+'/'+m.down,m.floorHolds,reportNames[s.report.status]+
      (s.report.recommendedSize?' · '+s.report.recommendedSize+' 道':'')];
  })));
  $('inspect').replaceChildren(...PROFILES.map((p,i)=>new Option(p.name,String(i))));
  $('inspectLabel').hidden=false;showSimulation();
};
$('inspect').onchange=showSimulation;
paint();

