const BAYES=Object.freeze({target:0.70,lower:0.60,upper:0.80,confidence:0.75,preliminaryMin:3,window:3});
const RECOMMENDATION_RULE=Object.freeze({minTrials:11,maxWidth:0.50,boundaryConfidence:0.975});
const DIFFICULTIES=[2,3,4,5];
const emptyEvidence=()=>DIFFICULTIES.map(size=>({size,total:0,correct:0}));
const intervalCache=new Map();

// For integer a,b, the Beta CDF equals a binomial upper tail. Scale
// weights around the mode so even large counts avoid underflow.
function betaTails(a,b,x) {
  if(x<=0) return {below:0,above:1};
  if(x>=1) return {below:1,above:0};
  const n=a+b-1,mode=Math.floor((n+1)*x);
  let below=Number(mode>=a),above=Number(mode<a),weight=1;
  for(let i=mode;i>0;i--) {
    weight*=i/(n-i+1)*(1-x)/x;
    if(i-1>=a) below+=weight; else above+=weight;
  }
  weight=1;
  for(let i=mode;i<n;i++) {
    weight*=(n-i)/(i+1)*x/(1-x);
    if(i+1>=a) below+=weight; else above+=weight;
  }
  const sum=below+above;
  return {below:below/sum,above:above/sum};
}
function betaQuantile(a,b,q) {
  let lower=0,upper=1;
  for(let i=0;i<48;i++) {
    const middle=(lower+upper)/2;
    if(betaTails(a,b,middle).below<q) lower=middle; else upper=middle;
  }
  return (lower+upper)/2;
}
function posterior(count,intervals=false) {
  const {total,correct}=count, alpha=correct+1,beta=total-correct+1;
  let interval95=null;
  if(total&&intervals) {
    const key=alpha+':'+beta;
    if(!intervalCache.has(key)) intervalCache.set(key,Object.freeze([betaQuantile(alpha,beta,0.025),betaQuantile(alpha,beta,0.975)]));
    interval95=intervalCache.get(key);
  }
  return {...count,alpha,beta,mean:total?alpha/(alpha+beta):null,
    interval95,intervalWidth:interval95?interval95[1]-interval95[0]:null,
    support:total?betaTails(alpha,beta,BAYES.lower).above:null};
}
function addEvidence(bank,size,total,correct) {
  if(!total) return bank;
  return bank.map(row=>row.size===size?{size,total:row.total+total,correct:row.correct+correct}:row);
}
function windowEvidence(total,correct) {
  const alpha=correct+1,beta=1+total-correct;
  return {alpha,beta,upgrade:betaTails(alpha,beta,BAYES.target).above,
    downgrade:betaTails(alpha,beta,BAYES.lower).below};
}
function bayesianReport(bank,intervals=false,minSize=2,maxSize=5,rule=RECOMMENDATION_RULE) {
  const curve=bank.filter(r=>r.size>=minSize&&r.size<=maxSize).map(count=>{
    const preliminary=count.total>=BAYES.preliminaryMin;
    const row=posterior(count,preliminary&&(intervals||count.total>=rule.minTrials));
    const eligible=count.total>=rule.minTrials&&row.intervalWidth!==null&&row.intervalWidth<=rule.maxWidth;
    const evidence=count.total===0?'UNTESTED':!preliminary?'OBSERVING':eligible?'CANDIDATE':'PRELIMINARY';
    return {...row,evidence,eligible};
  });
  let supportedSize=null, nearest=null, prefix=true;
  for(const row of curve) {
    prefix=prefix&&row.total>=BAYES.preliminaryMin&&row.support>=BAYES.confidence;
    if(prefix) supportedSize=row.size;
    if(!row.eligible) continue;
    const gap=Math.abs(row.mean-BAYES.target);
    if(!nearest||gap<nearest.gap-1e-12) nearest={size:row.size,mean:row.mean,gap,
      inBand:row.mean>=BAYES.lower&&row.mean<=BAYES.upper};
  }
  const low=curve[0],high=curve.at(-1);
  const lowProbability=low?.eligible?betaTails(low.alpha,low.beta,BAYES.lower).below:null;
  const highProbability=high?.eligible?betaTails(high.alpha,high.beta,BAYES.upper).above:null;
  const tooHard=lowProbability!==null&&lowProbability>=rule.boundaryConfidence;
  const tooEasy=highProbability!==null&&highProbability>=rule.boundaryConfidence;
  const status=tooHard&&tooEasy?'CONFLICTING_BOUNDS':tooHard?'RANGE_TOO_HARD':tooEasy?'RANGE_TOO_EASY':
    !nearest?'NO_ELIGIBLE_DIFFICULTY':!nearest.inBand?'NO_TARGET_BAND_MATCH':'MATCH';
  return {curve,supportedSize,nearest,recommendation:status==='MATCH'?nearest:null,status,boundary:{lowProbability,highProbability}};
}

