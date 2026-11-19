/* 身份识别：身份证号校验与不可逆编号派生
 *
 * 设计要点
 * 1. 系统不保存身份证号原文，只保存由它派生出的编号（64 位十六进制）。
 * 2. 派生必须是确定性的（同一身份证号每次得到同一编号），否则无法找回历史记录。
 * 3. 用 PBKDF2-HMAC-SHA256 反复迭代抬高暴力枚举成本；不支持的旧环境退回内置 SHA-256 迭代。
 * 4. 测试演示使用 TEST- 前缀的虚拟编号，不经过派生，明文保存，便于清理。
 */
(function () {
  'use strict';

  const SALT = 'cog-activity-idcard-v1';
  const ITERATIONS = 210000;     // PBKDF2 迭代次数
  const FALLBACK_ROUNDS = 20000; // 无 WebCrypto 时的迭代轮数

  /* ---------------- 身份证校验（GB 11643-1999） ---------------- */
  const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

  function checkIdCard(id) {
    if (!/^[0-9]{17}[0-9X]$/.test(id)) return false;
    // 出生日期合法性
    const y = +id.slice(6, 10), m = +id.slice(10, 12), d = +id.slice(12, 14);
    if (y < 1900 || y > new Date().getFullYear()) return false;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
    // 校验位
    let sum = 0;
    for (let i = 0; i < 17; i++) sum += (+id[i]) * WEIGHTS[i];
    return CHECK[sum % 11] === id[17];
  }

  /* ---------------- 输入判别 ---------------- */
  /* 返回 { type:'idcard'|'test', value } 或 { error:'...' } */
  function classify(raw) {
    const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!s) return { error: '请输入身份证号' };

    // 纯数字或 17 位数字开头：一律按身份证处理，避免把写错的身份证当成测试编号
    if (/^[0-9]+$/.test(s) || /^[0-9]{17}X$/.test(s)) {
      if (s.length !== 18) return { error: '身份证号应为 18 位，您输入了 ' + s.length + ' 位' };
      if (!checkIdCard(s)) return { error: '身份证号校验不通过，请核对后重新输入' };
      return { type: 'idcard', value: s };
    }

    // 虚拟编号：4–20 位，由字母/数字/连字符组成，且必须含字母（防止与身份证混淆）
    if (/^[A-Z0-9-]{4,20}$/.test(s) && /[A-Z]/.test(s)) {
      return { type: 'test', value: s };
    }

    if (s.length === 18) return { error: '身份证号校验不通过，请核对后重新输入' };
    return { error: '请输入 18 位身份证号' };
  }

  /* ---------------- SHA-256（兜底实现，仅在无 WebCrypto 时使用） ---------------- */
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256Bytes(bytes) {
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = bytes.length;
    const withPad = new Uint8Array((((l + 9) >> 6) + 1) << 6);
    withPad.set(bytes);
    withPad[l] = 0x80;
    const bitLen = l * 8;
    const dv = new DataView(withPad.buffer);
    dv.setUint32(withPad.length - 4, bitLen >>> 0);
    dv.setUint32(withPad.length - 8, Math.floor(bitLen / 4294967296));

    const w = new Uint32Array(64);
    for (let off = 0; off < withPad.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    H.forEach((v, i) => odv.setUint32(i * 4, v));
    return out;
  }
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function toHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s.toUpperCase();
  }

  /* ---------------- 派生编号 ---------------- */
  const enc = new TextEncoder();

  async function deriveIdCode(idNo) {
    // 优先 WebCrypto：PBKDF2-HMAC-SHA256
    if (window.crypto && window.crypto.subtle && window.crypto.subtle.importKey) {
      try {
        const key = await crypto.subtle.importKey(
          'raw', enc.encode(idNo), { name: 'PBKDF2' }, false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits({
          name: 'PBKDF2',
          salt: enc.encode(SALT),
          iterations: ITERATIONS,
          hash: 'SHA-256'
        }, key, 256);
        return 'ID-' + toHex(new Uint8Array(bits)).slice(0, 32);
      } catch (e) { /* 落到兜底 */ }
    }
    // 兜底：salt + 号码 反复做 SHA-256
    let digest = sha256Bytes(enc.encode(SALT + '|' + idNo));
    for (let i = 0; i < FALLBACK_ROUNDS; i++) {
      const buf = new Uint8Array(digest.length + 1);
      buf.set(digest);
      buf[digest.length] = i & 0xff;
      digest = sha256Bytes(buf);
    }
    return 'ID-' + toHex(digest).slice(0, 32);
  }

  /* ---------------- 对外 ---------------- */
  window.Identity = {
    checkIdCard,
    classify,
    deriveIdCode,

    /* 把用户输入解析成可直接入库的 { code, authType, label } */
    async resolve(raw) {
      const r = classify(raw);
      if (r.error) return r;
      if (r.type === 'test') {
        return { code: r.value, authType: 'test', label: '测试编号 ' + r.value, tail: null };
      }
      const code = await deriveIdCode(r.value);
      const tail = r.value.slice(-4);
      return { code, authType: 'idcard', label: '身份证尾号 ' + tail, tail };
    },

    /* 生成一个随机的虚拟编号，供测试演示使用 */
    randomTestCode() {
      const n = Math.floor(1000 + Math.random() * 9000);
      return 'TEST-' + n;
    }
  };
})();
