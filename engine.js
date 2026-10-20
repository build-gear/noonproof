/* NoonProof 계산 엔진 — 브라우저와 Node 에서 같은 코드로 돈다(기획서 숫자도 이 결과에서 나온다).
   입력: 정오보고 기록(가상), 선박 제원, CII 상수. 외부 라이브러리 없음. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const toDate = s => new Date(s + 'T12:00:00Z');
  const months = (a, b) => (toDate(b) - toDate(a)) / DAY / 30.4;
  const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };

  // 결정적 난수(부트스트랩 재현용)
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // ---------------------------------------------------------------- ① 정리: 검증 규칙
  const RULES = [
    { id: 'unit_kg', label: '주기관 연료가 하루 100t 초과 — kg 단위로 적은 것으로 보임', test: (r) => r.me_t > 100 },
    { id: 'dist_missing', label: '항해 중인데 항주 거리가 0', test: (r) => r.status === 'SEA' && r.dist_nm === 0 },
    { id: 'dist_digit', label: '거리÷항해시간이 25노트 초과 — 자릿수 오타로 보임', test: (r) => r.sea_h > 1 && r.dist_nm / r.sea_h > 25 },
    { id: 'draft_typo', label: '흘수 15m 초과 — 소수점 누락으로 보임', test: (r) => r.draft_m > 15 },
  ];
  function clean(recs) {
    const flags = [];
    const seen = new Map();
    const out = [];
    let prev = null;
    recs.forEach((r, i) => {
      const why = [];
      for (const rule of RULES) if (rule.test(r)) why.push(rule);
      if (seen.has(r.date)) why.push({ id: 'duplicate', label: '같은 날짜가 두 번 보고됨' });
      if (prev && !why.length) {
        const cons = r.me_t + r.ae_t + r.boiler_t;
        const gap = prev.rob_t - cons + (r.bunker_t || 0) - r.rob_t;
        if (Math.abs(gap) > 60) why.push({ id: 'rob_jump', label: `잔량(ROB) 연속성 어긋남 ${gap > 0 ? '+' : ''}${gap.toFixed(0)}t — 급유·소비 기록 확인 필요` });
      }
      seen.set(r.date, i);
      if (why.length) flags.push({ i, date: r.date, rec: r, reasons: why.map(w => ({ id: w.id, label: w.label })) });
      else { out.push(r); prev = r; }
    });
    return { clean: out, flags };
  }

  // ---------------------------------------------------------------- ② 기준선 모델
  // ln(주기관 연료/항해시간) = b0 + b1 ln v + b2 ln 흘수 + b3 기상 + b4 오염개월 + b5 부분청소
  function treatmentState(date, events) {
    let last = null;
    for (const e of events) if (e.date <= date) last = e;
    if (!last) return { m: 0, partial: 0 };
    return { m: months(last.date, date), partial: last.kind === 'partial' ? 1 : 0 };
  }
  const bfx = bf => Math.pow(Math.max(0, bf - 3), 1.5);
  function features(r, events) {
    const st = treatmentState(r.date, events);
    return [1, Math.log(r.speed_kn), Math.log(r.draft_m), bfx(r.bf), st.m, st.partial];
  }
  function solve(A, b) {           // 가우스 소거
    const n = b.length, M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((row, i) => row[n] / row[i]);
  }
  function ols(X, y, ridge = 1e-6) {
    const k = X[0].length, XtX = Array.from({ length: k }, () => Array(k).fill(0)), Xty = Array(k).fill(0);
    for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; }
    for (let a = 1; a < k; a++) XtX[a][a] += ridge;
    return solve(XtX, Xty);
  }
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const seaDays = recs => recs.filter(r => r.status === 'SEA' && r.sea_h >= 20 && r.speed_kn > 8 && r.me_t > 0);

  function fitBaseline(recs, events, opt = {}) {
    const S = seaDays(recs);
    const split = opt.trainUntil || null;
    const tr = split ? S.filter(r => r.date < split) : S;
    const te = split ? S.filter(r => r.date >= split) : [];
    const X = tr.map(r => features(r, events)), y = tr.map(r => Math.log(r.me_t / r.sea_h));
    const beta = ols(X, y);
    const resid = tr.map((r, i) => y[i] - dot(beta, X[i]));
    const pred = (r, ev) => Math.exp(dot(beta, features(r, ev || events))) * r.sea_h;
    const mape = arr => 100 * mean(arr.map(r => Math.abs(pred(r) - r.me_t) / r.me_t));
    const rho = lag1(resid);
    return { beta, n: tr.length, nTest: te.length, sigma: sd(resid), rho, mapeTrain: mape(tr), mapeTest: te.length ? mape(te) : null, predict: pred, resid, train: tr, test: te };
  }
  function lag1(e) { let a = 0, b = 0; for (let i = 1; i < e.length; i++) { a += e[i] * e[i - 1]; } for (const x of e) b += x * x; return b ? a / b : 0; }

  // 과거 사건 검증: 회사 기록의 청소 날짜 앞뒤로 모델이 본 연료 변화
  function eventEffect(model, events, date) {
    const before = { status: 'SEA', sea_h: 24, speed_kn: 16, draft_m: 8.8, bf: 3, date: shift(date, -1) };
    const after = { ...before, date };
    return model.predict(after) / model.predict(before) - 1;
  }
  const shift = (d, n) => new Date(toDate(d).getTime() + n * DAY).toISOString().slice(0, 10);


  // 과거 사건 검출(개입 전후 비교): 오염 항이 없는 단순 모델의 잔차가 기록된 청소 날짜 앞뒤로 얼마나 바뀌었나
  function eventStudy(recs, date, opt = {}) {
    const S = seaDays(recs), win = opt.window || 90;
    const X = S.map(r => [1, Math.log(r.speed_kn), Math.log(r.draft_m), bfx(r.bf)]), y = S.map(r => Math.log(r.me_t / r.sea_h));
    const b = ols(X, y);
    const res = S.map((r, i) => ({ date: r.date, e: y[i] - dot(b, X[i]) }));
    const pre = res.filter(x => x.date < date && x.date >= shift(date, -win)).map(x => x.e);
    const post = res.filter(x => x.date >= date && x.date < shift(date, win)).map(x => x.e);
    const R = rng(opt.seed || 5), B = opt.boot || 2000, boots = [];
    const pick = a => { const o = []; for (let k = 0; k < a.length; k++) o.push(a[Math.floor(R() * a.length)]); return o; };
    for (let k = 0; k < B; k++) boots.push(mean(pick(post)) - mean(pick(pre)));
    boots.sort((p, q) => p - q);
    const est = mean(post) - mean(pre);
    return { nPre: pre.length, nPost: post.length, effect: Math.exp(est) - 1, lo: Math.exp(boots[Math.floor(0.025 * B)]) - 1, hi: Math.exp(boots[Math.floor(0.975 * B)]) - 1 };
  }

  // 모델 기반 사건 효과의 신뢰구간(잔차 블록 부트스트랩으로 모델을 다시 맞춘다)
  function eventEffectCI(recs, events, date, opt = {}) {
    const base = fitBaseline(recs, events);
    const S = base.train, X = S.map(r => features(r, events)), fit = X.map(x => dot(base.beta, x));
    const R = rng(opt.seed || 3), B = opt.boot || 600, L = 7, effs = [];
    const eff = beta => { const a = { status: 'SEA', sea_h: 24, speed_kn: 16, draft_m: 8.8, bf: 3, date: shift(date, -1) }, b = { ...a, date };
      return Math.exp(dot(beta, features(b, events)) - dot(beta, features(a, events))) - 1; };
    for (let k = 0; k < B; k++) {
      const e = []; while (e.length < S.length) { const i = Math.floor(R() * Math.max(1, S.length - L)); for (let j = 0; j < L && e.length < S.length; j++) e.push(base.resid[i + j]); }
      effs.push(eff(ols(X, fit.map((f, i) => f + e[i]))));
    }
    effs.sort((p, q) => p - q);
    return { effect: eff(base.beta), lo: effs[Math.floor(0.025 * B)], hi: effs[Math.floor(0.975 * B)] };
  }
  // 월 단위 합계 오차(백테스트 시험 구간)
  function monthlyError(model, recs, events) {
    const g = {};
    for (const r of seaDays(recs)) { const k = r.date.slice(0, 7); (g[k] = g[k] || [0, 0]); g[k][0] += r.me_t; g[k][1] += model.predict(r, events); }
    const rows = Object.entries(g).map(([k, [a, p]]) => ({ month: k, actual: a, pred: p, err: (p - a) / a }));
    return { rows, mape: 100 * mean(rows.map(x => Math.abs(x.err))) };
  }

  // ---------------------------------------------------------------- ③ CII
  function ciiRef(cii, dwt) { return cii.ref_a * Math.pow(dwt, -cii.ref_c); }
  function ciiRequired(cii, dwt, year) { return (1 - cii.Z[year] / 100) * ciiRef(cii, dwt); }
  function grade(cii, ratio) { const d = cii.dd; return ratio < d[0] ? 'A' : ratio < d[1] ? 'B' : ratio < d[2] ? 'C' : ratio < d[3] ? 'D' : 'E'; }
  function attained(fuelT, distNm, dwt, cf) { return fuelT * cf * 1e6 / (dwt * distNm); }

  // G5(MEPC.355(78)) 냉동 컨테이너 전력 보정 — 계량기가 없을 때의 기본식: 개수 × 2.75 kW × 24 h × SFOC × 적재일, 차감 계수 (0.75 − 0.03·y), y2023 = 0
  function reeferDeduct(cii, n, year) {
    const g = cii.G5; if (!n || !g) return 0;
    const fcT = n * g.reefer_kw * 24 * g.sfoc_g_kwh * g.days / 1e6;
    return Math.max(0, g.k0 - g.k_step * (year - g.y0)) * fcT;
  }

  // 연간 예보: 최근 12개월 운항 형태를 그대로 한 해에 놓고, 사건(입거·청소·장치)을 반영해 주기관 연료를 다시 계산
  function forecast(ctx, scenario) {
    const { model, profile, events, ship, cii, years, actual } = ctx;
    const sc = Object.assign({ esd: 0, esdFrom: null, cleanEvery: 0, slowKn: 0 }, scenario || {});
    const ev = events.slice();
    if (sc.cleanEvery) {
      for (let y = 2026; y <= 2030; y++) for (const mm of ['03-01', '09-01']) { const d = `${y}-${mm}`; if (d > '2026-10-01') ev.push({ date: d, kind: 'partial' }); }
      ev.sort((a, b) => a.date < b.date ? -1 : 1);
    }
    const rows = [];
    for (const y of years) {
      let fuel = 0, dist = 0;
      for (const p of profile) {
        const md = p.date.slice(5);
        const date = `${y}-${md}`;
        if (md === '02-29') continue;
        if (actual && y === actual.year && date < actual.until) continue;   // 올해 이미 지난 날은 실제값으로
        let me;
        if (p.status === 'SEA' || p.sea_h > 0) {
          const v = Math.max(8, p.speed_kn - sc.slowKn);
          const hours = sc.slowKn ? p.sea_h * p.speed_kn / v : p.sea_h;
          const rec = { date, status: 'SEA', sea_h: hours, speed_kn: v, draft_m: p.draft_m, bf: p.bf };
          me = p.speed_kn > 8 ? Math.exp(dot(model.beta, features(rec, ev))) * hours : p.me_t;
          if (sc.esd && sc.esdFrom && date >= sc.esdFrom) me *= (1 - sc.esd);
        } else me = p.me_t;
        fuel += me + p.ae_t + p.boiler_t;
        dist += p.dist_nm;
      }
      if (actual && y === actual.year) { fuel += actual.fuel; dist += actual.dist; }
      const ded = reeferDeduct(cii, ctx.reefers || 0, y);       // G5 보정분(연료 t) — 연료 자체는 그대로, 등급 계산에서만 뺀다
      const att = attained(fuel - ded, dist, ship.dwt, cii.CF[ship.fuel]);
      const req = ciiRequired(cii, ship.dwt, y);
      rows.push({ year: y, fuel: Math.round(fuel), dist: Math.round(dist), reeferT: ded, attained: att, required: req, ratio: att / req, grade: grade(cii, att / req) });
    }
    return rows;
  }

  // ---------------------------------------------------------------- ④ 최소 검출 효과
  const Z = { 0.05: 1.96, 0.8: 0.8416 };
  function mde(model, afterSeaDays, alpha = 0.05, power = 0.8) {
    const rho = Math.max(0, model.rho);
    const neff = n => n * (1 - rho) / (1 + rho);
    const se = model.sigma * Math.sqrt(1 / neff(model.n) + 1 / neff(afterSeaDays));
    return (Z[alpha] + Z[power]) * se;      // 로그 차이 ≈ 비율
  }

  // ---------------------------------------------------------------- ⑥ 설치 후 검증 (블록 부트스트랩 신뢰구간)
  function verify(model, afterRecs, events, opt = {}) {
    const S = seaDays(afterRecs);
    const d = S.map(r => Math.log(r.me_t / model.predict(r, events)));
    const est = mean(d);
    const R = rng(opt.seed || 7), B = opt.boot || 2000, L = 7, boots = [];
    for (let b = 0; b < B; b++) {
      const s = []; while (s.length < d.length) { const i = Math.floor(R() * Math.max(1, d.length - L)); for (let k = 0; k < L && s.length < d.length; k++) s.push(d[i + k]); }
      // 모델 자체 불확실성(기준선 잔차 평균의 흔들림)도 더한다
      const tr = model.resid; const t = []; while (t.length < tr.length) { const i = Math.floor(R() * Math.max(1, tr.length - L)); for (let k = 0; k < L && t.length < tr.length; k++) t.push(tr[i + k]); }
      boots.push(mean(s) - mean(t));
    }
    boots.sort((a, b) => a - b);
    const lo = boots[Math.floor(0.025 * B)], hi = boots[Math.floor(0.975 * B)];
    const m = mde(model, S.length);
    const effect = -(Math.exp(est) - 1);
    // 판정은 95% 구간으로: 0% 를 포함하면 '판정 불가', 아니면 '효과 확인'. 검출 한계(m)는 설치 전에 검증 기간을 정하는 데 쓴다.
    const verdict = hi < 0 ? '효과 확인' : '판정 불가';
    const res = { n: S.length, effect, lo: -(Math.exp(hi) - 1), hi: -(Math.exp(lo) - 1), mde: m, verdict };
    if (opt.claim != null) res.claimOutside = opt.claim > res.hi || opt.claim < res.lo;
    return res;
  }


  // ④ 업체 곡선 × 이 배의 운항 부하 분포 → 이 배에서의 기대 효과(연료 가중)
  function esdExpectation(recs, curve, mcrKw, sfocGkWh) {
    const C = curve.slice().sort((a, b) => a.load_pct - b.load_pct);
    const at = L => { if (L <= C[0].load_pct) return C[0].saving_pct; if (L >= C[C.length - 1].load_pct) return C[C.length - 1].saving_pct;
      for (let i = 1; i < C.length; i++) if (L <= C[i].load_pct) { const a = C[i - 1], b = C[i]; return a.saving_pct + (b.saving_pct - a.saving_pct) * (L - a.load_pct) / (b.load_pct - a.load_pct); } };
    const S = seaDays(recs).map(r => { const kw = r.me_t / r.sea_h * 1e6 / sfocGkWh; const load = 100 * kw / mcrKw; return { load, eff: at(load) / 100, w: r.me_t }; });
    const W = S.reduce((s, x) => s + x.w, 0), E = S.reduce((s, x) => s + x.eff * x.w, 0) / W;
    const sorted = S.slice().sort((a, b) => a.eff - b.eff); let acc = 0; const q = {};
    for (const x of sorted) { acc += x.w / W; if (q.p25 === undefined && acc >= 0.25) q.p25 = x.eff; if (q.p75 === undefined && acc >= 0.75) q.p75 = x.eff; }
    const loads = S.map(x => x.load).sort((a, b) => a - b);
    return { expected: E, lo: q.p25, hi: q.p75, loadMedian: loads[Math.floor(loads.length / 2)], loadP10: loads[Math.floor(loads.length * 0.1)], loadP90: loads[Math.floor(loads.length * 0.9)], claim: C.reduce((m, x) => Math.max(m, x.saving_pct), 0) / 100, n: S.length };
  }

  // ---------------------------------------------------------------- 돈
  function payback(capexUsd, fuelSavedT, priceUsd) { const save = fuelSavedT * priceUsd; return { saveUsd: save, years: save > 0 ? capexUsd / save : Infinity }; }

  const API = { esdExpectation, reeferDeduct, clean, fitBaseline, eventEffect, eventEffectCI, eventStudy, monthlyError, forecast, mde, verify, payback, ciiRef, ciiRequired, grade, attained, seaDays, treatmentState, RULES, mean, sd };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.NPEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
