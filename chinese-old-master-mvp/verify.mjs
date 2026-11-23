import assert from 'node:assert/strict';
import {advance,orderFor,RULES,score,start,resume,terminate} from './model.mjs';
import {newSession,prepare,record,restore} from './session.mjs';
import {PROFILES,simulate} from './simulation.mjs';

const submit=(n,correct)=>({status:'SUBMIT',items:n,hits:correct?n:0});
const wrong={status:'SUBMIT',items:1,hits:0};
const fill=(state,outcomes)=>outcomes.reduce((s,exact)=>advance(s,submit(s.size,exact)),state);
for(const size of [2,3,4,5]) for(const correct of [0,1,2,3]){
  const first=Array.from({length:3},(_,i)=>i<correct);
  const end=fill({...start(),size},first);
  const [one,two,three]=end.trials;
  assert.deepEqual([one.settled,two.settled,three.settled],[false,false,true]);
  const sign=correct===3?1:correct<=1?-1:0;
  assert.equal(end.size,Math.min(5,Math.max(2,size+sign)));
  assert.equal(three.decision,correct===3?(size===5?'MAX':'UP'):correct<=1?(size===2?'MIN':'DOWN'):'HOLD');
  assert.equal(end.openGroup.length,0);
}
let s=advance(start(),submit(2,true));
for(const input of [{status:'ABORT'},{status:'TECH'},{status:'HINT',items:2,hits:2}]) s=advance(s,input);
assert.deepEqual([s.valid,s.openGroup.length,s.submittedInLevel,s.paused],[1,1,2,true]);
assert.throws(()=>advance(s,wrong));
s=advance(resume(s),wrong);
assert.equal(s.valid,2);
assert.equal(s.trials.at(-1).positionAccuracy,0);
const broken=advance(start(),{status:'SUBMIT',items:0,hits:0});
assert.equal(broken.trials[0].valid,false);
assert.equal(terminate(broken,'退出').report.status,'ABNORMAL');
const capped=advance({...start(),submittedInLevel:8,extra:11,openGroup:[{trial:1,exact:true}]},{status:'TECH'});
assert.equal(capped.level,2);
assert.equal(capped.trials.at(-1).storyCapReached,true);
assert.equal(capped.valid,0);
const pending=fill({...start(),level:4,size:3,valid:34,submittedInLevel:7,openGroup:[{trial:1,exact:true}],
  lastGroup:{size:4,trials:[1,2,3],correct:0,candidate:3}},[true]);
assert.equal(pending.report.status,'INSUFFICIENT');
assert.equal(pending.report.recommendedSize,null);
assert.equal(pending.report.deferred.length,2);
assert.equal(pending.size,null);
const atTerminal=fill({...start(),level:4,size:4,valid:34,submittedInLevel:7,
  openGroup:[{trial:1,exact:true},{trial:2,exact:true}]},[true]);
assert.equal(atTerminal.report.suggestedProbe,5);
assert.equal(atTerminal.report.recommendedSize,4);
assert.match(atTerminal.trials.at(-1).reason,/未实际调难/);
for(let n=2;n<=5;n++){
  const order=orderFor(2,n);
  assert.equal(score(order.target,order.target).exact,true);
  assert.equal(score(order.target,order.target.slice(0,1)).positionAccuracy,1/n);
  assert.equal(score(order.target,[]),null);
  assert.equal(score(order.target,[order.target[0],order.target[0]]),null);
}
let play=prepare(newSession());
play.task.answer=[...play.task.target];
play=record(play,'SUBMIT',1234);
assert.equal(play.state.trials[0].input.responseMs,1234);
assert.equal(restore(JSON.stringify(play)).state.valid,1);
const recovered=restore(JSON.stringify(prepare(play)));
assert.equal(recovered.state.trials.at(-1).input.status,'INTERRUPTED');
assert.equal(recovered.state.openGroup.length,1);
assert.equal(recovered.state.valid,1);
assert.equal(recovered.task,null);

const results=PROFILES.map((p,i)=>{
  const run=simulate(i,541);
  assert.deepEqual(run,simulate(i,541));
  assert.notDeepEqual(run,simulate(i,542));
  assert.deepEqual([...new Set(run.trials.map(r=>r.level))],[1,2,3,4]);
  assert.equal(run.valid,35);
  assert.equal(run.trials.length,38);
  assert.ok(run.trials.every(r=>r.size>=RULES.min&&r.size<=RULES.max&&
    (r.nextSize===null||Math.abs(r.size-r.nextSize)<=1)&&Boolean(r.reason)));
  const settled=run.trials.filter(r=>r.settled).flatMap(r=>r.evidenceTrials);
  assert.equal(new Set(settled).size,settled.length);
  assert.equal(run.trials.filter(r=>r.settled).length,11);
  return {profile:p.name,valid:run.valid,correct:run.trials.filter(r=>r.valid&&r.exact).length,
    up:run.trials.filter(r=>r.nextSize!==null&&r.nextSize>r.size).length,
    down:run.trials.filter(r=>r.nextSize!==null&&r.nextSize<r.size).length,
    status:run.report.status,recommendedSize:run.report.recommendedSize};
});
console.log(JSON.stringify(results,null,2));
console.log('PASS: profiles, replay, non-overlap, boundaries, reasons, final evidence, scoring, persistence, resume and interruption.');

