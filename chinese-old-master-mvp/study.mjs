// Set only the project URL and publishable key after the database migration is deployed.
export const CLOUD_CONFIG=Object.freeze({"url":"https://ehirgsylcgkgdbjfzkcc.supabase.co","publishableKey":"sb_publishable_1TiZh6NMTy7PBSkEakmUPw_zd7Ut35U"});

const studyToken=new URLSearchParams(location.hash.slice(1)).get('study');
export const isStudy=studyToken!==null;
export const studyReady=Boolean(CLOUD_CONFIG&&/^[a-f0-9]{64}$/.test(studyToken??''));
export const studyKey=studyReady?Array.from(new Uint8Array(await crypto.subtle.digest(
  'SHA-256',new TextEncoder().encode(studyToken))),b=>b.toString(16).padStart(2,'0')).join(''):null;

export function trialRows(session) {
  const rows=[
    ...session.onboarding.attempts.map(r=>({...r,mode:'practice',number:r.attempt,valid:false})),
    ...session.state.trials.map(r=>({...r,mode:'formal',number:r.trial}))
  ];
  return rows.map(r=>({
    mode:r.mode,number:r.number,size:r.size,level:r.level??null,status:r.input.status,
    valid:r.valid,exact:r.exact,position_accuracy:r.positionAccuracy,completion:r.completion,
    response_ms:r.input.responseMs,target:r.input.target,answer:r.input.answer,
    events:r.input.events.map(({action,dish,atMs})=>({action,dish,at_ms:atMs})),
    undo_count:r.input.undoCount,next_size:r.nextSize??null,decision:r.decision??null,
    rules_version:session.version,guide_version:session.onboarding.version,
    rules_viewed_at:session.onboarding.rulesViewedAt,formal_started_at:r.mode==='formal'?session.onboarding.formalStartedAt:null,
    recorded_at:r.savedAt
  }));
}

async function send(sessionId,trial) {
  const response=await fetch(CLOUD_CONFIG.url+'/rest/v1/rpc/receive_bento_study_trial',{
    method:'POST',
    headers:{apikey:CLOUD_CONFIG.publishableKey,'Content-Type':'application/json'},
    body:JSON.stringify({p_token:studyToken,p_session:sessionId,p_trial:trial}),
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok) {
    const body=await response.json().catch(()=>null);
    const permanent=response.status>=400&&response.status<500&&response.status!==429;
    const error=new Error(body?.message??'同步服务暂时不可用');
    error.permanent=permanent;
    throw error;
  }
}

export const joinStudy=sessionId=>send(sessionId,null);

export function createStudySync(key,status) {
  let acknowledged=new Set(),active=false,scheduled=false,current,delay=2500,timer;
  try { acknowledged=new Set(JSON.parse(localStorage.getItem(key+'-uploaded')||'[]')); } catch {}
  function queue(session) {
    current=session;
    if(!session.studyConsentAt||active||scheduled) return;
    scheduled=true;
    queueMicrotask(()=>{
      scheduled=false;
      void flush();
    });
  }
  async function flush() {
    if(active||!current?.studyConsentAt) return;
    active=true;
    clearTimeout(timer);
    const id=current.id;
    try {
      let pending;
      while((pending=trialRows(current).find(row=>!acknowledged.has(row.mode+':'+row.number)))) {
        status('正在同步本轮记录…');
        // During practice there is no interaction with the formal model.
        await send(id,pending);
        acknowledged.add(pending.mode+':'+pending.number);
        try {localStorage.setItem(key+'-uploaded',JSON.stringify([...acknowledged]));} catch {}
      }
      delay=2500;
      status(acknowledged.size?'本次记录已同步。':'研究连接已就绪。');
    } catch(error) {
      if(error.permanent) status('云端未收下记录。本机记录仍保留，请联系研究人员。');
      else {
        status('记录待同步。请保持页面打开，联网后会自动补传。');
        timer=setTimeout(flush,delay);
        delay=Math.min(delay*2,60000);
      }
    } finally { active=false; }
  }
  window.addEventListener('online',flush);
  return queue;
}
