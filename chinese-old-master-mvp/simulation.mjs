import {advance,start} from './model.mjs';
export const PROFILES=Object.freeze([
  ['A 稳定高表现',[98,97,95,92]],['B 高难度困难',[90,85,48,30]],
  ['C 低起点表现',[32,24,14,8]],['D 波动表现',[61,50,46,39]]
].map(([name,rates])=>Object.freeze({name,rates:Object.freeze(rates)})));
function drawFor(seed,profile,i) {
  let x=(seed+Math.imul(profile+1,0x9e3779b9)+Math.imul(i,0x85ebca6b))>>>0;
  x=Math.imul(x^(x>>>16),0x21f0aaad);
  x=Math.imul(x^(x>>>15),0x735a2d97);
  return ((x^(x>>>15))>>>0)/4294967296;
}
export function simulate(profile,seed) {
  if(!PROFILES[profile]||!Number.isInteger(seed)||seed<0||seed>4294967295) throw new RangeError('无效画像或种子');
  let s=start();
  for(let i=1;!s.report;i++) {
    const status=({5:'ABORT',12:'HINT',19:'TECH'})[i]??'SUBMIT';
    // D uses fixed per-size calibrated assumptions and independent trial draws. No timed probability shifts.
    const probability=PROFILES[profile].rates[s.size-2]/100,draw=drawFor(seed,profile,i),exact=draw<probability;
    const hasAnswer=status==='SUBMIT'||status==='HINT';
    s=advance(s,{status,items:hasAnswer?(profile===2&&!exact?s.size-1:s.size):null,
      hits:hasAnswer?(exact?s.size:profile===2?0:s.size-2):null,probability,draw});
  }
  return s;
}

