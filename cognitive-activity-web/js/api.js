/* 数据访问层：所有云数据库读写都经过这里 */
(function () {
  'use strict';

  let cloud = null;

  /* 优先 CDN；CDN 不可达时回退到随应用分发的本地副本，最多重试 3 次 */
  function ensureSdk() {
    return new Promise((resolve, reject) => {
      if (window.WorkBuddyCloud) return resolve();
      let tries = 0;
      const sources = [
        'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js',
        'vendor/index.global.js'
      ];
      const tryLoad = () => {
        const src = sources[tries % sources.length];
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => window.WorkBuddyCloud ? resolve() : reject(new Error('SDK 已加载但全局对象缺失'));
        s.onerror = () => {
          if (++tries < 6) setTimeout(tryLoad, 1200);
          else reject(new Error('云服务组件加载失败，请检查网络后刷新页面'));
        };
        document.head.appendChild(s);
      };
      tryLoad();
    });
  }

  async function getCloud() {
    if (cloud) return cloud;
    await ensureSdk();
    cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: window.PUBLIC_CONFIG.endpoint,
      oauthRelayBaseUrl: window.PUBLIC_CONFIG.oauthRelayBaseUrl,
      publishableKey: window.PUBLIC_CONFIG.publishableKey
    });
    return cloud;
  }

  function unwrap(res) {
    if (res.error) throw res.error;
    return res.data;
  }

  /* ---------- 事件日志（批量、去重、尽力上报） ---------- */
  const EventLog = {
    queue: [],
    flushing: false,
    add(attemptId, participantId, phase, type, detail) {
      this.queue.push({
        attempt_id: attemptId,
        participant_id: participantId,
        phase: phase || null,
        event_type: type,
        detail: detail || {},
        client_id: 'ev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
        client_ts: new Date().toISOString()
      });
      this.scheduleFlush();
    },
    scheduleFlush() {
      clearTimeout(this._t);
      this._t = setTimeout(() => this.flush(), 1200);
    },
    async flush() {
      if (this.flushing || this.queue.length === 0) return;
      this.flushing = true;
      const batch = this.queue.splice(0, this.queue.length);
      try {
        await (await getCloud()).database.from('task_events')
          .upsert(batch, { onConflict: 'client_id', ignoreDuplicates: true });
      } catch (e) {
        // 网络异常：放回队列，稍后重试
        this.queue = batch.concat(this.queue);
        this.scheduleFlush();
      } finally {
        this.flushing = false;
      }
    }
  };

  /* ---------- API ---------- */
  window.api = {
    EventLog,

    /* 参与者 */
    async participantByCode(code) {
      return unwrap(await (await getCloud()).database.from('participants')
        .select('id, code, alias, status, created_at')
        .eq('code', code.toUpperCase())
        .eq('status', 'active')
        .maybeSingle());
    },
    async createParticipant(code, alias, createdBy) {
      return unwrap(await (await getCloud()).database.from('participants')
        .insert({ code: code.toUpperCase(), alias: alias || null, created_by: createdBy || 'staff' })
        .select().single());
    },
    /* 按编号找回档案；查不到则自动建档（首次参与）。
       编号由前端派生：身份证 → 不可逆哈希；测试 → TEST-xxxx 明文。
       注意：编号有唯一约束，被停用（inactive）的档案仍占用编号，
       因此查询不区分状态；命中停用档案时重新启用，而不是重复插入。 */
    async loginOrCreate(code, authType) {
      const db = (await getCloud()).database;
      const c = String(code).toUpperCase();
      const sel = () => db.from('participants')
        .select('id, code, alias, status, created_at')
        .eq('code', c).maybeSingle();

      const reactivate = async (row) => {
        const re = unwrap(await db.from('participants')
          .update({ status: 'active' }).eq('id', row.id).select().single());
        return { participant: re, created: false, reactivated: true };
      };

      const found = unwrap(await sel());
      if (found) {
        return found.status === 'active'
          ? { participant: found, created: false }
          : await reactivate(found);
      }

      const ins = await db.from('participants')
        .insert({
          code: c,
          alias: null,
          created_by: authType === 'test' ? 'self-test' : 'self'
        })
        .select().single();

      if (ins.error) {
        // 并发建档：另一个请求刚插入同一条，回查即可
        const again = unwrap(await sel());
        if (again) {
          return again.status === 'active'
            ? { participant: again, created: false }
            : await reactivate(again);
        }
        throw ins.error;
      }
      return { participant: ins.data, created: true };
    },
    async generateParticipantCode() {
      const db = (await getCloud()).database;
      for (let i = 0; i < 12; i++) {
        const code = 'C-' + String(Math.floor(1000 + Math.random() * 9000));
        const row = unwrap(await db.from('participants').select('id').eq('code', code).maybeSingle());
        if (!row) return code;
      }
      return 'C-' + Date.now().toString().slice(-6);
    },

    /* 偏好 */
    async getPreferences(participantId) {
      return unwrap(await (await getCloud()).database.from('participant_preferences')
        .select('*').eq('participant_id', participantId).maybeSingle());
    },
    async savePreferences(participantId, prefs) {
      return unwrap(await (await getCloud()).database.from('participant_preferences')
        .upsert({
          participant_id: participantId,
          themes: prefs.themes || [],
          font_size: prefs.font_size || 'normal',
          need_help: !!prefs.need_help,
          updated_at: new Date().toISOString()
        }, { onConflict: 'participant_id' })
        .select().single());
    },

    /* 会话 */
    async startSession(participantId, device) {
      // 先清理该参与者上次可能遗留的未完成尝试（刷新/退出导致）
      try {
        await (await getCloud()).database.rpc('cleanup_stale_attempts', { p_participant_id: participantId });
      } catch (e) { /* 忽略清理失败，不阻塞流程 */ }
      return unwrap(await (await getCloud()).database.from('sessions')
        .insert({ participant_id: participantId, device: device || 'tablet' })
        .select().single());
    },
    async endSession(sessionId) {
      return unwrap(await (await getCloud()).database.from('sessions')
        .update({ status: 'completed', ended_at: new Date().toISOString() })
        .eq('id', sessionId).select().single());
    },

    /* 推荐 */
    async getRecommendation(participantId, avoidTemplateId) {
      return unwrap(await (await getCloud()).database.rpc('get_recommendation', {
        p_participant_id: participantId,
        p_avoid_template_id: avoidTemplateId == null ? null : avoidTemplateId
      }));
    },

    /* 任务尝试 */
    async createAttempt(sessionId, participantId, templateId, sequenceNo, isPractice, nItems) {
      return unwrap(await (await getCloud()).database.rpc('create_attempt', {
        p_session_id: sessionId,
        p_participant_id: participantId,
        p_template_id: templateId,
        p_sequence_no: sequenceNo,
        p_is_practice: !!isPractice,
        p_n_items: nItems == null ? null : nItems
      }));
    },
    async submitAttempt(attemptId, responseItems, helpUsed) {
      return unwrap(await (await getCloud()).database.rpc('submit_attempt', {
        p_attempt_id: attemptId,
        p_response: responseItems,
        p_help_used: helpUsed || []
      }));
    },
    async interruptAttempt(attemptId, reason) {
      if (!attemptId) return { ok: false };
      try {
        return unwrap(await (await getCloud()).database.rpc('interrupt_attempt', {
          p_attempt_id: attemptId, p_reason: reason || 'exit'
        }));
      } catch (e) { return { ok: false, error: String(e) }; }
    },

    /* 反馈 */
    async submitFeedback(sessionId, participantId, rating) {
      return unwrap(await (await getCloud()).database.from('feedback')
        .insert({ session_id: sessionId, participant_id: participantId, rating })
        .select().single());
    },

    /* 会话小结与历史 */
    async sessionAttempts(sessionId) {
      return unwrap(await (await getCloud()).database.from('task_attempts')
        .select('id, sequence_no, is_practice, status, total_items, positional_correct, item_correct, full_correct, interrupted_reason, started_at, submitted_at, template_id')
        .eq('session_id', sessionId)
        .order('id', { ascending: true }));
    },
    /* 按参与者取全部尝试（含练习与中断），用于数据核对 */
    async participantAttempts(participantId) {
      return unwrap(await (await getCloud()).database.from('task_attempts')
        .select('id, session_id, sequence_no, is_practice, status, total_items, positional_correct, item_correct, full_correct, interrupted_reason, started_at, submitted_at, template_id')
        .eq('participant_id', participantId)
        .order('id', { ascending: true }));
    },
    async historyFor(participantId, limit) {      return unwrap(await (await getCloud()).database.from('task_attempts')
        .select('id, sequence_no, status, total_items, positional_correct, item_correct, is_practice, submitted_at, interrupted_reason, template_id, template:task_templates(name, difficulty)')
        .eq('participant_id', participantId)
        .eq('is_practice', false)
        .order('id', { ascending: false })
        .limit(limit || 10));
    },

    /* ---------- 只读数据查询（数据核对用，不对外提供界面） ---------- */
    async listParticipants() {
      return unwrap(await (await getCloud()).database.from('participants')
        .select('id, code, alias, status, created_at, notes')
        .order('id', { ascending: false })
        .limit(200));
    },
    async updateParticipant(id, patch) {
      return unwrap(await (await getCloud()).database.from('participants')
        .update(patch).eq('id', id).select().single());
    },
    async participantStats(participantId) {
      return unwrap(await (await getCloud()).database.from('task_attempts')
        .select('id, status, is_practice, positional_correct, total_items, submitted_at, interrupted_reason, sequence_no, template:task_templates(name, difficulty)')
        .eq('participant_id', participantId)
        .order('id', { ascending: false })
        .limit(100));
    },
    async listTemplates() {
      return unwrap(await (await getCloud()).database.from('task_templates')
        .select('*, group:material_groups(id, name)')
        .order('id', { ascending: true }));
    },
    async createTemplate(t) {
      return unwrap(await (await getCloud()).database.from('task_templates')
        .insert(t).select().single());
    },
    async updateTemplate(id, patch) {
      return unwrap(await (await getCloud()).database.from('task_templates')
        .update(patch).eq('id', id).select().single());
    },
    async listMaterials() {
      return unwrap(await (await getCloud()).database.from('materials')
        .select('*').eq('status', 'active').order('id', { ascending: true }));
    },
    async createMaterial(m) {
      return unwrap(await (await getCloud()).database.from('materials')
        .insert(m).select().single());
    },
    async updateMaterial(id, patch) {
      return unwrap(await (await getCloud()).database.from('materials')
        .update(patch).eq('id', id).select().single());
    },
    async deleteMaterial(id) {
      return unwrap(await (await getCloud()).database.from('materials')
        .update({ status: 'disabled' }).eq('id', id).select().single());
    },
    async listGroups() {
      return unwrap(await (await getCloud()).database.from('material_groups')
        .select('*').order('id', { ascending: true }));
    },
    async createGroup(g) {
      return unwrap(await (await getCloud()).database.from('material_groups')
        .insert(g).select().single());
    },
    async updateGroup(id, patch) {
      return unwrap(await (await getCloud()).database.from('material_groups')
        .update(patch).eq('id', id).select().single());
    },
    async listSessionsToday() {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      return unwrap(await (await getCloud()).database.from('sessions')
        .select('id, participant_id, device, status, started_at, ended_at, participant:participants(code, alias)')
        .gte('started_at', since.toISOString())
        .order('id', { ascending: false })
        .limit(100));
    },
    async listAttempts(filters) {
      let q = (await getCloud()).database.from('task_attempts')
        .select('id, session_id, participant_id, sequence_no, is_practice, status, total_items, positional_correct, item_correct, full_correct, help_used, interrupted_reason, started_at, submitted_at, template_id, template:task_templates(name, difficulty), participant:participants(code, alias)')
        .order('id', { ascending: false })
        .limit(200);
      if (filters) {
        if (filters.status) q = q.eq('status', filters.status);
        if (filters.since) q = q.gte('started_at', filters.since);
        if (filters.participantCode) q = q.like('participant.code', ''); // 占位：参与者在嵌套里，改在前端过滤
      }
      return unwrap(await q);
    },
    async listEvents(attemptId) {
      return unwrap(await (await getCloud()).database.from('task_events')
        .select('id, phase, event_type, detail, client_ts, created_at')
        .eq('attempt_id', attemptId)
        .order('id', { ascending: true })
        .limit(500));
    },
    async attemptById(id) {
      return unwrap(await (await getCloud()).database.from('task_attempts')
        .select('*, template:task_templates(name, difficulty), participant:participants(code, alias)')
        .eq('id', id).single());
    }
  };
})();
