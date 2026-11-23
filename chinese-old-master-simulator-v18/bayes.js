const BAYES=Object.freeze({target:0.70,lower:0.60,upper:0.80,confidence:0.75,minPerSize:3,window:3});
const DIFFICULTIES=[2,3,4,5];
const emptyEvidence=()=>DIFFICULTIES.map(size=>({size,total:0,correct:0}));

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
  return {...count,alpha,beta,mean:total?alpha/(alpha+beta):null,
    interval95:total&&intervals?[betaQuantile(alpha,beta,0.025),betaQuantile(alpha,beta,0.975)]:null,
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
function bayesianReport(bank,intervals=false,minSize=2,maxSize=5) {
  const curve=bank.map(row=>posterior(row,intervals));
  let supportedSize=null, best=null, prefix=true;
  for(const row of curve.filter(r=>r.size>=minSize&&r.size<=maxSize)) {
    const eligible=row.total>=BAYES.minPerSize;
    prefix=prefix&&eligible&&row.support>=BAYES.confidence;
    if(prefix) supportedSize=row.size;
    if(!eligible) continue;
    const gap=Math.abs(row.mean-BAYES.target);
    if(!best||gap<best.gap-1e-12) best={size:row.size,mean:row.mean,gap,
      inBand:row.mean>=BAYES.lower&&row.mean<=BAYES.upper};
  }
  return {curve,supportedSize,recommendation:best};
}

