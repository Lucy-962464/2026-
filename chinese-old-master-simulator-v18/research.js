const probabilityConfigs=[
  {window:3,up:3,down:1,cooldown:0},
  {window:4,up:4,down:1,cooldown:0},
  {window:5,up:5,down:2,cooldown:0},
  {window:3,up:3,down:1,cooldown:1}
];
const batchProtocols={story:'完整剧情流程',valid60:'相同有效试次数 · 60 次',groups10:'相同完整证据组 · 10 组'};
const batchSeeds=Array.from({length:100},(_,i)=>i+1);
const sizes=[2,3,4,5];
const mean=(rows,read)=>rows.length?rows.reduce((sum,row)=>sum+read(row),0)/rows.length:null;
function batchCondition(config,overrides,protocol) {
  const validBudget=protocol==='valid60'?60:protocol==='groups10'?10*overrides.window:null;
  // The 10-group arms share a minimum feasible in the shortest arm (30 trials).
  const minValid=protocol==='valid60'?Math.min(config.minValid,60):protocol==='groups10'?Math.min(config.minValid,30):config.minValid;
  return {config:{...config,...overrides,minValid,policy:'counts'},validBudget};
}
function compareBayesianPolicies(config,settings) {
  const budget=60;
  const arms=[
    ...[2,3,4].map(n=>({label:'固定 '+n+' 道',policy:'fixed',startSize:n})),
    {label:'原始计数规则',policy:'counts',startSize:2},
    {label:'贝叶斯双层',policy:'bayes',startSize:2}
  ];
  const conditions=arms.flatMap(arm=>settings.map((p,profile)=>{
    const c={...config,...arm,window:3,up:3,down:1,cooldown:0,minSize:2,maxSize:5,minValid:32,minRecentGroups:1};
    const rates=p.rates.map(rate=>rate/100);
    const samples=batchSeeds.map(seed=>{
      const rows=run(c,profile,{seed,rates:p.rates,temporal:false},budget);
      const last=rows.at(-1),ending=last.result.next;
      const n=ending.assessment.recommendedSize;
      const eligible=rows.find(row=>{
        const next=row.result.next;
        return next.assessment?next.assessment.status==='COMPLETED':
          next.validTotal>=c.minValid&&next.groupsAtSize>=c.minRecentGroups&&next.lastSettled?.size===next.n;
      });
      const tested=ending.bank.filter(row=>row.total>0);
      const metrics=summarize(c,rows);
      return {seed,recommendedSize:n,testedSizes:tested.length,
        targetError:n===null?null:Math.abs(rates[n-2]-BAYES.target),
        mae:mean(tested,row=>Math.abs(posterior(row).mean-rates[row.size-2])),
        firstReportableValid:eligible?.result.next.validTotal??null,reversals:metrics.reversals,
        decisionLog:rows.map(({i,s,input,result:r})=>({trial:i,size:s.n,p:input.probability,draw:input.draw,
          status:input.status,valid:r.valid,exact:r.exact,decision:r.decision,nextSize:r.next.n}))};
    });
    const complete=samples.filter(x=>x.recommendedSize!==null);
    const distribution=sizeDistribution(complete,x=>x.recommendedSize);
    return {profile,arm:arm.label,policy:arm.policy,rates,samples,summary:{
      targetDeviation:mean(complete,x=>x.targetError),mae:mean(samples,x=>x.mae),
      averageTestedSizes:mean(samples,x=>x.testedSizes),
      reversals:mean(samples,x=>x.reversals),coverage:complete.length/samples.length,
      modalShare:complete.length?Math.max(...Object.values(distribution))/complete.length:null,
      firstReportable:mean(samples.filter(s=>s.firstReportableValid!==null),s=>s.firstReportableValid),distribution
    }};
  }));
  return {version:VERSION,seeds:batchSeeds,budget,target:BAYES.target,conditions};
}
function sizeDistribution(rows,read) {
  return Object.fromEntries(sizes.map(n=>[n,rows.filter(row=>read(row)===n).length]));
}
function seedPairs(config,settings) {
  return settings.map((p,i)=>{
    const [first,second]=[541,542].map(seed=>{
      const performance={...p,seed};
      const rows=run(config,i,performance);
      return {seed,performance,rows,metrics:summarize(config,rows)};
    });
    const differences=first.rows.filter((row,j)=>{
      const other=second.rows[j];
      return row.result.valid&&other?.result.valid&&row.result.exact!==other.result.exact;
    }).map(row=>row.i);
    const sameCurve=first.rows.length===second.rows.length&&first.rows.every((row,j)=>row.s.n===second.rows[j].s.n);
    const firstDecisionDifference=first.rows.findIndex((row,j)=>second.rows[j]&&
      (row.result.decision!==second.rows[j].result.decision||row.result.next.n!==second.rows[j].result.next.n));
    return {profile:profiles[i],differences,sameCurve,firstDecisionDifference:firstDecisionDifference===-1?null:firstDecisionDifference+1,runs:[first,second]};
  });
}
function repeatSeed(config,settings) {
  return settings.map((p,i)=>{
    const performance={...p,seed:541};
    const first=run(config,i,performance),second=run(config,i,performance);
    return {profile:profiles[i],performance,trials:first.length,
      trialResultsIdentical:JSON.stringify(first.map(row=>[row.input,row.result.valid,row.result.exact]))===
        JSON.stringify(second.map(row=>[row.input,row.result.valid,row.result.exact])),
      difficultyIdentical:JSON.stringify(first.map(row=>row.s.n))===JSON.stringify(second.map(row=>row.s.n)),
      decisionsIdentical:JSON.stringify(first.map(row=>row.result))===JSON.stringify(second.map(row=>row.result)),
      assessmentIdentical:JSON.stringify(first.at(-1).result.next.assessment)===JSON.stringify(second.at(-1).result.next.assessment),
      metricsIdentical:JSON.stringify(summarize(config,first))===JSON.stringify(summarize(config,second))&&
        rollingVolatility(first)===rollingVolatility(second)};
  });
}
function runBatch(config,settings,protocol='story') {
  return probabilityConfigs.flatMap(overrides=>settings.map((p,i)=>{
    const {config:c,validBudget}=batchCondition(config,overrides,protocol);
    const bins=sizes.map(n=>calibrationBin(n,p.rates[n-2]));
    const samples=batchSeeds.map(seed=>{
      const trials=run(c,i,{...p,seed},validBudget);
      const last=trials.at(-1);
      const end=last.result.next;
      const finalEvidence={n:last.s.n,validTotal:end.validTotal,groupsAtSize:end.groupsAtSize,
        lastAdjustmentTrial:end.lastAdjustmentTrial,lastSettled:end.lastSettled,
        pendingTrials:end.pendingTrials,pendingCorrect:end.k};
      const thresholdRecommendations=[1,2,3].map(minRecentGroups=>
        finalize({...c,minRecentGroups},finalEvidence).recommendedSize);
      for(const {s,input,result} of trials) if(result.valid) recordDraw(bins[s.n-2],input,result.exact);
      const firstMaximum=trials.find(row=>row.s.n===c.maxSize);
      return {seed,trials:trials.length,settledGroups:trials.filter(row=>row.result.evidenceStatus==='SETTLED').length,
        meanSize:mean(trials,t=>t.s.n),
        stayedAtMinimum:trials.every(t=>t.s.n===c.minSize),reachedMaximum:firstMaximum!==undefined,
        minimumRounds:trials.filter(t=>t.s.n===c.minSize).length,maximumRounds:trials.filter(t=>t.s.n===c.maxSize).length,
        firstMaximumRound:firstMaximum?.i??null,
        finalTestedSize:last.s.n,assessment:end.assessment,thresholdRecommendations,rollingAccuracySD:rollingVolatility(trials),
        ...summarize(c,trials)};
    });
    const rates=samples.map(row=>row.fullSequenceAccuracy).sort((a,b)=>a-b);
    const accuracy=mean(samples,s=>s.fullSequenceAccuracy);
    const stable=samples.filter(row=>row.stableAfterValid!==null);
    const assessed=samples.filter(s=>s.assessment?.status==='COMPLETED');
    const finalSizeDistribution=sizeDistribution(assessed,s=>s.assessment.recommendedSize);
    const finalTestedDistribution=sizeDistribution(samples,s=>s.finalTestedSize);
    const summary={
      accuracy,accuracySD:Math.sqrt(samples.reduce((sum,s)=>sum+(s.fullSequenceAccuracy-accuracy)**2,0)/(samples.length-1)),
      accuracyP10:rates[9],accuracyP50:rates[49],accuracyP90:rates[89],
      difficulty:mean(samples,s=>s.meanSize),up:mean(samples,s=>s.appliedUp),down:mean(samples,s=>s.appliedDown),
      reversals:mean(samples,s=>s.reversals),staysAtMinimumRate:mean(samples,s=>Number(s.stayedAtMinimum)),
      rapidReversals:mean(samples,s=>s.rapidReversals),cooldownHolds:mean(samples,s=>s.decisions.COOLDOWN),
      reachesMaximumRate:mean(samples,s=>Number(s.reachedMaximum)),valid:mean(samples,s=>s.validTrials),
      minimumRounds:mean(samples,s=>s.minimumRounds),maximumRounds:mean(samples,s=>s.maximumRounds),
      firstMaximumRound:mean(samples.filter(s=>s.reachedMaximum),s=>s.firstMaximumRound),
      finalTestedSize:mean(samples,s=>s.finalTestedSize),recommendedSize:mean(assessed,s=>s.assessment.recommendedSize),
      finalSizeDistribution,finalTestedDistribution,assessedCount:assessed.length,
      completed:assessed.length/samples.length,
      settledGroups:mean(samples,s=>s.settledGroups),
      insufficient:mean(samples,s=>Number(s.assessment?.status==='INSUFFICIENT_EVIDENCE')),
      rollingAccuracySD:mean(samples.filter(s=>s.rollingAccuracySD!==null),s=>s.rollingAccuracySD),
      stableAfter:mean(stable,s=>s.stableAfterValid),stableShare:stable.length/samples.length
    };
    return {config:c,protocol,validBudget,profile:profiles[i],rates:p.rates,temporal:p.temporal,summary,samples,
      calibration:bins.map(calibrationResult),sensitivity:evidenceSensitivity(samples)};
  }));
}
function evidenceSensitivity(samples) {
  const eligible=samples.filter(s=>s.thresholdRecommendations[0]!==null);
  return [1,2,3].map(groups=>{
    const read=s=>s.thresholdRecommendations[groups-1];
    const retained=samples.filter(s=>read(s)!==null);
    const common=retained.filter(s=>s.thresholdRecommendations[0]!==null);
    return {groups,total:samples.length,completed:retained.length,lostVersusOne:eligible.length-common.length,
      common:common.length,changedAmongCommon:common.filter(s=>s.thresholdRecommendations[0]!==read(s)).length,
      distribution:sizeDistribution(retained,read)};
  });
}
function calibrationBin(size,configuredPercent) {
  return {size,configuredProbability:configuredPercent/100,valid:0,correct:0,targetSum:0};
}
function recordDraw(bin,input,exact) {
  bin.valid++;bin.correct+=Number(exact);bin.targetSum+=input.probability;
}
function calibrationResult({size,configuredProbability,valid,correct,targetSum}) {
  const expected=valid?targetSum/valid:null;
  const observed=valid?correct/valid:null;
  return {size,configuredProbability,valid,correct,expected,observed,
    delta:valid?observed-expected:null,deltaFromConfigured:valid?observed-configuredProbability:null};
}
function fixedCalibration(settings) {
  return settings.map((p,index)=>({profile:profiles[index],temporal:p.temporal,bySize:sizes.map(n=>{
    const bin=calibrationBin(n,p.rates[n-2]);
    for(const seed of batchSeeds) for(let i=1;i<=100;i++) {
      const input=synthetic(index,i,n,{...p,seed});
      if(input.status==='SUBMIT') recordDraw(bin,input,input.hits===n);
    }
    return calibrationResult(bin);
  })}));
}
function firstSuppression(baseline,cooled) {
  const index=cooled.findIndex(row=>row.result.decision==='COOLDOWN');
  if(index<0) return null;
  const a=baseline[index],b=cooled[index];
  if(!a||a.s.n!==b.s.n||a.result.next.n===null||a.result.next.n===a.s.n||b.result.next.n===null) return null;
  const direction=a.result.next.n<a.s.n?'DOWN':'UP';
  const probes=[];
  let resolution='ENDED';
  for(const row of cooled.slice(index+1)) {
    if(row.s.n!==b.s.n) break;
    probes.push(row);
    const size=row.result.next.n;
    if(size===null||size===b.s.n) continue;
    resolution=size===a.result.next.n?'APPLIED':'OTHER_DIRECTION';
    break;
  }
  const valid=probes.filter(row=>row.result.valid);
  return {trial:b.i,size:b.s.n,direction,resolution,extraRoundsAtSize:probes.length,extraValidAtSize:valid.length,
    extraValidWrong:valid.filter(row=>!row.result.exact).length};
}
function sustainedDrop(cooldown) {
  const c={...defaults,cooldown,startSize:3};
  let s=start(c);
  const rows=[];
  for(let i=1;!s.assessment;i++) {
    const hits=i<=3?s.n:s.n-2;
    const result=step(c,s,{status:'SUBMIT',items:s.n,hits},12);
    rows.push({i,s,result});s=result.next;
  }
  return {cooldown,dropStartsAt:4,firstAppliedDowngrade:rows.find(row=>row.result.next.n!==null&&row.result.next.n<row.s.n).i,
    attemptsAtFourAfterDrop:rows.filter(row=>row.i>=4&&row.s.n===4).length,
    trajectory:rows.map(row=>({trial:row.i,size:row.s.n,decision:row.result.decision}))};
}
function cooldownComparison(config,settings,protocol) {
  const arms=[0,1].map(cooldown=>batchCondition(config,{window:3,up:3,down:1,cooldown},protocol));
  return {protocol,stressTest:[sustainedDrop(0),sustainedDrop(1)],profiles:settings.map((p,i)=>{
    const pairs=batchSeeds.map(seed=>{
      const [baseline,cooled]=arms.map(a=>run(a.config,i,{...p,seed},a.validBudget));
      return {seed,firstSuppression:firstSuppression(baseline,cooled),
        recommendations:[baseline,cooled].map(rows=>rows.at(-1).result.next.assessment.recommendedSize),
        reversals:[baseline,cooled].map((rows,j)=>summarize(arms[j].config,rows).reversals)};
    });
    const suppressions=pairs.map(pair=>pair.firstSuppression).filter(Boolean);
    const downs=suppressions.filter(e=>e.direction==='DOWN');
    const applied=downs.filter(e=>e.resolution==='APPLIED');
    const common=pairs.filter(p=>p.recommendations.every(n=>n!==null));
    const shifts=common.map(p=>p.recommendations[1]-p.recommendations[0]);
    return {profile:profiles[i],pairs,summary:{firstUpSuppressed:suppressions.length-downs.length,firstDownSuppressed:downs.length,
      delayedDownObserved:applied.length,endedWithoutObservedDown:downs.filter(e=>e.resolution==='ENDED').length,
      otherDirection:downs.filter(e=>e.resolution==='OTHER_DIRECTION').length,
      meanDownDelay:mean(applied,e=>e.extraValidAtSize),meanExtraRoundsAtSize:mean(downs,e=>e.extraRoundsAtSize),
      meanExtraValidWrong:mean(downs,e=>e.extraValidWrong),commonRecommendations:common.length,
      higher:shifts.filter(x=>x>0).length,lower:shifts.filter(x=>x<0).length,same:shifts.filter(x=>x===0).length,
      lost:pairs.filter(p=>p.recommendations[0]!==null&&p.recommendations[1]===null).length,
      gained:pairs.filter(p=>p.recommendations[0]===null&&p.recommendations[1]!==null).length,
      meanRecommendationShift:mean(shifts,x=>x),meanReversals:arms.map((_,j)=>mean(pairs,p=>p.reversals[j]))}};
  })};
}

