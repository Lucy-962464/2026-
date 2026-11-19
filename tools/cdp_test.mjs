// 用 CDP 驱动无头 Edge 跑页面测试（真实时间，不依赖 virtual-time-budget）
import { spawn } from 'child_process';
import http from 'http';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
async function waitForEndpoint() {
  for (let i = 0; i < 60; i++) {
    try { const t = await getJSON('/json/list'); if (t.length) return t; } catch (e) { }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Edge debugging endpoint not reachable');
}

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + process.env.TEMP + '/edge-cdp-profile-' + Date.now(),
  'about:blank'
], { stdio: 'ignore' });

try {
  const targets = await waitForEndpoint();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise(resolve => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  // 捕获所有帧的异常与 console 输出
  const consoleLines = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      consoleLines.push('EXCEPTION: ' + (d.exception && d.exception.description || d.text || JSON.stringify(d).slice(0, 300)));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleLines.push('CONSOLE.ERROR: ' + JSON.stringify(m.params.args).slice(0, 300));
    }
  };
  await send('Runtime.enable');
  await send('Log.enable');

  const url = process.argv[2];
  await send('Page.enable');
  await send('Page.navigate', { url });
  await new Promise(r => setTimeout(r, 2000));

  // 轮询页面直到标题出现结果标记
  let result = null;
  for (let i = 0; i < 240; i++) {
    const r = await send('Runtime.evaluate', { expression: 'document.title' });
    const title = r && r.result && r.result.result && r.result.result.value;
    if (title && /_(\d+)_(\d+)$/.test(title)) { result = title; break; }
    const o = await send('Runtime.evaluate', { expression: 'document.querySelector("#out") ? document.querySelector("#out").textContent : ""' });
    const outTxt = o && o.result && o.result.result && o.result.result.value;
    if (outTxt && /RESULT \d+ passed/.test(outTxt)) { result = 'out'; break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!result) {
    const r = await send('Runtime.evaluate', { expression: 'document.querySelector("#out") ? document.querySelector("#out").textContent : "no #out"' });
    console.log('TIMEOUT: page did not complete. Current output:\n' + (r.result.result.value || '').slice(0, 3000));
  } else {
    const r = await send('Runtime.evaluate', { expression: 'document.querySelector("#out").textContent' });
    console.log(r.result.result.value);
  }
  ws.close();
} catch (e) {
  console.log('CDP ERROR: ' + e.message);
} finally {
  edge.kill();
}
