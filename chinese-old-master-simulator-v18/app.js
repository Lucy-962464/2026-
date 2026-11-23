const $=id=>document.getElementById(id);
const keys=['quota','minValid','minRecentGroups','extraLimit','pauseAfter'];
const labels=['每关最低剧情提交配额','全程最低有效试次数','最近调难后最低完整组数','配额后额外轮次上限','连续排除暂停阈值'];
const clone=value=>JSON.parse(JSON.stringify(value));
let config=clone(defaults), current=start(config), rows=[], runEvents=[], activePerformance=null;
const storyLabel=level=>level===null?'已完成':'L'+level;
const excludedLabels={ABORTED:'主动中止',HINTED_SUBMISSION:'提示后提交',TECHNICAL_ISSUE:'设备或操作异常',INVALID_INPUT:'非法操作或输入'};
const stat=(label,value)=>'<div class="stat">'+label+'<b>'+value+'</b></div>';
function populate(c) {
  $('parameters').innerHTML=keys.map((key,i)=>'<label>'+labels[i]+'<input type="number" step="1" required id="p_'+key+'" value="'+c[key]+'"></label>').join('');
}
function paint() {
  const mode=$('mode').value, finished=current.gameCompleted;
  const ended=Boolean(current.assessment);
  const probability=mode==='probability';
  const blocked=ended||current.paused||(probability&&!activePerformance);
  $('auto').hidden=mode==='manual';
  // The toolbar's display rule is also used for ordinary flex rows.
  $('auto').style.display=$('auto').hidden?'none':'';
  $('manual').hidden=mode!=='manual';
  $('profile').hidden=$('auto').hidden;
  $('probControls').hidden=!probability;
  $('performanceLabel').hidden=false;
  $('performanceLabel').textContent=mode==='manual'?'手动录入':activePerformance?
    '概率模拟 · 已生效种子 '+activePerformance.seed+(activePerformance.temporal?' · 含时间波动':''):
    probability?'概率模拟 · 等待有效参数':'基准脚本 · 种子不参与';
  const storyProgress=finished?'L4 已完成':storyLabel(current.level)+' 已累计 '+current.done+' 次合法剧情提交 / 最低 '+config.quota+' 次';
  $('quotaProgress').textContent=storyProgress+' · 全程证据 '+current.validTotal+' 次有效 / 最低 '+config.minValid+' 次'+
    (current.paused?' · 测验已暂停':'');
  const finalSettled=finished&&rows.at(-1)?.result.evidenceStatus==='SETTLED';
  $('evidenceProgress').textContent=(finished?'收尾证据组 ':'当前证据组 ')+(finalSettled?config.window:current.v)+' / '+config.window+
    ' 次有效 · 最近调难后完整组 '+current.groupsAtSize+' / '+config.minRecentGroups+' 组';
  $('story').innerHTML=titles.map((title,i)=>'<div class="chapter"'+(current.level===i+1?' aria-current="step"':'')+'><small>L'+(i+1)+' · '+
    (finished||current.level>i+1?'已完成':current.level===i+1?'当前':'未解锁')+'</small><strong>'+title+'</strong></div>').join('');
  const latest=rows.at(-1)?.result;
  $('state').innerHTML=stat('当前剧情关',storyLabel(current.level))+stat('下一轮实际难度',ended?'已结束':current.n+' 道菜')+
    stat('累计有效试次',rows.filter(row=>row.result.valid).length)+
    stat('最近证据组',latest?latest.k+' 正确 / '+latest.v+' 有效':'待记录')+
    stat(ended?'测评结论':'最近决策',ended?assessmentLabels[current.assessment.status]:latest?decisions[latest.decision]:'待记录');
  for(const id of ['single','all','record']) $(id).disabled=blocked;
  $('resume').hidden=!current.paused;
  $('endControls').hidden=ended;
  $('rateHelp').textContent=ended?'测评已结束。':'当前 '+current.n+' 道菜。提交完成率可填 '+allowedRates(current.n,1)+
    '；位置正确率可填 '+allowedRates(current.n)+'。接受按菜数分数四舍五入到整数或两位小数。';
  const counts=rows.reduce((a,{result})=>{
    a.valid+=+result.valid;
    a[result.decision]=(a[result.decision]||0)+1;
    return a;
  },{valid:0});
  const exact=rows.filter(({result})=>result.valid&&result.exact).length;
  $('summary').textContent=rows.length+' 轮 · '+counts.valid+' 有效 · '+(rows.length-counts.valid)+' 排除 · '+
    '完整序列正确率 '+(counts.valid?Math.round(100*exact/counts.valid)+'%（'+exact+'/'+counts.valid+'）':'—')+' · '+
    (counts.UP||0)+' 升级 · '+(counts.DOWN||0)+' 降级 · '+holdCounts(counts);
  $('export').disabled=!rows.length&&!ended;
  paintReport();
}
function paintReport() {
  const a=current.assessment;
  $('assessmentReport').hidden=!a;
  if(!a) return;
  const metrics=summarize(config,rows);
  const reason=a.reasons.map(code=>evidenceReasons[code]??terminationReasons[code]).join('；');
  const posteriorReport=a.modelEvidence?bayesianReport(a.modelEvidence,true):null;
  const recommendation=a.status==='COMPLETED'?'模拟推荐菜数 '+a.recommendedSize+' 道。':
    a.status==='ABNORMAL_TERMINATION'?'本次测评提前结束，暂不发布正式推荐。':'剧情已结束，暂不发布正式推荐。';
  $('assessmentReport').innerHTML='<h2>最终测评报告 · '+assessmentLabels[a.status]+'</h2><p>'+recommendation+'</p>'+
    (reason?'<p>'+reason+'。</p>':'')+
    '<dl><dt>最低有效试次配额</dt><dd>'+metrics.validTrials+' / '+config.minValid+'（'+(metrics.validTrials>=config.minValid?'已达到':'未达到')+'）</dd>'+
    '<dt>收尾证据窗口</dt><dd>'+((rows.at(-1)?.result.evidenceStatus==='SETTLED'&&current.gameCompleted)?config.window:current.v)+
    ' / '+config.window+(a.deferred?.trials.length?'（未满组，保留但不纳入最终判断）':'')+'</dd>'+
    '<dt>最近调难后完整证据组</dt><dd>'+current.groupsAtSize+' / '+config.minRecentGroups+
    (current.lastAdjustmentTrial===null?'（从起始难度累计）':'（最近调难为第 '+current.lastAdjustmentTrial+' 轮后）')+'</dd></dl>'+
    (a.basis?'<p>通过收尾门槛的证据组：'+a.basis.size+' 道菜，第 '+a.basis.trials.join('、')+' 轮，'+a.basis.correct+'/'+config.window+' 完整正确。</p>':'')+
    (a.deferred?.trials.length?'<p>暂缓纳入：第 '+a.deferred.trials.join('、')+' 轮。</p>':'')+
    (a.suggestedProbeSize?'<p>规则另建议后续试做 '+a.suggestedProbeSize+' 道菜。该建议尚无同难度完整组证据。</p>':'')+
    '<p>合法剧情提交 '+rows.filter(row=>row.result.submitted).length+' 次 · 全程完整正确率 '+percent(metrics.fullSequenceAccuracy)+'。</p>'+
    (posteriorReport?'<h3>收尾时的四档证据</h3>'+renderBayesian(posteriorReport,null,true,a.recommendedSize):'')+
    '<p class="muted">本报告仅解释任务表现，阈值仍需预测试。</p>';
}
function reset(message='') {
  current=start(config);rows=[];runEvents=[];
  $('log').replaceChildren();
  updateTrajectory();
  $('message').textContent=message;
  paint();
}
function describeRow(c,{i,s,input,result}, detail={}) {
  return {i,s,input,result,submissionCompletionRate:result.submitted?input.items/s.n:null,
    positionAccuracy:result.submitted?input.hits/s.n:null,
    fullSequenceCorrect:result.submitted?result.exact:null,
    timedOut:result.timedOut,responseMs:detail.responseMs??null,undos:detail.undos??null,
    posteriorAfterTrial:posterior(result.next.bank[s.n-2],true),
    reason:reasonFor(c,{input,result}),...detail};
}
function append(input,detail={}) {
  const s=current, i=rows.length+1, result=step(config,s,input);
  const percent=num=>(100*num/s.n).toFixed(0)+'%';
  rows.push(describeRow(config,{i,s,input,result},detail));
  current=result.next;
  const cells=[i,storyLabel(s.level),s.n,input.status,result.valid?'是':'否',excludedLabels[result.exclusionReason]??'—',
    result.submitted?'是':'否',result.submitted?percent(input.items):'—',
    result.submitted?percent(input.hits):'—',result.submitted?+result.exact:'—',result.v+' / '+result.k,
    decisions[result.decision],result.candidate,storyLabel(current.level)+(current.n?' / '+current.n:''),detail.undos??'—',detail.responseMs??'—',current.xp,result.stars];
  const row=document.createElement('tr');
  for(const value of cells) {const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
  $('log').prepend(row);
  const progress=result.gameCompleted?'剧情已完成 · 测评'+assessmentLabels[current.assessment.status]:result.advance?'已解锁 L'+current.level:
    result.quotaReached?'已达到最低提交配额，正在等待当前证据组结算。':'';
  const pause=result.pauseReason?'连续 '+current.excludedStreak+' 轮未计入自适应证据，测验已暂停。记录已保留。':'';
  $('message').textContent=[decisions[result.decision],progress,pause].filter(Boolean).join(' · ');
}
function auto() { append(synthetic(Number($('profile').value),rows.length+1,current.n,activePerformance)); }
function refresh() {paint();updateTrajectory();}
$('single').onclick=()=>{auto();refresh();};
$('all').onclick=()=>{while(!current.assessment&&!current.paused) auto();refresh();};
$('resume').onclick=()=>{
  if(!current.paused) return;
  runEvents.push({event:'RESUMED',afterTrial:rows.length,level:current.level});
  current=resume(current);
  $('message').textContent='测验已继续。接续原进度和证据组。';
  refresh();
};
$('reset').onclick=()=>reset('已从 L1 重新开始。');
$('terminate').onclick=()=>{
  if(current.assessment) return;
  const reason=$('terminationReason').value;
  const ended=terminate(current,reason);
  if(ended===current) return;
  runEvents.push({event:'TERMINATED',reason,afterTrial:rows.length,level:current.level});
  current=ended;
  $('message').textContent='测评已提前终止，记录已保留。';
  refresh();
};
function applyConsoleSettings(runAll=false) {
  const useProbability=$('mode').value==='probability';
  activePerformance=useProbability?readPerformance(Number($('profile').value),$('consoleSeed').valueAsNumber):null;
  reset(useProbability&&!activePerformance?'请检查种子和各菜数的概率设置。':'');
  if(runAll&&activePerformance) $('all').click();
}
$('mode').onchange=()=>applyConsoleSettings();
$('profile').onchange=()=>applyConsoleSettings();
$('applySeed').onclick=()=>applyConsoleSettings(true);
$('editRates').onclick=()=>{
  const enable=$('custom'+$('profile').value);
  enable.checked=true;enable.onchange();
  showView(true);
};
$('parameterForm').onsubmit=event=>{
  event.preventDefault();
  const edit={...defaults,...Object.fromEntries(keys.map(key=>[key,$('p_'+key).valueAsNumber]))};
  if(!validConfig(edit)) {
    $('paramMessage').textContent='请输入允许范围内的整数。每关最低配额 1–16，全程最低有效 1–120，收尾完整组 1–5，额外轮次 0–30，暂停阈值 2–12。';
    return;
  }
  config=edit;
  $('paramMessage').textContent='已应用。';
  reset();
  invalidateComparison();
};
$('restore').onclick=()=>{populate(defaults);$('paramMessage').textContent='默认值已填入。点击「应用并重置」生效。';};
$('record').onclick=()=>{
  const status=$('status').value, undos=$('undos').valueAsNumber;
  const counts=['SUBMIT','HINT','TIMEOUT'].includes(status);
  const ms=$('responseMs').value===''?null:$('responseMs').valueAsNumber;
  if(!integer(undos,0,Number.MAX_SAFE_INTEGER)){$('message').textContent='撤销次数须为非负整数。';return;}
  if(ms!==null&&!integer(ms,0,Number.MAX_SAFE_INTEGER)){$('message').textContent='作答毫秒须为非负整数。';return;}
  const completion=$('items').valueAsNumber, accuracy=$('hits').valueAsNumber;
  const parsed=counts?validateRates(current.n,completion,accuracy):{items:null,hits:null,error:null};
  append({status,items:parsed.items,hits:parsed.hits,validationError:parsed.error},
    {undos,responseMs:ms,enteredPercentages:counts?{submissionCompletion:completion,positionAccuracy:accuracy}:null});
  if(parsed.error) $('message').textContent+=' '+parsed.error;
  else if(counts&&status==='SUBMIT'&&!rows.at(-1).result.exact) $('message').textContent+=' 有效提交，序列未完全正确。';
  else if(status==='TIMEOUT') $('message').textContent+=' 超时按有效错误计。';
  refresh();
};
function downloadJSON(data,name) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');
  a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('export').onclick=()=>{
  const mode=$('mode').value;
  const data={version:VERSION,parameterVersion:VERSION,mode,profile:mode==='manual'?null:profiles[Number($('profile').value)],
    simulationMode:simulationMode(activePerformance,mode),...randomMetadata(activePerformance),performance:activePerformance,
    config,bayesParameters:BAYES,recommendationRule:RECOMMENDATION_RULE,pool,metrics:summarize(config,rows),
    taskProfile:bayesianReport(current.bank,true),
    finalModel:current.assessment?.modelEvidence?bayesianReport(current.assessment.modelEvidence,true):null,
    state:current,runEvents,rows};
  downloadJSON(data,'old-master-'+mode+'-trials.json');
};
function reasonFor(c,{input,result:r}) {
  switch(r.decision) {
    case 'UP': return c.policy==='bayes'?'窗口升级后验概率达到 75%，建议增加一道菜。':'完整正确数达到升级阈值，建议增加一道菜。';
    case 'DOWN': return c.policy==='bayes'?'窗口降级后验概率达到 75%，建议减少一道菜。':'完整正确数达到降级阈值，建议减少一道菜。';
    case 'MAX': return '达到升级阈值，当前菜数已是全局上限。';
    case 'MIN': return '达到降级条件，当前菜数已是全局下限。';
    case 'HOLD': return c.policy==='bayes'?'窗口的两个后验决策门槛均未达到，保持菜数。':'完整正确数位于两个阈值之间，保持菜数。';
    case 'COOLDOWN': return '证据满足'+(r.proposedDecision==='UP'?'升级':'降级')+'条件，但本组暂缓反向调整（实验冷却）。';
    case 'FINAL_PRIOR_EVIDENCE': return '收尾未满组保留。符合收尾证据门槛后，进行跨档目标匹配。';
    case 'FINAL_INSUFFICIENT': return '剧情已结束；最低有效试次数或最近调难后的完整组要求未满足。';
    case 'COLLECT': return '本组累计 '+r.v+' / '+c.window+' 次有效试次。'+
      (r.evidenceStatus==='INCOMPLETE_AT_CHAPTER_CAP'?'已达额外轮次上限，此组未作升降判断。':
        r.gameCompleted?'剧情结束，证据未满，此组未作升降判断。':'继续收集证据。');
    default:
      if(input.status==='ABORT') return '本轮中止，剧情与有效证据均不累计。';
      if(input.status==='TECH') return '设备或操作异常，剧情与有效证据均不累计。';
      if(r.submitted) return '本轮在提示后提交，仅计入剧情配额。';
      return input.validationError??'输入与当前菜数不符，或提交项目不足。';
  }
}
const marks={
  UP:['▲','#147449'], DOWN:['▼','#a54a26'], HOLD:['■','#37597b'],
  MAX:['◇','#705287'], MIN:['◆','#9a5136'], COOLDOWN:['△','#705287'], COLLECT:['○','#326752'], INVALID:['×','#a54a26'],
  FINAL_PRIOR_EVIDENCE:['◎','#19594b'], FINAL_INSUFFICIENT:['!','#a54a26']
};
function chart(series,maxTrial,interactive=false) {
  if(!series.length) return '<p class="muted">运行首轮后显示实际菜数与决策。</p>';
  const x=i=>55+(i-1)*632/Math.max(1,maxTrial-1);
  const y=n=>192-(n-2)*48;
  const ticks=[...new Set([1,...Array.from({length:Math.floor(maxTrial/5)},(_,i)=>(i+1)*5),maxTrial])];
  const grid=[2,3,4,5].map(n=>'<path d="M55 '+y(n)+'H687" stroke="#d7e1d6"/><text x="44" y="'+(y(n)+4)+'" text-anchor="end">'+n+' 道</text>').join('');
  const chapterStarts=series.filter((row,j)=>!j||row.s.level!==series[j-1].s.level);
  const chapters=chapterStarts.map(({i,s})=>'<path d="M'+x(i)+' 28V199" stroke="#899f93" stroke-dasharray="4 4"/><text x="'+(x(i)+3)+'" y="20">L'+s.level+'</text>').join('');
  const line=series.map(({i,s})=>x(i)+','+y(s.n)).join(' ');
  const points=series.map(({i,s,result})=>{
    const [symbol,color]=marks[result.decision], title='第 '+i+' 轮 · L'+s.level+' · '+s.n+' 道菜 · '+decisions[result.decision];
    return '<g '+(interactive?'data-trial="'+i+'" style="cursor:pointer"':'')+'><title>'+title+'</title>'+
      '<circle cx="'+x(i)+'" cy="'+y(s.n)+'" r="9" fill="transparent"/>'+
      '<circle cx="'+x(i)+'" cy="'+y(s.n)+'" r="2" fill="'+color+'"/>'+
      '<text x="'+x(i)+'" y="'+(y(s.n)-7)+'" text-anchor="middle" style="fill:'+color+';font-weight:700">'+symbol+'</text></g>';
  }).join('');
  const axis=ticks.map(i=>'<text x="'+x(i)+'" y="218" text-anchor="middle">'+i+'</text>').join('');
  return '<svg viewBox="0 0 720 249" role="img" aria-label="难度轨迹，横轴为试次，纵轴为菜数">'+grid+chapters+
    '<polyline points="'+line+'" fill="none" stroke="#3a7964" stroke-width="3" stroke-linejoin="round"/>'+
    points+axis+'<text x="380" y="240" text-anchor="middle">试次轮次</text></svg>';
}
function performanceChart(series,horizon) {
  if(!series.length) return '<p class="muted">运行首轮后显示表现。</p>';
  const x=i=>55+(i-1)*632/Math.max(1,horizon-1);
  const y=p=>143-100*p;
  const rates=[],recent=[];
  const grid=[0,.5,1].map(p=>'<path d="M55 '+y(p)+'H687" stroke="#d7e1d6"/><text x="46" y="'+(y(p)+4)+'" text-anchor="end">'+(100*p)+'%</text>').join('');
  const points=series.map(({i,input,result:r})=>{
    if(r.valid) {
      recent.push(Number(r.exact));
      if(recent.length>5) recent.shift();
      if(recent.length===5) rates.push(x(i)+','+y(recent.reduce((sum,k)=>sum+k,0)/5));
    }
    const symbol=r.valid?(r.exact?'✓':'×'):'◇';
    const color=r.valid&&r.exact?'#147449':'#a54a26';
    const evidence=r.evidenceStatus==='SETTLED'?'<text x="'+x(i)+'" y="21" text-anchor="middle">'+r.k+'/'+r.v+'</text>':'';
    const tooltip='第 '+i+' 轮 · '+(r.valid?(r.exact?'完整正确':'有效但错误'):'排除')+
      ' · 本组 '+r.k+'/'+r.v+(input.probability===null||input.probability===undefined?'':' · 输入概率 '+Math.round(100*input.probability)+'%');
    return '<g data-trial="'+i+'" style="cursor:pointer"><title>'+tooltip+'</title>'+evidence+
      '<text x="'+x(i)+'" y="164" text-anchor="middle" style="fill:'+color+'">'+symbol+'</text></g>';
  }).join('');
  const ticks=[...new Set([1,...Array.from({length:Math.floor(horizon/5)},(_,i)=>(i+1)*5),series.length])];
  const axis=ticks.map(i=>'<text x="'+x(i)+'" y="188" text-anchor="middle">'+i+'</text>').join('');
  const dots=rates.map(point=>{const [cx,cy]=point.split(',');return '<circle cx="'+cx+'" cy="'+cy+'" r="2" fill="#19594b"/>';}).join('');
  return '<svg viewBox="0 0 720 213" role="img" aria-label="逐轮对错、最近五次有效试次正确率和证据组">'+grid+
    '<polyline points="'+rates.join(' ')+'" fill="none" stroke="#19594b" stroke-width="3"/>'+dots+
    points+axis+'<text x="380" y="207" text-anchor="middle">试次轮次</text></svg>';
}
function explain() {
  const row=rows[Number($('decisionTrial').value)-1];
  $('estimateCaption').textContent=row?'第 '+row.i+' 轮后的累计证据。误差线表示 95% 等尾可信区间。':
    '运行后可按试次查看累计证据。每档累计 3 次有效试次后显示初步估计。';
  const nextState=row?.result.next??current;
  $('bayesProfile').innerHTML=renderBayesian(bayesianReport(nextState.bank,true),nextState.n);
  if(!row) {$('explanation').textContent='等待首轮数据。';return;}
  const {i,s,result:r}=row;
  const evidence=r.evidenceTrials.map(trial=>rows[trial-1]);
  const detail=evidence.map(x=>'第 '+x.i+' 轮 '+(x.result.exact?'✓':'×')).join('、');
  const next=r.gameCompleted?'剧情已完成 · '+assessmentLabels[r.next.assessment.status]:'L'+r.next.level+' · '+r.next.n+' 道菜';
  $('explanation').innerHTML='<strong>'+decisions[r.decision]+'</strong><dl>'+
    '<dt>本组证据</dt><dd>'+r.v+' / '+config.window+' 次有效，'+r.k+' 次完整正确'+(detail?'<br>'+detail:'')+'</dd>'+
    '<dt>本轮任务</dt><dd>L'+s.level+' · '+s.n+' 道菜</dd>'+
    (r.probabilityEvidence?'<dt>窗口后验</dt><dd>Beta('+r.probabilityEvidence.alpha+','+r.probabilityEvidence.beta+
      ') · 升 '+r.probabilityEvidence.upgrade.toFixed(4)+' · 降 '+r.probabilityEvidence.downgrade.toFixed(4)+'</dd>':'')+
    '<dt>本关建议</dt><dd>'+r.candidate+' 道菜</dd><dt>实际下一轮</dt><dd>'+next+'</dd></dl><p>'+row.reason+'</p>'+
    (r.advance?(r.evidenceStatus==='INCOMPLETE_AT_CHAPTER_CAP'?'<p class="muted">额外轮次达上限。未满组证据已记入日志，下一关沿用当前菜数。</p>':
      '<p class="muted">达到最低提交配额，证据组已结算或为空。下一关沿用本轮决策后的菜数。</p>'):
      r.gameCompleted?'<p class="muted">L4 达到最低提交配额。'+(r.evidenceStatus==='INCOMPLETE_AT_END'?'证据未满组，已保留轮次与计数。':'')+'</p>':
      r.quotaReached?'<p class="muted">已达到最低提交配额，正在等待当前证据组结算。</p>':'')+
    (r.pauseReason?'<p class="muted">此轮后因连续排除试次暂停。</p>':'');
}
function renderBayesian(report,nextSize,final=false,officialSize=null) {
  const y=p=>156-128*p, x=n=>70+130*(n-2);
  const range='<rect x="70" y="'+y(BAYES.upper)+'" width="390" height="'+(y(BAYES.lower)-y(BAYES.upper))+'" fill="#e6f2e9"/>';
  const ticks=[0,.5,1].map(p=>'<text x="9" y="'+(y(p)+4)+'">'+percent(p)+'</text><path d="M70 '+y(p)+'H460" stroke="#d7e1d6"/>').join('');
  const marks=report.curve.map((row,i)=>{
    const n=row.size, px=x(n);
    const axis='<text x="'+px+'" y="185" text-anchor="middle">'+n+' 道</text>';
    if(!row.interval95) return axis;
    const [lower,upper]=row.interval95, lo=y(lower),hi=y(upper);
    const next=report.curve[i+1];
    const line=next?.interval95?'<path d="M'+px+' '+y(row.mean)+' L'+x(next.size)+' '+y(next.mean)+'" stroke="#2c7b63" stroke-width="2"/>':'';
    return axis+line+'<path d="M'+px+' '+hi+'V'+lo+' M'+(px-5)+' '+hi+'h10 M'+(px-5)+' '+lo+'h10" stroke="#174c40" stroke-width="2"/>'+
      '<circle cx="'+px+'" cy="'+y(row.mean)+'" r="4" fill="#174c40"/>';
  }).join('');
  const nearest=report.nearest,preview=report.recommendation;
  const sizeLabel=n=>n===null?'未发布':n+' 道菜';
  const match=final?sizeLabel(officialSize):preview?sizeLabel(preview.size)+'（预览）':'暂无匹配';
  const breakdown='<div class="recommendation-stats">'+
    stat('当前可支持最高难度',report.supportedSize===null?'证据不足':sizeLabel(report.supportedSize))+
    stat(final?'目标匹配推荐难度（正式）':'目标匹配推荐难度',match)+
    stat('下一轮实际难度',nextSize===null?'已结束':sizeLabel(nextSize))+'</div>';
  const detail=preview?'目标匹配档估计成功率 '+percent(preview.mean)+'。':
    evidenceReasons[report.status]+'。'+(nearest?' 达标档中最接近目标的是 '+nearest.size+' 道菜，估计 '+percent(nearest.mean)+'。':'');
  const {lowProbability,highProbability}=report.boundary;
  const boundaries=lowProbability===null&&highProbability===null?'':'<p class="muted">边界证据'+
    (lowProbability===null?'':' · 2 道菜成功率低于 60% 的后验概率 '+percent(lowProbability))+
    (highProbability===null?'':' · 5 道菜成功率高于 80% 的后验概率 '+percent(highProbability))+'。</p>';
  const help='<p class="muted">初步估计需 3 次有效试次。正式候选每档至少 '+RECOMMENDATION_RULE.minTrials+
    ' 次有效，且 95% 可信区间全宽不超过 '+Math.round(100*RECOMMENDATION_RULE.maxWidth)+' 个百分点。目标匹配仅比较达标档。'+
    (final?'':' 正式推荐在剧情结束后按收尾证据发布。')+'</p>';
  const labels={UNTESTED:'未测试',OBSERVING:'记录中（不足 3 次）',PRELIMINARY:'初步估计',CANDIDATE:'推荐候选'};
  return breakdown+'<p class="decision-box">'+detail+'</p>'+boundaries+help+
    '<div class="chart"><svg viewBox="0 0 510 198" role="img" aria-label="四档后验均值、95% 可信区间和 60–80% 目标带">'+
    range+ticks+'<path d="M70 '+y(BAYES.target)+'H460" stroke="#67917f" stroke-dasharray="5 5"/>'+marks+'</svg></div>'+
    studyTable(['难度','完整正确／有效','后验分布','成功率估计','95% 可信区间','区间全宽（百分点）','P(p≥60%)','证据状态'],report.curve.map(row=>[
      row.size+' 道',row.correct+'/'+row.total,row.interval95?'Beta('+row.alpha+','+row.beta+')':'—',
      percent(row.interval95?row.mean:null),row.interval95?row.interval95.map(percent).join('–'):'—',points(row.intervalWidth),
      percent(row.interval95?row.support:null),labels[row.evidence]]));
}
function updateTrajectory() {
  $('trajectory').innerHTML=chart(rows,Math.max(8,rows.length),true);
  $('performanceChart').innerHTML=performanceChart(rows,Math.max(8,rows.length));
  $('decisionTrial').innerHTML=rows.length?rows.map(({i})=>'<option value="'+i+'">第 '+i+' 轮</option>').join(''):'<option>暂无试次</option>';
  $('decisionTrial').disabled=!rows.length;
  if(rows.length) $('decisionTrial').value=String(rows.length);
  explain();
}
$('decisionTrial').onchange=explain;
function selectChartTrial(event){
  const point=event.target.closest('[data-trial]');
  if(point) {$('decisionTrial').value=point.dataset.trial;explain();}
}
$('trajectory').onclick=selectChartTrial;
$('performanceChart').onclick=selectChartTrial;
const profileTargets=['观察是否逐步接受更高挑战','观察高难度受挫后能否回到较适宜的菜数','观察是否降低难度，以及何时触及全局下限','观察分组判断是否避免单次失误触发调整'];
function simulationMode(performance,mode) {
  if(mode==='manual') return mode;
  return performance?'seeded_probability':'baseline_script';
}
function randomMetadata(p) {
  return {seed:p?.seed??null,rngVersion:p?RNG_VERSION:null};
}
function readPerformance(i,seed) {
  const rates=defaultRates[i].map((_,j)=>$('rate'+i+'_'+j).valueAsNumber);
  if(!integer(seed,0,4294967295)||rates.some(p=>!Number.isFinite(p)||p<0||p>100)) return null;
  return {seed,rates,temporal:i===3&&$('temporal').checked};
}
function holdCounts(counts) {
  return (counts.HOLD||0)+' 普通保持 · '+(counts.MIN||0)+' 下限保持 · '+(counts.MAX||0)+' 上限保持'+
    (counts.COOLDOWN?' · '+counts.COOLDOWN+' 冷却保持':'');
}
let comparison=null;
let study=null;
function setupProfiles() {
  $('profiles').innerHTML=profiles.map((name,i)=>'<article class="profile"><h3>'+'ABCD'[i]+' · '+name+'</h3><p class="muted">'+profileTargets[i]+'</p>'+
    '<label><input type="checkbox" id="custom'+i+'" style="display:inline;min-height:auto"> 使用可编辑的完整正确概率</label><p class="muted" id="profileMode'+i+'">待运行模式：基准脚本。概率未启用。</p>'+
    (i===3?'<p id="temporalHint" class="muted">时间波动仅在概率模拟模式下生效。</p><label id="temporalOptions" hidden><input type="checkbox" id="temporal" checked disabled style="display:inline;min-height:auto"> 模拟随轮次波动</label>':'')+
    '<div class="profile-settings">'+defaultRates[i].map((rate,j)=>'<label>'+(j+2)+' 道 %<input type="number" min="0" max="100" step="any" id="rate'+i+'_'+j+'" value="'+rate+'" disabled></label>').join('')+'</div>'+
    '<div class="chart" id="compareChart'+i+'"></div>'+(i===3?'<h4>表现轨迹（滚动 5 次有效试次）</h4><div class="chart" id="comparePerformance"></div>':'')+
    '<p id="compareMetrics'+i+'" class="muted"></p><button id="inspect'+i+'" disabled>在控制台查看逐轮决策</button></article>').join('');
  profiles.forEach((_,i)=>{
    $('custom'+i).onchange=()=>{
      defaultRates[i].forEach((_,j)=>{$('rate'+i+'_'+j).disabled=!$('custom'+i).checked;});
      invalidateComparison();
    };
    defaultRates[i].forEach((_,j)=>{$('rate'+i+'_'+j).oninput=invalidateComparison;});
    $('inspect'+i).onclick=()=>{
      if(!comparison) return;
      activePerformance=comparison[i].performance;
      $('mode').value=activePerformance?'probability':'baseline';
      $('profile').value=String(i);
      if(activePerformance) $('consoleSeed').value=String(activePerformance.seed);
      reset(activePerformance?'使用该画像的自定义概率。':'使用该画像的基准脚本。');
      $('all').click();
      showView(false);
    };
  });
  $('temporal').onchange=invalidateComparison;
}
function invalidateComparison() {
  comparison=null;
  $('compareExport').disabled=true;
  $('compareStatus').textContent='运行四组画像后显示结果。';
  $('comparePerformance').innerHTML='';
  profiles.forEach((_,i)=>{
    const usingProbability=$('custom'+i).checked;
    if(i===3) {
      $('temporal').disabled=!usingProbability;
      $('temporalOptions').hidden=!usingProbability;
      $('temporalHint').hidden=usingProbability;
    }
    $('profileMode'+i).textContent=usingProbability?'待运行：概率模式'+(i===3&&$('temporal').checked?'＋时间波动':'')+'。':
      '待运行：基准脚本。概率、种子'+(i===3?'和时间波动':'')+'均未生效。';
    $('compareChart'+i).innerHTML='';
    $('compareMetrics'+i).textContent='';
    $('inspect'+i).disabled=true;
  });
}
function compare() {
  const seed=$('seed').valueAsNumber;
  const settings=profiles.map((_,i)=>$('custom'+i).checked?readPerformance(i,seed):null);
  if(settings.some((p,i)=>!p&&$('custom'+i).checked)) {
    $('compareStatus').textContent='种子须为 0–4294967295 的整数，概率须在 0–100% 之间。';
    return;
  }
  comparison=settings.map((performance,i)=>{
    const trials=run(config,i,performance).map(row=>describeRow(config,row));
    return {profile:profiles[i],simulationMode:simulationMode(performance),...randomMetadata(performance),performance,metrics:summarize(config,trials),rows:trials};
  });
  const horizon=Math.max(...comparison.map(x=>x.rows.length));
  comparison.forEach(({rows:trials,metrics:m},i)=>{
    $('compareChart'+i).innerHTML=chart(trials,horizon);
    const accuracy=m.fullSequenceAccuracy===null?'—':Math.round(m.fullSequenceAccuracy*100)+'%';
    const p=comparison[i].performance;
    $('profileMode'+i).textContent=p?'本次实际模式：概率模拟 · 种子 '+p.seed+(p.temporal?' · 时间波动已启用':''):'本次实际模式：基准脚本 · 种子未参与。';
    const a=trials.at(-1)?.result.next.assessment;
    const volatility=i===3?rollingVolatility(trials):null;
    $('compareMetrics'+i).textContent=(p?'概率模拟 · 种子 '+p.seed+(p.temporal?' · 含时间波动':''):'基准脚本')+' · '+m.validTrials+' 有效 · 完整正确率 '+accuracy+
      ' · '+m.appliedUp+' 实际升 / '+m.appliedDown+' 实际降 · '+holdCounts(m.decisions)+' · '+m.reversals+' 次反向（'+m.rapidReversals+' 次间隔 ≤ 3 个有效试次）'+
      (a?' · '+assessmentLabels[a.status]:'')+(volatility===null?'':' · 滚动 5 次有效试次正确率的标准差 '+(100*volatility).toFixed(1)+' 个百分点');
    $('inspect'+i).disabled=false;
  });
  $('comparePerformance').innerHTML=performanceChart(comparison[3].rows,horizon);
  $('compareExport').disabled=false;
  const completed=comparison.filter(p=>p.rows.at(-1)?.result.next.assessment?.status==='COMPLETED').length;
  $('compareStatus').textContent='四组均完成 L1–L4。测评正常完成 '+completed+' 组，证据不足 '+(comparison.length-completed)+' 组。实际升降只统计影响下一轮的调整。';
}
function showView(comparing) {
  $('consoleView').hidden=comparing;
  $('compareView').hidden=!comparing;
  $('consoleTab').setAttribute('aria-pressed',String(!comparing));
  $('compareTab').setAttribute('aria-pressed',String(comparing));
  if(comparing&&!comparison) compare();
}
$('consoleTab').onclick=()=>showView(false);
$('compareTab').onclick=()=>showView(true);
$('compareRun').onclick=compare;
$('seed').oninput=invalidateComparison;
$('compareReset').onclick=()=>{$('seed').value='42';setupProfiles();compare();};
$('compareExport').onclick=()=>{if(comparison) downloadJSON({version:VERSION,parameterVersion:VERSION,config,profiles:comparison},'old-master-profile-comparison.json');};
function studySettings() {
  const settings=profiles.map((_,i)=>{
    const p=readPerformance(i,541);
    return p?{...p,temporal:p.temporal&&$('custom'+i).checked}:null;
  });
  if(settings.some(p=>p===null)) $('studyResults').textContent='请将各菜数的完整正确概率填写为 0–100%。';
  return settings.some(p=>p===null)?null:settings;
}
const percent=value=>value===null?'—':(value*100).toFixed(1)+'%';
const num=value=>value===null?'—':value.toFixed(2);
const points=value=>value===null?'—':(100*value).toFixed(2);
function studyTable(headers,values) {
  return '<div class="scroll"><table><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+
    '</tr></thead><tbody>'+values.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function studyConfiguration(settings,seeds) {
  return '<p>概率模式 · 种子 '+seeds+' · 当前剧情最低提交 '+config.quota+' 次 / 关、全程最低有效 '+config.minValid+
    ' 次 · 最近调难后最低完整证据 '+config.minRecentGroups+' 组。</p>'+
    studyTable(['画像','2 道','3 道','4 道','5 道','时间波动'],settings.map((p,i)=>[
      'ABCD'[i],...p.rates.map(rate=>rate+'%'),p.temporal?'启用':'关闭']));
}
$('repeatRun').onclick=()=>{
  const settings=studySettings();
  if(!settings) return;
  const data=repeatSeed(config,settings);
  study={version:VERSION,parameterVersion:VERSION,rngVersion:RNG_VERSION,simulationMode:'seeded_probability',
    study:'seed_reproducibility',seed:541,config,profiles:data};
  const identical=value=>value?'完全一致':'存在差异';
  $('studyResults').innerHTML='<h3>种子 541 · 两次独立运行</h3>'+studyConfiguration(settings,'541 × 2')+
    studyTable(['画像','尝试轮数','逐轮结果','菜数轨迹','决策记录','最终状态','全部统计'],data.map((p,i)=>[
      'ABCD'[i]+' · '+p.profile,p.trials,...[p.trialResultsIdentical,p.difficultyIdentical,p.decisionsIdentical,p.assessmentIdentical,p.metricsIdentical].map(identical)
    ]));
  $('studyExport').disabled=false;
};
$('pairedRun').onclick=()=>{
  const settings=studySettings();
  if(!settings) return;
  const data=seedPairs(config,settings);
  study={version:VERSION,parameterVersion:VERSION,rngVersion:RNG_VERSION,simulationMode:'seeded_probability',
    study:'seed_comparison',config,profiles:data.map(p=>({...p,runs:p.runs.map(run=>({...run,rows:run.rows.map(row=>describeRow(config,row))}))}))};
  $('studyResults').innerHTML='<h3>概率模式 · 种子 541 与 542</h3>'+studyConfiguration(settings,'541、542')+
    studyTable(['画像','541 完整正确率','542 完整正确率','对错不同的有效轮次','菜数轨迹'],data.map((p,i)=>[
      'ABCD'[i]+' · '+p.profile,percent(p.runs[0].metrics.fullSequenceAccuracy),percent(p.runs[1].metrics.fullSequenceAccuracy),
      p.differences.length,p.sameCurve?'相同':'不同']))+
    '<p class="muted">每列字符按尝试轮次排列。✓ 完整正确、× 有效错误、◇ 排除。每组两条难度轨迹使用同一横轴。</p>'+
    data.map((p,i)=>'<details class="card"><summary>'+'ABCD'[i]+' · '+p.profile+'逐轮对照</summary>'+
      (p.firstDecisionDifference?'<p>第 '+p.firstDecisionDifference+' 轮首次出现决策或下一轮菜数差异。</p>'+
        p.runs.map(({seed,rows})=>{const row=rows[p.firstDecisionDifference-1];return '<p>种子 '+seed+'：'+row.s.n+' 道菜，本组 '+
          row.result.k+'/'+row.result.v+' 完整正确，'+decisions[row.result.decision]+'。'+reasonFor(config,row)+'</p>';}).join(''):
        '<p>两次运行的难度决策和下一轮菜数一致。</p>')+
      p.runs.map(({seed,rows})=>'<h4>种子 '+seed+'</h4><p style="overflow-wrap:anywhere">'+rows.map(({result:r})=>
        r.valid?(r.exact?'✓':'×'):'◇').join(' ')+'</p><div class="chart">'+chart(rows,Math.max(...p.runs.map(r=>r.rows.length)))+'</div>').join('')+'</details>').join('');
  $('studyExport').disabled=false;
};
$('batchRun').onclick=()=>{
  const settings=studySettings();
  if(!settings) return;
  const protocol=$('batchProtocol').value||'story';
  const data=runBatch(config,settings,protocol);
  const calibration=fixedCalibration(settings);
  const cooldown=cooldownComparison(config,settings,protocol);
  study={version:VERSION,parameterVersion:VERSION,rngVersion:RNG_VERSION,simulationMode:'seeded_probability',
    study:'stability_batch',protocol,seeds:batchSeeds,conditions:data,fixedCalibration:calibration,cooldownComparison:cooldown};
  $('studyResults').innerHTML='<h3>'+batchProtocols[protocol]+' · 1,600 次运行</h3>'+
    studyConfiguration(settings,'1–100')+
    (protocol==='story'?'':'<p class="muted">本对照不设剧情切换或章节配额。有效试次最低门槛按所有对照组可达到的上限取较小值：'+data[0].config.minValid+' 次。</p>')+
    '<p class="muted">正确率分布列为 P10 / 中位数 / P90。稳定时间是最后一次实际调整时的累计有效轮数，且之后至少还有两组等量的有效试次。</p>'+
    studyTable(['画像','窗口 / 升 / 降','冷却组数','平均正确率','正确率分布','平均菜数','平均升 / 降','平均反向 / 快速','平均冷却阻止','平均有效轮数 / 完整组','最低难度全程停留率','最高难度触达率','稳定时间 / 可观察比例'],
      data.map((row,i)=>{const s=row.summary,c=row.config;return ['ABCD'[i%4],
        [c.window,c.up,c.down].join(' / '),c.cooldown,percent(s.accuracy),[s.accuracyP10,s.accuracyP50,s.accuracyP90].map(percent).join(' / '),
        num(s.difficulty),num(s.up)+' / '+num(s.down),num(s.reversals)+' / '+num(s.rapidReversals),num(s.cooldownHolds),
        num(s.valid)+' / '+num(s.settledGroups),percent(s.staysAtMinimumRate),percent(s.reachesMaximumRate),
        num(s.stableAfter)+' / '+percent(s.stableShare)];}))+
    '<h3>证据覆盖与最终难度</h3><p class="muted">最终推荐分布按每组 100 次运行计。证据不足时无推荐，末轮实际菜数单独统计。标准差以百分点显示。</p>'+
    studyTable(['画像','窗口','冷却','正确率标准差','平均末轮菜数','末轮 2 / 3 / 4 / 5 道','正常完成 / 证据不足','有推荐次数','平均推荐菜数','推荐 2 / 3 / 4 / 5 道'],
      data.map((row,i)=>{const s=row.summary,c=row.config;return ['ABCD'[i%4],c.window,c.cooldown,
        num(100*s.accuracySD),num(s.finalTestedSize),[2,3,4,5].map(n=>s.finalTestedDistribution[n]).join(' / '),
        percent(s.completed)+' / '+percent(s.insufficient),s.assessedCount,num(s.recommendedSize),
        [2,3,4,5].map(n=>s.finalSizeDistribution[n]).join(' / ')];}))+
    renderValidation(data,calibration,cooldown);
  $('studyExport').disabled=false;
};
function renderValidation(data,calibration,cooldown) {
  const label=(row,i)=>['ABCD'[i%4],row.config.window,row.config.cooldown];
  const dist=d=>sizes.map(n=>d[n]).join(' / ');
  const calibrationValues=b=>[b.size,percent(b.configuredProbability),b.valid,b.correct,percent(b.observed),percent(b.expected),
    points(b.deltaFromConfigured),points(b.delta)];
  const calibrationHeaders=['菜数','基础概率','有效轮数','正确次数','实际正确率','逐轮目标概率均值','对基础偏差（百分点）','对逐轮目标偏差（百分点）'];
  const [baseline,cooled]=cooldown.stressTest;
  return '<details class="card"><summary>最终证据门槛敏感性 · 1、2、3 组</summary>'+
    '<p class="muted">对同一轨迹重新判定，不追加轮次。分布依次为 2 / 3 / 4 / 5 道，比较共同达到门槛的种子，并单列失去推荐的数量。</p>'+
    studyTable(['画像','窗口','冷却','最低组数','形成推荐','比 1 组少','共同有推荐中改变','推荐分布'],
      data.flatMap((row,i)=>row.sensitivity.map(s=>[...label(row,i),s.groups,s.completed+'/'+s.total,s.lostVersusOne,
        s.changedAmongCommon+'/'+s.common,dist(s.distribution)])))+
    '</details><details class="card"><summary>难度停留与首次触达</summary>'+
    '<p class="muted">停留轮次包括排除试次。首次触达轮次只在达到上限的运行中取均值。</p>'+
    studyTable(['画像','窗口','冷却','最低难度平均轮次','最高难度平均轮次','首次到上限平均轮次','末轮 2 / 3 / 4 / 5 道'],
      data.map((row,i)=>{const s=row.summary;return [...label(row,i),num(s.minimumRounds),num(s.maximumRounds),
        num(s.firstMaximumRound),dist(s.finalTestedDistribution)];}))+
    '</details><details class="card"><summary>概率校准 · 固定菜数与自适应分配</summary>'+
    '<p class="muted">每个固定菜数用 100 个种子各生成 100 轮，排除轮不计入分母。D 启用时间波动时，逐轮目标概率会变化，校准应看实际率与逐轮目标均值之差。</p>'+
    '<h4>固定菜数</h4>'+studyTable(['画像',...calibrationHeaders],
      calibration.flatMap((row,i)=>row.bySize.map(b=>['ABCD'[i],...calibrationValues(b)])))+
    '<h4>自适应分配下实际出现的菜数</h4>'+studyTable(['画像','窗口','冷却',...calibrationHeaders],
      data.flatMap((row,i)=>row.calibration.map(b=>[...label(row,i),...calibrationValues(b)])))+
    '</details><details class="card"><summary>冷却代价 · 推迟降级与推荐变化</summary>'+
    '<p>持续失误压力测试：从第 4 轮开始持续出错，无冷却在第 '+baseline.firstAppliedDowngrade+' 轮后降级，'+
    '有 1 组冷却在第 '+cooled.firstAppliedDowngrade+' 轮后降级，多经历 '+(cooled.attemptsAtFourAfterDrop-baseline.attemptsAtFourAfterDrop)+' 轮 4 道菜。</p>'+
    '<p class="muted">配对统计只跟踪两条共同轨迹首次被冷却阻止的调整。延迟以仍在原难度的有效轮次计，只对之后确实降级的运行取均值。原难度额外错误轮是暴露指标。推荐变化只比较两边均有推荐时的同一随机种子。</p>'+
    studyTable(['画像','首先阻止升 / 降','后续发生降级','到结束仍未降级','先向另一方向调整','降级延迟（有效轮）',
      '原难度额外轮','原难度额外有效错误','共同有推荐','推荐更高 / 更低 / 相同','失去 / 新增推荐','平均推荐差'],
      cooldown.profiles.map((row,i)=>{const s=row.summary;return ['ABCD'[i],s.firstUpSuppressed+' / '+s.firstDownSuppressed,
        s.delayedDownObserved,s.endedWithoutObservedDown,s.otherDirection,num(s.meanDownDelay),num(s.meanExtraRoundsAtSize),
        num(s.meanExtraValidWrong),s.commonRecommendations,[s.higher,s.lower,s.same].join(' / '),s.lost+' / '+s.gained,
        num(s.meanRecommendationShift)];}))+'</details>';
}
$('studyExport').onclick=()=>{if(study) downloadJSON(study,'old-master-'+study.study+'.json');};
$('bayesCompare').onclick=()=>{
  const settings=studySettings();
  if(!settings) return;
  const data=compareBayesianPolicies(config,settings);
  study={...data,study:'bayes_policy_comparison',simulationMode:'seeded_probability',rngVersion:RNG_VERSION,model:BAYES};
  $('studyResults').innerHTML='<h3>固定难度与两种自适应规则对照</h3>'+
    '<p class="muted">每行 100 个种子。目标偏差用模拟真值计算，只纳入形成推荐的运行。MAE 使用同一后验估计，先对每次运行已测档位平均，再对运行平均。众数占比仅统计有推荐的运行。首个达标轮以有效试次数表示，完整实验仍运行到 60 次。</p>'+
    studyTable(['画像','方案','目标偏差（百分点）','估计 MAE（百分点）','平均反向','推荐众数占比','首个证据达标轮','证据不足率','未发布率','推荐 2 / 3 / 4 / 5 道'],
      data.conditions.map(({profile,arm,summary:s})=>['ABCD'[profile],arm,points(s.targetDeviation),points(s.mae),
        num(s.reversals),percent(s.modalShare),num(s.firstReportable),percent(s.insufficient),percent(1-s.coverage),
        DIFFICULTIES.map(n=>s.distribution[n]).join(' / ')]));
  $('studyExport').disabled=false;
};
$('validateRecommendation').onclick=()=>{
  const settings=studySettings();
  if(!settings) return;
  study={...recommendationValidation(settings,$('recommendationProtocol').value),study:'recommendation_reliability'};
  $('studyResults').innerHTML='<h3>推荐门槛对照 · '+batchProtocols[study.protocol]+'</h3>'+
    '<p>各方案对同一批试次作复评，每画像使用 100 个种子。每档最低样本量为原始正确率在 60%–80% 时、所有可能的正确次数都能满足指定区间全宽的最小试次数。模拟使用固定的逐档正确概率。</p>'+
    studyTable(['画像','方案','候选最低次数','区间全宽上限','正式推荐数','已推荐中真值在目标内','偏差（百分点）','曾达标次数','首次达标平均有效数','收尾门槛不足','无达标档','无目标匹配','最高仍易 / 最低仍难 / 两端冲突','推荐 2 / 3 / 4 / 5 道'],
      study.conditions.map(({profile,label,rule,summary:s})=>{const a=s.finalOutcomes;return ['ABCD'[profile],label,
        rule?.minTrials??BAYES.preliminaryMin,rule?points(rule.maxWidth):'不限',a.FORMAL,s.trueInBand+'/'+a.FORMAL,
        points(s.meanTargetGap),s.firstReached,num(s.meanFirstValid),a.GATE_CLOSED,a.NO_ELIGIBLE_DIFFICULTY,a.NO_TARGET_BAND_MATCH,
        [a.RANGE_TOO_EASY,a.RANGE_TOO_HARD,a.CONFLICTING_BOUNDS].join(' / '),Object.values(s.distribution).join(' / ')];}));
  $('studyExport').disabled=false;
};
populate(config);
setupProfiles();
invalidateComparison();
reset();
$('interactiveApp').hidden=false;
$('startupNotice').hidden=true;

