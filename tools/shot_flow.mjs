// 登录后截取推荐页/作答页，检查不同平板尺寸下的排版
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = +process.env.SHOT_PORT || 9455;
const W = +process.argv[2] || 1024;
const H = +process.argv[3] || 768;
const TAG = process.argv[4] || 'x';

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + process.env.TEMP + '/edge-shot-' + Date.now(), 'about:blank'
], { stdio: 'ignore' });

try {
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await getJSON('/json/list'); if (targets.length) break; } catch (e) { }
    await sleep(500);
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  await send('Page.enable');
  const TARGET = process.env.SHOT_URL || 'http://127.0.0.1:8099/participant.html';
  await send('Page.navigate', { url: TARGET });

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true });
    return r.result && r.result.result && r.result.result.value;
  };
  for (let i = 0; i < 60; i++) {
    const ready = await evalJs("document.readyState==='complete' && typeof window.Identity==='object' && typeof window.WorkBuddyCloud==='object'");
    if (ready) break;
    await sleep(700);
  }
  await sleep(800);

  await evalJs("document.querySelector('#btn-test-mode').click()");
  await sleep(500);
  await evalJs("document.querySelector('#btn-code-go').click()");
  // 等待进入偏好页或推荐页
  for (let i = 0; i < 40; i++) {
    const v = await evalJs("(document.querySelector('.view.active')||{}).id||''");
    if (v === 'view-prefs' || v === 'view-recommend') break;
    await sleep(500);
  }
  await sleep(700);
  const v0 = await evalJs("(document.querySelector('.view.active')||{}).id||''");
  if (v0 === 'view-prefs') {
    const s0 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`C:/Users/Lucy/WorkBuddy/2026-11-04-22-23-32/_shot/${TAG}_prefs.png`, Buffer.from(s0.result.data, 'base64'));
    await evalJs("document.querySelector('#btn-prefs-skip').click()");
    await sleep(800);
  }
  for (let i = 0; i < 25; i++) {
    const t = await evalJs("(document.querySelector('#reco-name')||{}).textContent||''");
    if (t && t !== '—') break;
    await sleep(600);
  }
  await sleep(600);
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`C:/Users/Lucy/WorkBuddy/2026-11-04-22-23-32/_shot/${TAG}_reco.png`, Buffer.from(shot1.result.data, 'base64'));

  // 进入任务页
  await evalJs("document.querySelector('#btn-reco-start').click();");
  await sleep(1200);
  const s3 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`C:/Users/Lucy/WorkBuddy/2026-11-04-22-23-32/_shot/${TAG}_instr.png`, Buffer.from(s3.result.data, 'base64'));
  await evalJs("document.querySelector('#btn-practice-start').click();");
  await sleep(4000);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`C:/Users/Lucy/WorkBuddy/2026-11-04-22-23-32/_shot/${TAG}_task.png`, Buffer.from(shot2.result.data, 'base64'));
  console.log('saved', TAG, W + 'x' + H);
  ws.close();
} catch (e) {
  console.log('ERR ' + e.message);
} finally {
  edge.kill();
}
