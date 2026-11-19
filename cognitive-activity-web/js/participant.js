/* 参与者端 P01–P06：状态机 + 界面控制 */
(function () {
  'use strict';

  /* ================= 常量 ================= */
  const QUESTION_TOTAL = 3;            // 每次活动正式题数
  const PRACTICE_ITEMS = 2;            // 练习题物品数（少于正式题）
  const THEMES = ['日常饮食', '家庭生活', '自然植物', '传统文化', '运动健身', '音乐戏曲', '职业回忆', '养生保健'];
  const STORAGE_KEY = 'cog_ctx';

  /* 正式任务状态机：
     READY → INSTRUCTION → PRACTICE → PREPARE → PRESENTING → RETENTION
           → RESPONDING → SUBMITTED → FEEDBACK → COMPLETED
     约束：PRESENTING 不允许提交/查看答案；RESPONDING 允许选择/撤销/清空；
     SUBMITTED 后禁止修改；刷新/退出记录为中断，不算错误答案。 */

  /* ================= 状态 ================= */
  let ctx = null;          // { participant, sessionId, template, reco, sequenceNo, attemptId, phase, practiceDone, selected, helpUsed, nItems, presentMs, retentionMs, refreshCount }
  let gen = 0;             // 计时器代际，防止旧定时器串台
  let busy = false;

  /* ================= 小工具 ================= */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function showView(name) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $('#view-' + name).classList.add('active');
    $('#topbar').style.display = (name === 'welcome') ? 'none' : 'flex';
    window.scrollTo(0, 0);
  }

  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

  function banner(text, keep) {
    const b = $('#phase-banner');
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(banner._t);
    if (!keep) banner._t = setTimeout(() => b.classList.remove('show'), 1800);
  }

  function saveCtx() {
    if (ctx) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
    else sessionStorage.removeItem(STORAGE_KEY);
  }
  function loadCtx() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  }

  function applyFontSize(fs) {
    document.documentElement.classList.remove('fs-large', 'fs-xlarge');
    if (fs === 'large') document.documentElement.classList.add('fs-large');
    if (fs === 'xlarge') document.documentElement.classList.add('fs-xlarge');
  }

  function confirmBox(title, text) {
    return new Promise(resolve => {
      $('#confirm-title').textContent = title;
      $('#confirm-text').textContent = text;
      $('#confirm-mask').classList.add('show');
      const yes = $('#confirm-yes'), no = $('#confirm-no');
      const done = (v) => {
        $('#confirm-mask').classList.remove('show');
        yes.onclick = no.onclick = null;
        resolve(v);
      };
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
    });
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function fmtTime(sec) {
    if (sec < 60) return sec + ' 秒';
    return Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒';
  }

  /* ================= 初始化 ================= */
  async function init() {
    ctx = loadCtx();
    if (ctx && ctx.participant) applyFontSize(ctx.participant.fontSize || 'normal');

    if (ctx && ctx.sessionId && ctx.attemptId &&
        ['prepare', 'presenting', 'retention', 'responding'].includes(ctx.phase)) {
      await recoverFromRefresh();
    } else if (ctx && ctx.sessionId && ctx.phase === 'feedback') {
      showView('feedback');
      renderFeedbackSummary();
    } else {
      ctx = null; saveCtx();
      showView('welcome');
    }
    bindEvents();
  }

  /* 刷新恢复：中断未完成的那次尝试，重新出同一题 */
  async function recoverFromRefresh() {
    const oldAttemptId = ctx.attemptId;
    const wasPractice = ctx.phase === 'practice' || ctx.practiceMode;
    try {
      await api.interruptAttempt(oldAttemptId, 'refresh');
    } catch (e) { /* 尽力而为 */ }
    toast('刚才的题目因页面刷新已中断（不计为错误），现在重新开始这一题', 4200);
    if (wasPractice) {
      await startPractice();
    } else {
      await startQuestion(ctx.sequenceNo, true);
    }
  }

  /* ================= P01 欢迎 / 身份识别 ================= */
  function bindEvents() {
    $('#btn-code-go').onclick = doLogin;
    $('#code-input').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    $('#code-input').addEventListener('input', () => {
      const raw = $('#code-input').value.toUpperCase();
      let v;
      if (/[A-Z]/.test(raw)) {
        // 含字母 → 按虚拟编号处理，保留字母、数字、连字符
        v = raw.replace(/[^A-Z0-9-]/g, '').slice(0, 20);
      } else {
        // 全数字/X → 按身份证处理
        v = raw.replace(/[^0-9X]/g, '').slice(0, 18);
      }
      if (v !== raw) $('#code-input').value = v;
    });
    $('#btn-test-mode').onclick = () => {
      $('#code-input').value = Identity.randomTestCode();
      setLoginMsg('已填入虚拟编号「' + $('#code-input').value + '」，点「开始活动」进入', 'ok');
    };

    $('#btn-prefs-skip').onclick = () => afterPrefs(null);
    $('#btn-prefs-save').onclick = () => {
      const themes = [...$$('#theme-chips .chip.on')].map(c => c.dataset.theme);
      const fs = $('#font-seg .chip.on') ? $('#font-seg .chip.on').dataset.fs : 'normal';
      const help = $('#help-seg .chip.on') ? $('#help-seg .chip.on').dataset.help === 'yes' : false;
      afterPrefs({ themes, font_size: fs, need_help: help });
    };

    $('#btn-reco-start').onclick = () => showInstruction();
    $('#btn-reco-change').onclick = () => loadRecommendation(ctx.template ? ctx.template.id : null);

    $('#btn-practice-start').onclick = () => startPractice();

    $('#btn-exit').onclick = doExit;
    $('#btn-topbar-exit').onclick = doExit;
    $('#btn-undo').onclick = doUndo;
    $('#btn-clear').onclick = doClear;
    $('#btn-submit').onclick = doSubmit;

    $('#btn-help').onclick = () => $('#help-mask').classList.add('show');
    $('#help-close').onclick = () => $('#help-mask').classList.remove('show');
    $$('.help-opt').forEach(b => b.onclick = async () => {
      $('#help-mask').classList.remove('show');
      const type = b.dataset.help;
      if (ctx && ctx.attemptId) {
        ctx.helpUsed = (ctx.helpUsed || []).concat([type]);
        api.EventLog.add(ctx.attemptId, ctx.participant.id, ctx.phase, 'help', { type });
        saveCtx();
      }
      toast('已记录您的帮助需求，工作人员会尽快过来', 3000);
    });

    $$('#rating-row .rating-btn').forEach(b => b.onclick = async () => {
      $$('#rating-row .rating-btn').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      try {
        await api.submitFeedback(ctx.sessionId, ctx.participant.id, b.dataset.rating);
        $('#btn-finish').disabled = false;
        toast('感谢您的反馈！');
      } catch (e) {
        toast('反馈暂时没有保存成功，请再点一次', 3000);
        b.classList.remove('on');
      }
    });
    $('#btn-finish').onclick = doFinish;
  }

  function setLoginMsg(text, kind) {
    const el = $('#code-msg');
    el.textContent = text || '';
    el.className = 'login-msg' + (kind ? ' ' + kind : '');
  }

  async function doLogin() {
    if (busy) return;
    const raw = $('#code-input').value;
    if (!raw.trim()) { setLoginMsg('请先输入身份证号', 'err'); return; }

    busy = true;
    setLoginMsg('正在识别身份……');
    try {
      // 1) 解析：身份证走不可逆派生，虚拟编号原样使用
      const id = await Identity.resolve(raw);
      if (id.error) { setLoginMsg(id.error, 'err'); return; }

      // 2) 按编号找回档案；首次参与自动建档
      const res = await api.loginOrCreate(id.code, id.authType);
      const p = res.participant;
      if (!p) { setLoginMsg('身份识别失败，请稍后重试', 'err'); return; }

      ctx = {
        participant: {
          id: p.id, code: p.code, alias: p.alias,
          label: id.label, authType: id.authType,
          fontSize: 'normal'
        },
        practiceDone: false, sequenceNo: 0
      };

      // 3) 开启新会话
      const session = await api.startSession(p.id, isTablet() ? 'tablet' : 'desktop');
      ctx.sessionId = session.id;
      ctx.sessionStartedAt = Date.now();
      saveCtx();
      $('#topbar-who').textContent = id.label;
      $('#code-input').value = '';
      setLoginMsg('');

      // 4) 老参与者直接进入推荐；新参与者先填偏好
      const prefs = await api.getPreferences(p.id);
      if (prefs) {
        ctx.participant.fontSize = prefs.font_size;
        applyFontSize(prefs.font_size);
        saveCtx();
        await enterRecommend();
      } else {
        renderPrefsForm();
        showView('prefs');
      }
    } catch (e) {
      console.error(e);
      setLoginMsg('网络出现问题，请稍后再试', 'err');
    } finally {
      busy = false;
    }
  }

  function isTablet() { return window.matchMedia('(max-width: 1199px)').matches; }

  /* ================= P02 偏好 ================= */
  function renderPrefsForm() {
    const grid = $('#theme-chips');
    grid.innerHTML = '';
    THEMES.forEach(t => {
      const b = document.createElement('button');
      b.className = 'chip'; b.dataset.theme = t; b.textContent = t;
      b.onclick = () => b.classList.toggle('on');
      grid.appendChild(b);
    });
    $$('#font-seg .chip').forEach(c => c.onclick = () => {
      $$('#font-seg .chip').forEach(x => x.classList.remove('on'));
      c.classList.add('on');
      applyFontSize(c.dataset.fs);   // 立即预览
    });
    $$('#font-seg .chip')[0].classList.add('on');
    $$('#help-seg .chip').forEach(c => c.onclick = () => {
      $$('#help-seg .chip').forEach(x => x.classList.remove('on'));
      c.classList.add('on');
    });
    $$('#help-seg .chip')[0].classList.add('on');
  }

  async function afterPrefs(prefs) {
    try {
      // 用户点「跳过」也记一份默认偏好：表示已经问过，下次不再打扰，
      // 而不是每次都重新追问同一组问题。
      const payload = prefs || { themes: [], font_size: 'normal', need_help: false };
      await api.savePreferences(ctx.participant.id, payload);
      ctx.participant.fontSize = payload.font_size;
    } catch (e) { toast('偏好保存失败，不影响本次活动', 2600); }
    saveCtx();
    await enterRecommend();
  }

  /* ================= P03 推荐 ================= */
  async function enterRecommend() {
    showView('recommend');
    await loadRecommendation(null);
  }

  async function loadRecommendation(avoidId) {
    const r = await api.getRecommendation(ctx.participant.id, avoidId);
    if (!r || !r.ok) {
      toast('暂时没有可用的活动任务，请稍后再试');
      return;
    }
    ctx.template = r.template;
    ctx.recoMeta = { history_count: r.history_count, accuracy: r.accuracy, difficulty: r.difficulty };
    saveCtx();

    $('#reco-name').textContent = r.template.name;
    $('#reco-desc').textContent = r.template.description || '';
    $('#reco-items').textContent = r.template.n_items + ' 个';
    const min = Math.max(3, Math.ceil((r.template.n_items * (r.template.present_ms + 2500) + r.template.retention_ms + 90000) / 60000));
    $('#reco-time').textContent = '约 ' + min + ' 分钟';

    const h = $('#reco-history');
    if (r.history_count > 0) {
      const acc = Math.round((r.accuracy || 0) * 100);
      h.textContent = '您之前已完成 ' + r.history_count + ' 次任务，上次总体正确率约 ' + acc + '%。今天为您安排「' + difficultyName(r.difficulty) + '」难度。';
    } else {
      h.textContent = '欢迎首次参与！我们先从简单的开始。';
    }
  }

  function difficultyName(d) {
    return { easy: '入门', medium: '进阶', hard: '挑战' }[d] || d;
  }

  /* ================= P04 指导语与练习 ================= */
  function showInstruction() {
    $('#instr-text').textContent = ctx.template.instruction || '请记住依次出现的物品顺序，再按顺序点选。';
    showView('instruction');
  }

  async function startPractice() {
    ctx.practiceMode = true;
    await runAttempt({
      isPractice: true,
      nItems: Math.min(PRACTICE_ITEMS, ctx.template.n_items),
      title: ctx.template.name,
      sub: '练习 · 不计成绩'
    });
  }

  /* ================= P05 正式任务 ================= */
  async function startQuestion(seq, isRedo) {
    ctx.practiceMode = false;
    ctx.sequenceNo = seq;
    await runAttempt({
      isPractice: false,
      nItems: ctx.template.n_items,
      title: ctx.template.name,
      sub: '第 ' + seq + ' / ' + QUESTION_TOTAL + ' 题 · 顺序再现' + (isRedo ? '（重新开始）' : '')
    });
  }

  /**
   * 运行一次完整的任务尝试：建尝试 → 准备 → 逐个呈现 → 保持 → 作答 → 提交
   */
  async function runAttempt(opts) {
    const myGen = ++gen;
    busy = true;
    showView('task');
    $('#task-title').textContent = opts.title;
    $('#task-sub').textContent = opts.sub;
    $('#respond-area').style.display = 'none';
    $('#btn-help').style.display = '';
    const stage = $('#task-stage');
    stage.innerHTML = '<div class="tip">正在准备……</div>';

    // 建尝试（服务端抽样并保存呈现序列）
    let att;
    try {
      att = await api.createAttempt(
        ctx.sessionId, ctx.participant.id, ctx.template.id,
        opts.isPractice ? 0 : (ctx.sequenceNo || 1), opts.isPractice, opts.nItems);
    } catch (e) {
      toast('网络出现问题，请稍后重试或请工作人员协助', 3200);
      busy = false;
      return;
    }
    if (!att || !att.ok) {
      toast('任务材料不足或任务不可用，请工作人员检查材料组');
      busy = false;
      return;
    }

    ctx.attemptId = att.attempt_id;
    ctx.presentedItems = att.presented_items;
    ctx.nItems = att.n_items;
    ctx.presentMs = att.present_ms;
    ctx.retentionMs = att.retention_ms;
    ctx.selected = [];
    ctx.helpUsed = [];
    ctx.phase = 'prepare';
    saveCtx();
    api.EventLog.add(ctx.attemptId, ctx.participant.id, 'prepare', 'attempt_start',
      { is_practice: !!opts.isPractice, n_items: att.n_items, sequence_no: ctx.sequenceNo || 0 });

    const items = att.presented_items;

    /* --- 1. 准备 --- */
    stage.innerHTML = '<div class="tip">请准备，物品马上出现</div>';
    await waitInterruptible(1300, myGen);
    if (gen !== myGen) return;

    /* --- 2. 逐个呈现（PRESENTING：无任何操作） --- */
    ctx.phase = 'presenting'; saveCtx();
    api.EventLog.add(ctx.attemptId, ctx.participant.id, 'presenting', 'present_start', { n_items: items.length });
    banner('请仔细看，记住出现的顺序', true);

    for (let i = 0; i < items.length; i++) {
      if (gen !== myGen) return;
      stage.innerHTML =
        '<div class="pos-label">第 ' + (i + 1) + ' 个</div>' +
        '<div class="item-big">' + escapeEmoji(items[i].emoji) + '</div>' +
        '<div class="tip">' + escapeHtml(items[i].name) + '</div>';
      await waitInterruptible(att.present_ms, myGen);
    }
    if (gen !== myGen) return;
    api.EventLog.add(ctx.attemptId, ctx.participant.id, 'presenting', 'present_end', {});
    banner('物品显示完毕', false);

    /* --- 3. 保持间隔（RETENTION） --- */
    ctx.phase = 'retention'; saveCtx();
    api.EventLog.add(ctx.attemptId, ctx.participant.id, 'retention', 'retention_start', { ms: att.retention_ms });
    stage.innerHTML =
      '<div class="keep-mind">🧠 请在心里回想刚才的顺序</div>' +
      '<div class="retention-bar"><i id="ret-bar"></i></div>';
    animateBar('#ret-bar', att.retention_ms, myGen);
    await waitInterruptible(att.retention_ms, myGen);
    if (gen !== myGen) return;

    /* --- 4. 顺序再现（RESPONDING） --- */
    ctx.phase = 'responding'; saveCtx();
    api.EventLog.add(ctx.attemptId, ctx.participant.id, 'responding', 'respond_start', {});
    enterResponding(items);
    busy = false;
  }

  function waitInterruptible(ms, myGen) {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve(), ms);
      waitInterruptible._cancel = () => { clearTimeout(t); resolve(); };
    });
  }

  function animateBar(sel, ms, myGen) {
    const bar = $(sel);
    if (!bar) return;
    const t0 = performance.now();
    function step(now) {
      if (gen !== myGen) return;
      const p = Math.max(0, 1 - (now - t0) / ms);
      bar.style.width = (p * 100) + '%';
      if (p > 0) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function enterResponding(items) {
    const stage = $('#task-stage');
    stage.innerHTML = '<div class="tip">请按刚才出现的顺序，点击下方物品</div>';
    $('#respond-area').style.display = '';

    // 选项 = 呈现的物品打乱
    ctx.options = shuffle(items);
    renderSlots();
    renderGrid();
    updateActions();
  }

  function renderSlots() {
    const slots = $('#slots');
    slots.innerHTML = '';
    for (let i = 0; i < ctx.nItems; i++) {
      const s = document.createElement('div');
      s.className = 'slot' + (ctx.selected[i] ? ' filled' : '');
      const it = ctx.selected[i];
      s.innerHTML = it
        ? '<span class="em">' + escapeEmoji(it.emoji) + '</span><span class="nm">' + escapeHtml(it.name) + '</span>'
        : '<span class="no">第 ' + (i + 1) + ' 个</span>';
      slots.appendChild(s);
    }
  }

  function renderGrid() {
    const grid = $('#item-grid');
    grid.innerHTML = '';
    ctx.options.forEach((it) => {
      const b = document.createElement('button');
      b.className = 'item-card';
      // 每个物品只出现一次，已选入槽位的在网格中禁用
      b.disabled = ctx.selected.some(s => s.id === it.id);
      b.innerHTML = '<span class="em">' + escapeEmoji(it.emoji) + '</span><span>' + escapeHtml(it.name) + '</span>';
      b.onclick = () => doSelect(it);
      grid.appendChild(b);
    });
  }

  function doSelect(it) {
    if (ctx.phase !== 'responding' || ctx.selected.length >= ctx.nItems) return;
    ctx.selected.push(it);
    api.EventLog.add(ctx.attemptId, ctx.participant.id, 'responding', 'select',
      { item_id: it.id, position: ctx.selected.length });
    saveCtx();
    renderSlots();
    renderGrid();
    updateActions();
  }

  function doUndo() {
    if (ctx.phase !== 'responding' || ctx.selected.length === 0) return;
    const removed = ctx.selected.pop();
    api.EventLog.add(ctx.attemptId, ctx.participant.id, 'responding', 'undo',
      { removed_item_id: removed.id, remain: ctx.selected.length });
    saveCtx();
    renderSlots();
    renderGrid();
    updateActions();
  }

  function doClear() {
    if (ctx.phase !== 'responding' || ctx.selected.length === 0) return;
    api.EventLog.add(ctx.attemptId, ctx.participant.id, 'responding', 'clear',
      { cleared: ctx.selected.length });
    ctx.selected = [];
    saveCtx();
    renderSlots();
    renderGrid();
    updateActions();
  }

  function updateActions() {
    $('#btn-undo').disabled = ctx.selected.length === 0;
    $('#btn-clear').disabled = ctx.selected.length === 0;
    $('#btn-submit').disabled = ctx.selected.length < ctx.nItems;
  }

  async function doSubmit() {
    if (ctx.phase !== 'responding' || ctx.selected.length < ctx.nItems || busy) return;
    const ok = await confirmBox('确认提交吗？', '提交后这一题就不能再修改了。');
    if (!ok) return;
    busy = true;
    gen++; // 冻结界面计时逻辑

    api.EventLog.add(ctx.attemptId, ctx.participant.id, 'responding', 'submit',
      { response: ctx.selected.map(s => s.id) });

    let result;
    try {
      result = await api.submitAttempt(ctx.attemptId, ctx.selected, ctx.helpUsed);
    } catch (e) {
      toast('提交时网络出现问题，正在重试……', 2800);
      try { result = await api.submitAttempt(ctx.attemptId, ctx.selected, ctx.helpUsed); }
      catch (e2) {
        toast('提交失败，这一题将标记为异常，请继续下一题或找工作人员', 4200);
        await api.interruptAttempt(ctx.attemptId, 'submit_failed');
        result = null;
      }
    }

    /* --- SUBMITTED：禁止修改 --- */
    ctx.phase = 'submitted'; saveCtx();
    $('#respond-area').style.display = 'none';
    const stage = $('#task-stage');

    if (ctx.practiceMode) {
      stage.innerHTML =
        '<div style="font-size:3rem;">👏</div><div class="tip" style="font-size:1.15rem;">练习完成！正式任务马上开始</div>' +
        '<div class="hint">练习不计入正式记录</div>';
      api.EventLog.flush();
      await new Promise(r => setTimeout(r, 1800));
      ctx.practiceMode = false; ctx.practiceDone = true;
      ctx.sequenceNo = 1; saveCtx();
      await startQuestion(1);
    } else if (result && result.ok) {
      stage.innerHTML =
        '<div style="font-size:3rem;">✅</div><div class="tip" style="font-size:1.15rem;">已提交，进入下一题</div>';
      api.EventLog.flush();
      await new Promise(r => setTimeout(r, 1300));
      if (ctx.sequenceNo < QUESTION_TOTAL) {
        await startQuestion(ctx.sequenceNo + 1);
      } else {
        await enterFeedback();
      }
    } else {
      // 提交异常：跳过本题
      stage.innerHTML =
        '<div style="font-size:3rem;">⚠️</div><div class="tip">这一题记录出现异常（不影响您），继续下一题</div>';
      await new Promise(r => setTimeout(r, 1600));
      if (ctx.sequenceNo < QUESTION_TOTAL) {
        await startQuestion(ctx.sequenceNo + 1);
      } else {
        await enterFeedback();
      }
    }
    busy = false;
  }

  /* ================= P06 完成反馈 ================= */
  async function enterFeedback() {
    ctx.phase = 'feedback'; saveCtx();
    showView('feedback');
    renderFeedbackSummary();
  }

  async function renderFeedbackSummary() {
    const box = $('#fb-summary');
    try {
      const attempts = await api.sessionAttempts(ctx.sessionId);
      const formal = attempts.filter(a => !a.is_practice);
      const done = formal.filter(a => a.status === 'submitted').length;
      const pos = formal.reduce((s, a) => s + (a.positional_correct || 0), 0);
      const tot = formal.reduce((s, a) => s + (a.total_items || 0), 0);
      const elapsed = ctx.sessionStartedAt ? Math.round((Date.now() - ctx.sessionStartedAt) / 1000) : null;
      box.innerHTML =
        stat(done + ' / ' + formal.length, '完成题目') +
        stat(tot > 0 ? Math.round(pos / tot * 100) + '%' : '—', '顺序正确率') +
        stat(elapsed != null ? fmtTime(elapsed) : '—', '本次用时');
    } catch (e) {
      box.innerHTML = stat('—', '完成情况加载中');
    }
  }

  function stat(b, s) {
    return '<div class="fb-stat"><b>' + b + '</b><span>' + s + '</span></div>';
  }

  async function doFinish() {
    // 结束会话 → 冲刷日志 → 清除本机信息
    try { await api.endSession(ctx.sessionId); } catch (e) { /* 尽力而为 */ }
    try { await api.EventLog.flush(); } catch (e) { }
    const code = ctx.participant.code;
    ctx = null; saveCtx();
    sessionStorage.clear();
    applyFontSize('normal');
    $$('#rating-row .rating-btn').forEach(x => x.classList.remove('on'));
    $('#btn-finish').disabled = true;
    showView('welcome');
    $('#code-input').value = '';
    setLoginMsg('');
    toast('已安全退出，屏幕上没有保留您的信息。再见！', 3400);
  }

  /* ================= 退出 ================= */
  async function doExit() {
    const ok = await confirmBox('确定要退出吗？',
      '未完成的题目会记为中断（不算错误答案），已提交的记录都会保留。');
    if (!ok) return;
    gen++;
    if (ctx) {
      if (ctx.attemptId && ['prepare', 'presenting', 'retention', 'responding'].includes(ctx.phase)) {
        await api.interruptAttempt(ctx.attemptId, 'exit');
      }
      if (ctx.sessionId) {
        try { await api.endSession(ctx.sessionId); } catch (e) { }
      }
      try { await api.EventLog.flush(); } catch (e) { }
    }
    ctx = null; saveCtx();
    sessionStorage.clear();
    applyFontSize('normal');
    showView('welcome');
    $('#code-input').value = '';
    setLoginMsg('');
    toast('已退出活动，欢迎下次再来', 2800);
  }

  /* ================= 工具：防注入 ================= */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeEmoji(s) { return escapeHtml(s); }

  /* 页面隐藏时记录事件（不阻塞） */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && ctx && ctx.attemptId) {
      api.EventLog.add(ctx.attemptId, ctx.participant.id, ctx.phase, 'page_hidden', {});
    }
  });
  window.addEventListener('pagehide', () => {
    if (ctx && ctx.attemptId) {
      api.EventLog.add(ctx.attemptId, ctx.participant.id, ctx.phase, 'page_leave', {});
    }
  });

  init();
})();
