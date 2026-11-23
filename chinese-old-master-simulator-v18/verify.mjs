import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source=(await Promise.all(['bayes.js','model.js','research.js'].map(f=>fs.readFile(new URL(f,import.meta.url),'utf8')))).join('\n');
const {defaults,defaultRates,betaTails,posterior,windowEvidence,bayesianReport,start,step,run,compareBayesianPolicies}=
  new Function(source+';return {defaults,defaultRates,betaTails,posterior,windowEvidence,bayesianReport,start,step,run,compareBayesianPolicies}')();
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,[actual,expected]);
[[.0081,.9744],[.0837,.8208],[.3483,.4752],[.7599,.1296]].forEach(([up,down],k)=>{
  const p=windowEvidence(3,k);close(p.upgrade,up);close(p.downgrade,down);
});
const high=posterior({size:2,total:3,correct:3},true);
close(high.mean,.8);
close(high.interval95[0],.025**.25);
close(high.interval95[1],.975**.25);
const tiny=betaTails(5001,1,.99);
close(tiny.below,.99**5001);
assert.equal(posterior({size:2,total:0,correct:0}).mean,null);
const curve=[{size:2,total:8,correct:8},{size:3,total:8,correct:6},{size:4,total:6,correct:3},{size:5,total:0,correct:0}];
assert.equal(bayesianReport(curve).recommendation.size,3);
assert.equal(bayesianReport(curve).supportedSize,3);
assert.equal(bayesianReport([{size:2,total:3,correct:2},{size:3,total:3,correct:3}]).recommendation.size,2);
assert.equal(bayesianReport([{size:2,total:2,correct:2},{size:3,total:20,correct:20}]).supportedSize,null);
assert.equal(bayesianReport([{size:2,total:2,correct:2}]).recommendation,null);
let s=start(defaults);
const ok={status:'SUBMIT',items:2,hits:2};
const r=step(defaults,s,{status:'TIMEOUT',items:2,hits:2});
assert.deepEqual([r.valid,r.exact,r.timedOut,r.next.bank[0].correct,r.next.bank[0].total],[true,false,true,0,1]);
assert.equal(step(defaults,s,{status:'TIMEOUT'}).valid,false);
assert.equal(step(defaults,s,{status:'TECH'}).next.bank[0].total,0);
for(const n of [2,3,4,5]) for(const k of [0,1,2,3]){
  s={...start(defaults),n};
  for(let i=0;i<3;i++) s=step(defaults,s,{...ok,items:n,hits:i<k?n:0}).next;
  assert.equal(s.n,Math.max(2,Math.min(5,n+(k===3?1:k<=1?-1:0))));
}
const last=run(defaults,0).at(-1).result.next;
assert.equal(last.assessment.status,'COMPLETED');
assert.equal(last.bank.reduce((sum,row)=>sum+row.total,0)-last.assessment.modelEvidence.reduce((sum,row)=>sum+row.total,0),2);
assert.equal(run(defaults,1).at(-1).result.next.assessment.status,'INSUFFICIENT_EVIDENCE');
const study=compareBayesianPolicies(defaults,defaultRates.map(rates=>({rates,temporal:false})));
assert.equal(study.conditions.length,20);
for(let p=0;p<4;p++) {
  const old=study.conditions[12+p],modern=study.conditions[16+p];
  for(let i=0;i<100;i++) {
    assert.deepEqual(old.samples[i].decisionLog,modern.samples[i].decisionLog);
    const fixed=study.conditions[p].samples[i].decisionLog;
    assert.deepEqual(fixed.map(t=>t.draw),modern.samples[i].decisionLog.map(t=>t.draw));
  }
}
console.log(JSON.stringify(study.conditions.map(({profile,arm,summary})=>({profile,arm,...summary})),null,2));

