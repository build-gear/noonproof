/* NoonProof 프로토타입 — 7단계 사용자 흐름(기획서 2.3 과 같은 번호). 모든 데이터는 가상. */
(function () {
  'use strict';
  const E = window.NPEngine, C = window.NPCharts, SP = window.NP_SPEC, NOON = window.NP_NOON, AIX = window.NP_AI_EXTRACT, MEMO = window.NP_AI_MEMO;
  const esc = C.esc;
  const CII = Object.assign({}, SP.CII, { Z: Object.fromEntries(Object.entries(SP.CII.Z).map(([k, v]) => [+k, v])) });
  const SHIP = SP.SHIP, EVENTS = SP.EVENTS, PAST = EVENTS.filter(e => e.date <= '2026-10-01');
  const pct = (x, d = 1) => (100 * x).toFixed(d) + '%';
  const num = (x, d = 0) => Number(x).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const gchip = g => `<span class="grade g-${g}">${g}</span>`;
  const ai = (t = 'AI 처리') => `<span class="ai-chip">${t}</span>`;

  // ---------------------------------------------------------------- 계산 (페이지가 직접)
  const cleaned = E.clean(NOON.hist);
  const model = E.fitBaseline(cleaned.clean, EVENTS);
  const bt = E.fitBaseline(cleaned.clean, EVENTS, { trainUntil: '2026-04-01' });
  const monthly = E.monthlyError(bt, bt.test, EVENTS);
  const cleanCI = E.eventEffectCI(cleaned.clean, PAST, '2025-06-14');
  const curve = AIX.out.vendor_curve;
  const esd = E.esdExpectation(cleaned.clean, curve.curve, SHIP.mcr_kw, SHIP.sfoc_g_kwh);
  const last12 = cleaned.clean.filter(r => r.date >= '2025-10-01' && r.date < '2026-10-01');
  const act26 = cleaned.clean.filter(r => r.date >= '2026-01-01' && r.date < '2026-10-01');
  const sum = (a, f) => a.reduce((s, r) => s + f(r), 0);
  const actual = { year: 2026, until: '2026-10-01', fuel: sum(act26, r => r.me_t + r.ae_t + r.boiler_t), dist: sum(act26, r => r.dist_nm) };
  const ctx = { model, profile: last12, events: EVENTS, ship: SHIP, cii: CII, years: [2026, 2027, 2028, 2029, 2030], actual };
  const yr25 = cleaned.clean.filter(r => r.date.startsWith('2025'));
  const fuel25 = sum(yr25, r => r.me_t + r.ae_t + r.boiler_t), dist25 = sum(yr25, r => r.dist_nm);
  const req25 = E.ciiRequired(CII, SHIP.dwt, 2025);
  let att25, base;   // G5 냉동 컨테이너 보정(선택)에 따라 다시 계산
  function recalc() { ctx.reefers = S.reefers || 0; att25 = E.attained(fuel25 - E.reeferDeduct(CII, ctx.reefers, 2025), dist25, SHIP.dwt, CII.CF[SHIP.fuel]); base = E.forecast(ctx, {}); }
  const claimV = AIX.out.vendor_curve.claim_max_pct / 100;
  const after3 = E.verify(model, NOON.after.filter(r => r.date < '2027-03-01'), EVENTS, { seed: 11, claim: claimV });
  const after6 = E.verify(model, NOON.after.filter(r => r.date < '2027-06-01'), EVENTS, { seed: 11, claim: claimV });
  const after12 = E.verify(model, NOON.after, EVENTS, { seed: 11, claim: claimV });
  const mde6 = E.mde(model, E.seaDays(NOON.after.filter(r => r.date < '2027-06-01')).length);
  const price = SP.PRICES.fuel_usd_t, capex = curve.price_usd || 150000;
  const priceNote = `연료 ${num(price)}달러/t · ${SP.PRICES.fuel_src}`;

  const S = { step: 0, msg: 0, ok: {}, tg: { clean: false, esd: true, slow: 0 }, reefers: 0 };
  try { const s = JSON.parse(localStorage.getItem('np_state') || 'null'); if (s && typeof s.step === 'number') Object.assign(S, s); } catch (e) {}
  const save = () => { try { localStorage.setItem('np_state', JSON.stringify(S)); } catch (e) {} };

  const STEPS = [
    { t: '정오보고 정리', s: '메일·엑셀·메신저 → 표준 기록', h: '매일 오는 정오보고를 표준 기록으로', render: step1 },
    { t: '연료 기준선', s: '이 배의 연료 지문', h: '이 배가 같은 조건에서 쓰는 연료의 기준선', render: step2 },
    { t: 'CII 등급 예보', s: '2026~2030', h: '', render: step3 },
    { t: '감축 수단 비교', s: '우리 배에서도 6%일까?', h: '업체 주장 “최대 6%”, 이 배에서는?', render: step4 },
    { t: '투자 메모·금융 근거', s: 'AI 초안 + 숫자 대조', h: '기술팀장에게 올릴 투자 메모와 금융 근거 자료 초안', render: step5 },
    { t: '설치 후 검증', s: '최소 검출 효과·95% 구간', h: '', render: step6 },
    { t: '선대 학습', s: '자매선·해양정보', h: '검증된 효과를 자매선의 사전 추정으로', render: step7 },
  ];

  // ---------------------------------------------------------------- ① 정오보고 정리
  function step1() {
    const keys = ['noon_email', 'noon_excel', 'noon_msg'];
    const labels = [['선장 메일', 'MASTER → OPS/TECH · 영문 정형'], ['엑셀 내보내기', '해무팀 시트 · 단위 섞임'], ['기관장 메신저', '사내 메신저 · 한국어 자유 문장']];
    const k = keys[S.msg], o = AIX.out[k];
    const F = [['보고일', o.date], ['상태', o.status], ['항해 시간', o.sea_hours != null ? o.sea_hours + ' h' : '—'], ['항주 거리', o.distance_nm != null ? num(o.distance_nm) + ' NM' : '— (누락)'],
      ['평균 속력', o.avg_speed_kn != null ? o.avg_speed_kn + ' kn' : '—'], ['주기관 연료', o.me_fuel_t != null ? o.me_fuel_t + ' t' : '—'], ['발전기 연료', o.ae_fuel_t + ' t'], ['보일러', o.boiler_fuel_t + ' t'],
      ['연료 잔량(ROB)', o.rob_t + ' t'], ['평균 흘수', o.mean_draft_m + ' m'], ['풍력(BF)', o.wind_bf]];
    const rules = {}; for (const f of cleaned.flags) for (const r of f.reasons) rules[r.id] = (rules[r.id] || 0) + 1;
    const ruleName = { unit_kg: '단위(kg) 의심', dist_missing: '거리 누락', dist_digit: '거리 자릿수', draft_typo: '흘수 오타', rob_jump: '잔량 연속성', duplicate: '중복 날짜' };
    return `
    <p class="lead">배마다 매일 정오에 보내는 보고는 형식이 제각각입니다. NoonProof 가 <b>메일·엑셀·메신저 원문을 그대로 받아 표준 항목으로 옮기고</b>, 단위 변환·누락·계산한 값을 표시해 해무 담당자가 확인만 하게 합니다.</p>
    <div class="flow mt"><div class="st on"><b><span class="n">1</span>받기</b>메일함·공유 폴더</div><div class="st on"><b><span class="n">2</span>AI 추출</b>표준 11개 항목</div><div class="st on"><b><span class="n">3</span>규칙 점검</b>단위·누락·연속성</div><div class="st"><b><span class="n">4</span>사람 확인</b>확인 요청만</div><div class="st"><b><span class="n">5</span>기록</b>기준선 모델로</div></div>
    <div class="row r12 mt">
      <div class="card"><h3>오늘 받은 보고 <span class="sm muted">예시 3건</span></h3>
        <div class="msgs">${labels.map((l, i) => `<div class="m ${i === S.msg ? 'on' : ''}" data-msg="${i}"><b>${l[0]}</b><div>${l[1]}</div></div>`).join('')}</div>
        <div class="raw">${esc(AIX.raw[k])}</div></div>
      <div class="card"><h3>표준 기록 ${ai('AI 추출')}</h3>
        <table class="tb fld">${F.map(([a, b]) => `<tr><td>${a}</td><td class="v">${esc(b)}</td></tr>`).join('')}</table>
        ${o.issues.map(i => `<div class="issue ${i.kind}"><b>${{ unit_converted: '단위 변환', derived: '계산한 값', missing: '누락', suspicious: '확인 필요' }[i.kind]}</b> · ${esc(i.note)}</div>`).join('')}
        <div class="approve">${S.ok.s1 ? '<span class="approved">✓ 해무 담당 확인 완료</span>' : '<button class="btn ok" data-ok="s1">확인하고 기록에 넣기</button><span class="note">AI 는 값을 지어내지 않고, 없는 값은 비워 둡니다.</span>'}</div>
      </div>
    </div>
    <div class="row r21 mt">
      <div class="card"><h3>지난 24개월 일괄 정리 <span class="sm muted">${num(NOON.hist.length)}건</span></h3>
        <div class="tbl-scroll"><table class="tb"><tr><th>날짜</th><th>항목</th><th>확인 요청 이유</th><th></th></tr>
        ${cleaned.flags.map(f => `<tr><td>${f.date}</td><td>${f.reasons.map(r => ruleName[r.id]).join(', ')}</td><td class="sm">${f.reasons.map(r => esc(r.label)).join(' · ')}</td><td><span class="badge b-amb">확인</span></td></tr>`).join('')}
        </table></div></div>
      <div class="grid">
        <div class="card kpi"><div class="l">자동 정리</div><div class="v">${num(NOON.hist.length - cleaned.flags.length)}<small>건</small></div><div class="sm muted">사람 확인 없이 기록</div></div>
        <div class="card kpi"><div class="l">확인 요청</div><div class="v">${cleaned.flags.length}<small>건</small></div><div class="sm muted">${Object.entries(rules).map(([k, n]) => `${ruleName[k]} ${n}`).join(' · ')}</div></div>
        <div class="callout2 good">가상 데이터에 일부러 심은 보고 실수 ${NOON.hist.filter(r => r.anomaly_truth).length}건을 모두 확인 요청으로 올렸고, 정상 기록을 잘못 올린 건은 ${cleaned.flags.filter(f => !f.rec.anomaly_truth).length}건입니다.</div>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- ② 연료 기준선
  function step2() {
    const Sd = E.seaDays(cleaned.clean);
    const pts = Sd.map(r => ({ x: r.speed_kn, y: r.me_t / r.sea_h * 24, c: E.treatmentState(r.date, PAST).partial ? '#0f8b8d' : '#1d5fa7' }));
    const line = (m, partial, c) => { const pts2 = []; for (let v = 14; v <= 17.8; v += 0.2) { const rec = { date: partial ? '2025-12-01' : '2025-03-01', status: 'SEA', sea_h: 24, speed_kn: v, draft_m: 8.7, bf: 4 }; pts2.push([v, m.predict(rec, PAST)]); } return { pts: pts2, c, w: 2.6 }; };
    const b = model.beta;
    return `
    <p class="lead">이미 쌓인 정오보고만으로 <b>속력·흘수·기상·선체 오염 기간을 넣으면 주기관 연료가 얼마인지</b> 알려 주는 이 배만의 기준선을 만듭니다. 센서를 새로 달지 않습니다.</p>
    <div class="row r32">
      <div class="card"><h3>항해일 ${Sd.length}일 · 속력과 주기관 연료 <span class="sm muted">점 = 하루 정오보고</span></h3>
        ${C.scatter({ x0: 14, x1: 18, y0: 16, y1: 44, points: pts, lines: [line(model, 0, '#17202a'), line(model, 1, '#0f8b8d')], xlab: '평균 속력 (노트)', ylab: '주기관 연료 (t/일)', w: 640, h: 320 })}
        <div class="legend2"><span><i class="dot" style="background:#1d5fa7"></i>2024-10 ~ 2025-06 (입거 뒤 7~15개월)</span><span><i class="dot" style="background:#0f8b8d"></i>2025-06 수중 청소 뒤</span><span><i style="background:#17202a"></i>기준선(청소 전, BF 4·흘수 8.7m)</span><span><i style="background:#0f8b8d"></i>기준선(청소 뒤)</span></div>
      </div>
      <div class="grid" style="align-content:start">
        <div class="card"><h3>시험 성적 <span class="sm muted">18개월 학습 → 6개월 맞히기</span></h3>
          <div class="row r2"><div class="kpi"><div class="l">하루 단위 오차</div><div class="v">${bt.mapeTest.toFixed(1)}<small>%</small></div></div><div class="kpi"><div class="l">월 합계 오차</div><div class="v">${monthly.mape.toFixed(1)}<small>%</small></div></div></div>
          <div class="note">하루 오차에는 정오보고 자체의 측정·기록 오차가 들어 있습니다. CII·연료비처럼 한 해를 합하는 계산은 월 합계 오차가 기준입니다.</div></div>
        <div class="card"><h3>회사 기록으로 시험 <span class="human-chip">과거 사건</span></h3>
          <div style="font-size:13.5px;color:var(--ink2)">2025-06-14 <b>수중 선체 청소·프로펠러 연마</b> 앞뒤로 모델이 본 연료 변화</div>
          <div class="verdict ok" style="margin-top:6px">${pct(cleanCI.effect)}</div>
          <div class="sm muted">95% 구간 ${pct(cleanCI.lo)} ~ ${pct(cleanCI.hi)}</div>
          <div class="note" style="margin-top:6px">이미 아는 개선을 이 데이터로 잡아낼 수 있는지가 PoC 첫 시험입니다.</div></div>
        <div class="card"><h3>이 배의 연료 지문</h3>
          <table class="tb"><tr><td>속력 지수</td><td><b>${b[1].toFixed(2)}</b> <span class="sm muted">(이론값 3 근처)</span></td></tr>
          <tr><td>흘수 지수</td><td><b>${b[2].toFixed(2)}</b></td></tr><tr><td>선체 오염</td><td><b>+${(100 * b[4]).toFixed(2)}%</b> / 월</td></tr><tr><td>잔차 표준편차</td><td><b>${pct(model.sigma)}</b></td></tr></table>
          <div class="approve">${S.ok.s2 ? '<span class="approved">✓ 해무 담당 승인</span>' : '<button class="btn ok" data-ok="s2">기준선 승인</button>'}</div></div>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- ③ CII 예보
  function ciiChart(rowsList, colors, dashes, w = 640) {
    const years = [2025, 2026, 2027, 2028, 2029, 2030];
    const req = years.map(y => E.ciiRequired(CII, SHIP.dwt, y));
    const lines = rowsList.map((rows, k) => ({ vals: [att25, ...rows.map(r => r.attained)], c: colors[k], dash: dashes[k] }));
    const firstD = rowsList[0].find(r => r.grade === 'D' || r.grade === 'E');
    const notes = firstD ? [{ i: years.indexOf(firstD.year), v: firstD.attained, t: `${firstD.year} ${firstD.grade} 진입` }] : [];
    return C.ciiBands({ years, req, dd: CII.dd, y0: 10.5, y1: 16.5, lines, split: 0.9, notes, w, h: 300 });
  }
  function step3() {
    const firstD = base.find(r => r.grade === 'D' || r.grade === 'E');
    const consecutive = base.filter(r => r.grade === 'D').length;
    STEPS[2].h = firstD ? `${firstD.year}년, 이 배는 CII ${firstD.grade}등급으로 떨어집니다` : '2030년까지 C 이상 유지';
    return `
    <p class="lead">연 1회 DCS 보고 때가 아니라 <b>지금</b> 압니다. 최근 12개월 운항 형태와 예정된 입거(2026-11, 2029-03)를 넣고, IMO 기준선·감축률·등급 경계로 2030년까지 등급을 예보합니다.</p>
    <div class="row r32">
      <div class="card"><h3>연간 CII 예보 <span class="sm muted">gCO₂/dwt·nm · 띠 = 등급 경계(해마다 강화)</span></h3>
        ${ciiChart([base], ['#17202a'], [false])}
        <div class="legend2"><span><i style="background:#17202a"></i>현 상태 유지(정기 입거 때 일반 도장만)</span><span>2025 = 정오보고 합계(가상 실적)</span></div></div>
      <div class="grid" style="align-content:start">
        <div class="callout2 ${consecutive >= 3 ? 'bad' : 'warn'}"><b>현 상태 유지 시 ${base.filter(r => r.grade === 'D').map(r => r.year).join('·')} D${consecutive >= 3 ? ` ${consecutive}년 → 시정계획(SEEMP Part III) 대상` : ''}</b><br>2027년부터 감축률이 ${CII.Z[2026]}% → ${CII.Z[2027]}% 로 오르고(IMO MEPC.400(83)), 2030년 ${CII.Z[2030]}% 까지 매년 강화됩니다.</div>
        <div class="card"><table class="tb"><tr><th>연도</th><th>달성</th><th>요구</th><th>비율</th><th>등급</th></tr>
          <tr><td>2025 <span class="sm muted">실적</span></td><td>${att25.toFixed(2)}</td><td>${req25.toFixed(2)}</td><td>${(att25 / req25).toFixed(3)}</td><td>${gchip(E.grade(CII, att25 / req25))}</td></tr>
          ${base.map(r => `<tr><td>${r.year}${r.year === 2026 ? ' <span class="sm muted">1~9월 실적</span>' : ''}</td><td>${r.attained.toFixed(2)}</td><td>${r.required.toFixed(2)}</td><td>${r.ratio.toFixed(3)}</td><td>${gchip(r.grade)}</td></tr>`).join('')}</table>
          <div class="note">달성 CII = Σ(연료×CO₂ 환산계수) ÷ (DWT×항해거리). 등급 경계(컨테이너선) A<${CII.dd[0]} · B<${CII.dd[1]} · C<${CII.dd[2]} · D<${CII.dd[3]} · E (달성÷요구).<br>상수: 기준선 a=${CII.ref_a}·c=${CII.ref_c}(MEPC.353(78)) · 감축률(MEPC.338(76)·400(83)) · 등급 경계(MEPC.354(78)) · CO₂ 계수 ${CII.CF[SHIP.fuel]}(MEPC.364(79), 연료 수급서의 ISO 8217 등급 RME~RMK) — IMO 원문 대조 2026-10-20.</div></div>
        <div class="card"><h3>IMO G5 보정 <span class="sm muted">냉동 컨테이너 전력 · MEPC.355(78)</span></h3>
          <div class="seg">${[0, 50, 100].map(v => `<button data-reef="${v}" class="${(S.reefers || 0) === v ? 'on' : ''}">${v ? '평균 ' + v + '개' : '보정 전'}</button>`).join('')}</div>
          <div class="note" style="margin-top:6px">${S.reefers ? `냉동 컨테이너 ${S.reefers}개의 전력분 연료에 차감 계수를 곱한 양(2026년 ${num(base[0].reeferT)} t)을 등급 계산에서 뺍니다. 연료 소비 자체는 그대로입니다.` : '기본 예보는 보정 전 값입니다 — 보정하면 달성 CII 가 낮아지므로 보수적인 예보입니다.'} 계량기가 없을 때의 IMO 기본식: 1개 ${CII.G5.reefer_kw} kW · 4행정 발전기 기본값 ${CII.G5.sfoc_g_kwh} g/kWh(기술파일이 없을 때) · 차감 계수 (0.75 − 0.03·y), 연 ${CII.G5.days}일 적재 가정.</div></div>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- ④ 감축 수단
  function scenarioFromToggles() {
    return { cleanEvery: S.tg.clean ? 6 : 0, esd: S.tg.esd ? esd.expected : 0, esdFrom: '2026-11-20', slowKn: S.tg.slow };
  }
  function step4() {
    const sc = E.forecast(ctx, scenarioFromToggles());
    const vendor = E.forecast(ctx, { esd: curve.claim_max_pct / 100, esdFrom: '2026-11-20' });
    const fuel27 = rows => rows.find(r => r.year === 2027).fuel;
    const saved = fuel27(base) - fuel27(sc);
    const esdOnly = fuel27(base) - fuel27(E.forecast(ctx, { esd: esd.expected, esdFrom: '2026-11-20' }));
    const pb = esdOnly > 0 ? capex / (esdOnly * price) : Infinity;
    // 부하 분포
    const loads = E.seaDays(cleaned.clean).map(r => 100 * (r.me_t / r.sea_h * 1e6 / SHIP.sfoc_g_kwh) / SHIP.mcr_kw);
    const bins = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75], hist = bins.map((b, i) => loads.filter(l => l >= b && l < (bins[i + 1] || 999)).length);
    const allC = sc.every(r => r.grade <= 'C');
    return `
    <p class="lead">업체 제안서는 <b>“연료 최대 ${curve.claim_max_pct}% 절감”</b>을 말합니다. NoonProof 는 제안서에서 부하별 절감 곡선을 읽어 <b>이 배가 실제로 도는 부하</b>에 맞춰 다시 계산하고, 설치 뒤 그 효과를 이 배의 데이터로 가려낼 수 있는지까지 미리 봅니다.</p>
    <div class="row r3">
      <div class="card"><h3>제안서 판독 ${ai('AI 추출')}</h3>
        <div class="sm muted" style="margin-bottom:6px">${esc(curve.device)}</div>
        <table class="tb"><tr><th>주기관 부하</th><th>업체 절감률</th></tr>${curve.curve.slice().sort((a, b) => b.load_pct - a.load_pct).map(p => `<tr><td>${p.load_pct}% MCR</td><td>${p.saving_pct}%</td></tr>`).join('')}</table>
        <div class="issue missing" style="margin-top:8px"><b>조건</b> · ${curve.conditions.map(esc).join(' · ')}</div></div>
      <div class="card"><h3>이 배의 부하 분포 <span class="sm muted">항해일 ${loads.length}일</span></h3>
        ${C.bars({ vals: hist, labels: bins.map(b => b + ''), xlab: '주기관 부하 (% MCR)', colors: bins.map(b => b >= 40 && b < 65 ? '#0f8b8d' : '#9aa6b2') })}
        <div class="note">중앙값 ${esd.loadMedian.toFixed(0)}% MCR(하위 10% ${esd.loadP10.toFixed(0)}% · 상위 10% ${esd.loadP90.toFixed(0)}%). 저속 운항이라 업체 곡선의 높은 부하 구간을 거의 쓰지 않습니다.</div></div>
      <div class="card"><h3>답: 이 배에서는</h3>
        <div class="verdict mid">${pct(esd.expected)}</div><div class="sm muted">부하 분포 중간 50%: ${pct(esd.lo)} ~ ${pct(esd.hi)} · 업체 “최대 ${curve.claim_max_pct}%”</div>
        <div class="callout2 mt"><b>검증 가능성</b> · 이 배의 정오보고로 가려낼 수 있는 최소 효과는 설치 뒤 6개월이면 <b>${pct(mde6)}</b>, 12개월이면 <b>${pct(after12.mde)}</b>. 기대 효과가 이보다 크므로 <b>6개월부터 가려낼 수 있고, 계절을 한 바퀴 담는 12개월에 최종 판정</b>합니다.</div></div>
    </div>
    <div class="row r12 mt">
      <div class="card"><h3>수단 고르기 <span class="sm muted">고르면 오른쪽 예보가 다시 계산됩니다</span></h3>
        <div class="toggles">
          <label class="${S.tg.clean ? 'on' : ''}"><input type="checkbox" data-tg="clean" ${S.tg.clean ? 'checked' : ''}> 수중 선체 청소·프로펠러 연마 연 2회</label>
          <label class="${S.tg.esd ? 'on' : ''}"><input type="checkbox" data-tg="esd" ${S.tg.esd ? 'checked' : ''}> 추진 보조 장치 설치(2026-11 입거) — 이 배 기대 ${pct(esd.expected)}</label>
          <label class="${S.tg.slow ? 'on' : ''}">운항 속력 줄이기 <span class="seg">${[0, 0.5, 1].map(v => `<button data-slow="${v}" class="${S.tg.slow === v ? 'on' : ''}">${v ? '−' + v + '노트' : '그대로'}</button>`).join('')}</span></label>
        </div>
        <div class="note">감속은 연료·배출이 줄지만 항차가 길어져 기항 일정·투입 선박 수를 바꿔야 할 수 있습니다(운항팀 판단).</div>
        <table class="tb mt"><tr><td>2027년 연료 절감</td><td><b>${num(saved)} t</b> (약 ${num(saved * price / 1000)}천 달러)</td></tr>
          <tr><td>장치만의 회수 기간</td><td><b>${isFinite(pb) ? pb.toFixed(1) + '년' : '—'}</b> <span class="sm muted">설치비 ${num(capex)}달러(제안서) · ${priceNote}</span></td></tr></table></div>
      <div class="card"><h3>등급 예보 비교 <span class="sm muted">검정 = 현 상태 · 청록 = 고른 조합 · 파랑 점선 = 업체 주장 그대로</span></h3>
        ${ciiChart([sc, base, vendor], ['#0f8b8d', '#17202a', '#1d5fa7'], [false, false, true])}
        <table class="tb"><tr><th></th>${sc.map(r => `<th>${r.year}</th>`).join('')}</tr>
          <tr><td>현 상태</td>${base.map(r => `<td>${gchip(r.grade)}</td>`).join('')}</tr>
          <tr><td><b>고른 조합</b></td>${sc.map(r => `<td>${gchip(r.grade)} <span class="sm muted">${r.ratio.toFixed(3)}</span></td>`).join('')}</tr>
          <tr><td>업체 주장대로라면</td>${vendor.map(r => `<td>${gchip(r.grade)}</td>`).join('')}</tr></table>
        <div class="callout2 ${allC ? 'good' : 'warn'} mt">${allC ? '고른 조합이면 2030년까지 C 이상을 지킵니다.' : `고른 조합으로는 ${sc.filter(r => r.grade > 'C').map(r => r.year).join('·')}년이 D 이하입니다.${S.tg.esd && !S.tg.clean && !S.tg.slow ? ' 장치 하나로는 2030년까지 등급을 지키기 어렵습니다.' : ''}`}</div></div>
    </div>`;
  }

  // ---------------------------------------------------------------- ⑤ 투자 메모
  function step5() {
    const m = MEMO.out, ck = MEMO.check;
    return `
    <p class="lead">계산 결과를 <b>사실 카드</b>로 만들어 생성형 AI 에 주고, 기술팀장에게 올릴 메모를 쓰게 합니다. 문장마다 근거 카드 번호를 달고, <b>문장 속 숫자가 카드와 하나라도 다르면 다시 쓰게 하거나 버립니다</b>.</p>
    <div class="row r32">
      <div class="card"><h3>${esc(m.title)} ${ai('AI 생성')} <span class="check">✓ 숫자 대조 ${ck.ok}/${ck.ok + ck.bad} 문장 일치</span></h3>
        <div class="memo">${m.sections.map(sec => `<h4>${esc(sec.name)}</h4>${sec.sentences.map(s => `<p>${esc(s.text)}${s.facts.map(f => `<span class="fact">${f}</span>`).join('')}</p>`).join('')}`).join('')}</div>
        <div class="approve">${S.ok.s5 ? '<span class="approved">✓ 기술팀장 검토 완료</span>' : '<button class="btn ok" data-ok="s5">기술팀장 검토 완료</button>'}<span class="note">AI 생성 문서는 화면과 출력물에 ‘AI 생성’을 표시합니다.</span></div></div>
      <div class="grid" style="align-content:start">
        <div class="card"><h3>사실 카드 <span class="sm muted">엔진 계산 결과에서만 만듦</span></h3>
          <div class="tbl-scroll" style="max-height:260px"><table class="tb">${Object.entries(MEMO.facts).map(([k, v]) => `<tr><td><span class="fact" style="font-size:11px">${k}</span></td><td class="sm">${esc(v)}</td></tr>`).join('')}</table></div></div>
        <div class="card"><h3>KOBC 친환경 설비개량 금융 — 근거 자료 초안 ${ai('AI 정리')}</h3>
          <ol class="pkt">
            <li><b>선박</b> HB-07 · 1,700TEU 피더 · 2009년식 · DWT ${num(SHIP.dwt)}</li>
            <li><b>현재 등급과 예보</b> 2025 ${E.grade(CII, att25 / req25)} → 현 상태 유지 시 ${base.map(r => r.year + ' ' + r.grade).join(' · ')}</li>
            <li><b>대상 설비</b> ${esc(curve.device)} · ${num(capex)}달러</li>
            <li><b>기대 효과와 근거</b> 이 배 부하 분포 기준 ${pct(esd.expected)}(부하 분포 중간 50%: ${pct(esd.lo)}~${pct(esd.hi)}) · 업체 주장 최대 ${curve.claim_max_pct}%</li>
            <li><b>검증 계획</b> 설치 뒤 12개월 정오보고로 판정(최소 검출 효과 ${pct(after12.mde)})</li>
            <li><b>회수 기간</b> 약 ${(capex / ((E.forecast(ctx, {}).find(r => r.year === 2027).fuel - E.forecast(ctx, { esd: esd.expected, esdFrom: '2026-11-20' }).find(r => r.year === 2027).fuel) * price)).toFixed(1)}년(${priceNote})</li>
            <li><b>신청 경로</b> 친환경설비 개량 이차보전·특별보증 — 대상 설비에 ESD 포함, 설치 자금 80% 이내 대출·6년 보증, 대출 이자 일부(2% 이내) 보전 <span class="sm muted">(KOBC 사업 안내 · 보도자료 2025-07-16)</span></li>
          </ol>
          <div class="callout2 warn">금융 지원 여부는 <b>KOBC 심사역이 판단</b>합니다. 이 자료는 근거를 정리할 뿐 점수·추천을 내지 않습니다(대출 심사에 AI 가 결정을 내리지 않음).</div></div>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- ⑥ 설치 후 검증
  function step6() {
    const Sd = E.seaDays(NOON.after);
    const d = Sd.map(r => 100 * (r.me_t / model.predict(r, EVENTS) - 1));
    const roll = d.map((_, i) => { const a = d.slice(Math.max(0, i - 14), i + 1); return a.reduce((s, x) => s + x, 0) / a.length; });
    const vd = v => v.verdict === '효과 확인' ? 'ok' : 'no';
    const claim = curve.claim_max_pct / 100;
    const inside = after12.lo <= esd.expected && esd.expected <= after12.hi;
    STEPS[5].h = `설치 12개월 실측 ${pct(after12.effect)} — 업체 주장 ${curve.claim_max_pct}%는 구간 밖, 이 배 기대 ${pct(esd.expected)}는 구간 ${inside ? '안' : '밖'}`;
    const i3 = Sd.findIndex(r => r.date >= '2027-03-01'), i6 = Sd.findIndex(r => r.date >= '2027-06-01');
    const card = (t, v, note) => `
        <div class="card"><h3>${t} <span class="sm muted">항해일 ${v.n}일 · 최소 검출 효과 ${pct(v.mde)}</span></h3>
          <div class="verdict ${vd(v)}">${v.verdict}</div>
          <div style="font-size:14px;margin-top:4px">절감 <b>${pct(v.effect)}</b> <span class="sm muted">95% 구간 ${pct(v.lo)} ~ ${pct(v.hi)}</span></div>
          <div class="note" style="margin-top:6px">${note}</div></div>`;
    return `
    <p class="lead"><b>가상 시나리오</b> · 2026-11 입거 때 장치를 달았다고 놓고, 설치 뒤 12개월 가상 정오보고로 검증합니다. 기준선이 ‘장치가 없었다면 썼을 연료’를 계산하고, 실제와의 차이를 <b>95% 구간</b>과 함께 냅니다. 구간이 0% 를 포함하면 ‘판정 불가’입니다. 입거 청소 효과는 기준선의 오염 항으로 나눕니다.</p>
    <div class="row r32">
      <div class="card"><h3>실제 ÷ 기준선 − 1 <span class="sm muted">점 = 항해일 · 선 = 15일 평균</span></h3>
        ${C.series({ n: d.length, y0: -16, y1: 12, points: d.map((v, i) => ({ i, v })), lines: [{ vals: roll, c: '#0f8b8d', w: 2.6 }],
          hlines: [{ v: 0, c: '#6b7785', t: '장치 없음' }, { v: -100 * claim, c: '#c0392b', dash: true, t: '업체 주장 −' + curve.claim_max_pct + '%' }, { v: -100 * esd.expected, c: '#1d5fa7', dash: true, t: '이 배 기대 −' + pct(esd.expected) }],
          vlines: [i3 > 0 ? { i: i3, t: '3개월' } : null, i6 > 0 ? { i: i6, t: '6개월' } : null].filter(Boolean), yfmt: v => v + '%', xt: [{ i: 0, t: '2026-12' }, { i: Math.max(0, i6), t: '2027-06' }, { i: d.length - 1, t: '2027-11' }] })}
        <div class="callout2 mt">설치 <b>전에</b> 정한 검증 계획: 이 배의 기대 효과 ${pct(esd.expected)} 가 6개월 최소 검출 효과 ${pct(mde6)} 보다 크므로 6개월에 중간 점검, 계절을 한 바퀴 담는 <b>12개월 뒤 최종 판정</b>.</div>
      </div>
      <div class="grid" style="align-content:start">
        ${card('설치 뒤 3개월', after3, '구간이 0% 를 포함 — 아직 효과를 말할 수 없습니다. 기간을 늘립니다.')}
        ${card('설치 뒤 6개월 · 중간 점검', after6, `효과는 있지만 구간이 넓습니다(최소 검출 효과는 미리 정한 설계값, 판정은 95% 구간). 업체 주장 ${curve.claim_max_pct}%는 ${after6.claimOutside ? '구간 밖' : '구간 안'}.`)}
        ${card('설치 뒤 12개월 · 최종 판정', after12, `업체 주장 ${curve.claim_max_pct}%는 ${after12.claimOutside ? '구간 밖' : '아직 배제할 수 없음'} · 이 배 기대 ${pct(esd.expected)}는 구간 ${inside ? '안' : '밖'}(실측÷기대 ${(after12.effect / esd.expected).toFixed(2)}).`)}
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- ⑦ 선대 학습
  function step7() {
    const ratio = after12.effect / esd.expected;
    const sis = [{ c: 'HB-03', load: 49, exp: 0.034 }, { c: 'HB-11', load: 55, exp: 0.038 }];
    return `
    <p class="lead">한 척에서 검증한 효과는 회사의 자산이 됩니다. 같은 장치의 <b>업체 곡선 기대치 × 실측 보정</b>으로 자매선의 기대 효과를 다시 계산하고, 익명 집계는 해양정보 허브의 ‘장치 유형별 실측 절감’ 자료가 될 수 있습니다.</p>
    <div class="row r2">
      <div class="card"><h3>자매선 사전 추정 <span class="sm muted">실측 보정 ${ratio.toFixed(2)}(구간 ${(after12.lo / esd.expected).toFixed(2)}~${(after12.hi / esd.expected).toFixed(2)}) 적용</span></h3>
        <table class="tb"><tr><th>선박</th><th>부하 중앙값</th><th>업체 곡선 기대</th><th>실측 보정 뒤</th></tr>
        <tr><td><b>HB-07</b> <span class="badge b-grn">검증</span></td><td>${esd.loadMedian.toFixed(0)}% MCR</td><td>${pct(esd.expected)}</td><td><b>${pct(after12.effect)}</b> (실측)</td></tr>
        ${sis.map(s => `<tr><td>${s.c}</td><td>${s.load}% MCR</td><td>${pct(s.exp)}</td><td><b>${pct(s.exp * ratio)}</b></td></tr>`).join('')}</table>
        <div class="note">자매선 값은 시연용 가상 값입니다. PoC 2단계에서 자매선 정오보고로 같은 계산을 합니다.</div></div>
      <div class="card"><h3>다음 단계(PoC 이후)</h3>
        <ol class="pkt"><li><b>자매선 대조</b> 장치를 달지 않은 자매선을 대조군으로 입거 청소 효과와 장치 효과를 더 정확히 나눕니다.</li>
        <li><b>금융·컨설팅 연계</b> KOBC One-Stop 통합지원(금융·친환경 컨설팅)과 함께, 선사마다 한 척씩 같은 흐름을 돌립니다.</li>
        <li><b>익명 집계</b> 선사·선박을 지운 ‘장치 유형 × 부하 구간 × 실측 절감’ 표 — 다음 투자 판단과 금융 검토의 공통 근거.</li>
        <li><b>데이터 보호</b> 연료 자료는 영업 비밀이므로 회사 승인 없이는 밖으로 나가지 않습니다.</li></ol></div>
    </div>`;
  }

  // ---------------------------------------------------------------- 틀
  function render() {
    recalc();
    const st = STEPS[S.step];
    const html = st.render();
    document.getElementById('nav').innerHTML = '<div class="sec">사용자 흐름</div>' + STEPS.map((x, i) => `<a data-step="${i}" class="${i === S.step ? 'on' : ''} ${i < S.step ? 'done' : ''}"><span class="no">${i + 1}</span><span>${x.t}<small>${x.s}</small></span></a>`).join('');
    document.getElementById('crumb').textContent = `${S.step + 1} / ${STEPS.length} · ${st.t}`;
    document.getElementById('title').textContent = st.h;
    document.getElementById('topr').innerHTML = `<span class="badge b-gry">가상 데이터</span><span class="badge b-blu">브라우저에서 계산</span>`;
    document.getElementById('view').innerHTML = html;
    document.getElementById('pos').textContent = `기획서 2.3 사용자 흐름 ${S.step + 1}단계`;
    document.getElementById('prev').disabled = S.step === 0;
    document.getElementById('next').textContent = S.step === STEPS.length - 1 ? '처음으로 ↺' : '다음 단계 →';
    save();
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-step],[data-msg],[data-ok],[data-slow],[data-reef]');
    if (t) {
      if (t.dataset.step) S.step = +t.dataset.step;
      if (t.dataset.msg) S.msg = +t.dataset.msg;
      if (t.dataset.ok) S.ok[t.dataset.ok] = true;
      if (t.dataset.slow) S.tg.slow = +t.dataset.slow;
      if (t.dataset.reef !== undefined) S.reefers = +t.dataset.reef;
      render(); if (t.dataset.step) window.scrollTo(0, 0); return;
    }
    if (e.target.id === 'prev' && S.step > 0) { S.step--; render(); window.scrollTo(0, 0); }
    if (e.target.id === 'next') { S.step = S.step === STEPS.length - 1 ? 0 : S.step + 1; render(); window.scrollTo(0, 0); }
  });
  document.addEventListener('change', e => { if (e.target.dataset.tg) { S.tg[e.target.dataset.tg] = e.target.checked; render(); } });
  const q = new URLSearchParams(location.search).get('step'); if (q) S.step = Math.max(0, Math.min(STEPS.length - 1, +q - 1));
  render();
})();
