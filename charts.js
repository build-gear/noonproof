/* 작은 SVG 차트 도우미 — 외부 라이브러리 없음 */
(function (root) {
  'use strict';
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function frame(w, h, pad) { return { w, h, L: pad[0], R: pad[1], T: pad[2], B: pad[3] }; }
  function scale(d0, d1, r0, r1) { return v => r0 + (v - d0) / (d1 - d0) * (r1 - r0); }
  function ticks(a, b, n) { const step = niceStep((b - a) / n); const t = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) t.push(+v.toFixed(6)); return t; }
  function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))); const m = x / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }
  function axes(F, xs, ys, xt, yt, opt) {
    let s = '';
    for (const v of yt) s += `<line x1="${F.L}" x2="${F.w - F.R}" y1="${ys(v)}" y2="${ys(v)}" stroke="#eef1f4"/><text x="${F.L - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="11" fill="#6b7785">${opt.yfmt ? opt.yfmt(v) : v}</text>`;
    for (const v of xt) s += `<text x="${xs(v)}" y="${F.h - F.B + 16}" text-anchor="middle" font-size="11" fill="#6b7785">${opt.xfmt ? opt.xfmt(v) : v}</text>`;
    if (opt.xlab) s += `<text x="${(F.L + F.w - F.R) / 2}" y="${F.h - 2}" text-anchor="middle" font-size="11.5" fill="#3d4a57">${esc(opt.xlab)}</text>`;
    if (opt.ylab) s += `<text x="12" y="${(F.T + F.h - F.B) / 2}" text-anchor="middle" font-size="11.5" fill="#3d4a57" transform="rotate(-90 12 ${(F.T + F.h - F.B) / 2})">${esc(opt.ylab)}</text>`;
    return s;
  }
  // 산점도 + 선
  function scatter(o) {
    const F = frame(o.w || 620, o.h || 300, [52, 14, 12, 38]);
    const xs = scale(o.x0, o.x1, F.L, F.w - F.R), ys = scale(o.y0, o.y1, F.h - F.B, F.T);
    let s = axes(F, xs, ys, ticks(o.x0, o.x1, 6), ticks(o.y0, o.y1, 5), o);
    for (const p of o.points) s += `<circle cx="${xs(p.x).toFixed(1)}" cy="${ys(p.y).toFixed(1)}" r="${p.r || 3.2}" fill="${p.c || '#1d5fa7'}" fill-opacity="${p.o || 0.55}"/>`;
    for (const ln of (o.lines || [])) s += `<polyline fill="none" stroke="${ln.c}" stroke-width="${ln.w || 2.4}" ${ln.dash ? 'stroke-dasharray="6 5"' : ''} points="${ln.pts.map(p => xs(p[0]).toFixed(1) + ',' + ys(p[1]).toFixed(1)).join(' ')}"/>`;
    return `<svg viewBox="0 0 ${F.w} ${F.h}" width="100%">${s}</svg>`;
  }
  // CII 띠 차트
  function ciiBands(o) {
    const F = frame(o.w || 640, o.h || 300, [46, 34, 12, 30]);
    const yrs = o.years, xs = i => F.L + i * (F.w - F.L - F.R) / (yrs.length - 1), ys = scale(o.y0, o.y1, F.h - F.B, F.T);
    const col = ['#dff3e6', '#eef7d9', '#fbf6dc', '#fde9d3', '#fbdcd7'], lab = ['A', 'B', 'C', 'D', 'E'];
    let s = '';
    for (let k = 0; k < 5; k++) {
      const top = [], bot = [];
      yrs.forEach((y, i) => { const req = o.req[i]; const lo = k === 0 ? o.y0 : req * o.dd[k - 1], hi = k === 4 ? o.y1 : req * o.dd[k];
        top.push([xs(i), ys(Math.min(hi, o.y1))]); bot.push([xs(i), ys(Math.max(lo, o.y0))]); });
      s += `<polygon fill="${col[k]}" points="${top.map(p => p.join(',')).join(' ')} ${bot.reverse().map(p => p.join(',')).join(' ')}"/>`;
      const i = yrs.length - 1, req = o.req[i], lo = k === 0 ? o.y0 : req * o.dd[k - 1], hi = k === 4 ? o.y1 : req * o.dd[k];
      if (hi > o.y0 + 0.35) s += `<text x="${F.w - F.R + 16}" y="${ys((Math.max(lo, o.y0) + Math.min(hi, o.y1)) / 2) + 4}" text-anchor="middle" font-size="12" font-weight="800" fill="#6b7785">${lab[k]}</text>`;
    }
    for (const v of ticks(o.y0, o.y1, 5)) s += `<text x="${F.L - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="11" fill="#6b7785">${v.toFixed(1)}</text>`;
    yrs.forEach((y, i) => s += `<text x="${xs(i)}" y="${F.h - 10}" text-anchor="middle" font-size="11.5" fill="#3d4a57">${y}</text>`);
    if (o.split != null) s += `<line x1="${xs(o.split)}" x2="${xs(o.split)}" y1="${F.T}" y2="${F.h - F.B}" stroke="#9aa6b2" stroke-dasharray="3 4"/><text x="${xs(o.split) + 5}" y="${F.T + 12}" font-size="11" fill="#6b7785">예보 →</text>`;
    for (const ln of o.lines) {
      const pts = ln.vals.map((v, i) => v == null ? null : [xs(i), ys(v)]).filter(Boolean);
      s += `<polyline fill="none" stroke="${ln.c}" stroke-width="${ln.w || 2.6}" ${ln.dash ? 'stroke-dasharray="6 5"' : ''} points="${pts.map(p => p.join(',')).join(' ')}"/>` + pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.2" fill="${ln.c}"/>`).join('');
    }
    for (const n of (o.notes || [])) { const last = n.i >= yrs.length - 1; s += `<text x="${xs(n.i) + (last ? -6 : (n.dx || 6))}" y="${ys(n.v) + (n.dy || -9)}" text-anchor="${last ? 'end' : 'start'}" font-size="12" font-weight="800" fill="${n.c || '#c0392b'}" paint-order="stroke" stroke="#fff" stroke-width="3.5" stroke-linejoin="round">${esc(n.t)}</text>`; }
    return `<svg viewBox="0 0 ${F.w} ${F.h}" width="100%">${s}</svg>`;
  }
  // 막대(히스토그램)
  function bars(o) {
    const F = frame(o.w || 420, o.h || 200, [36, 10, 10, 34]);
    const n = o.vals.length, bw = (F.w - F.L - F.R) / n, max = Math.max(...o.vals) || 1, ys = scale(0, max, F.h - F.B, F.T);
    let s = '';
    o.vals.forEach((v, i) => { s += `<rect x="${F.L + i * bw + 1}" y="${ys(v)}" width="${bw - 2}" height="${F.h - F.B - ys(v)}" rx="2" fill="${o.colors ? o.colors[i] : '#1d5fa7'}" fill-opacity=".8"/>`; });
    o.labels.forEach((t, i) => { if (t !== '') s += `<text x="${F.L + i * bw + bw / 2}" y="${F.h - F.B + 14}" text-anchor="middle" font-size="10.5" fill="#6b7785">${esc(t)}</text>`; });
    if (o.xlab) s += `<text x="${(F.L + F.w - F.R) / 2}" y="${F.h - 3}" text-anchor="middle" font-size="11" fill="#3d4a57">${esc(o.xlab)}</text>`;
    return `<svg viewBox="0 0 ${F.w} ${F.h}" width="100%">${s}</svg>`;
  }
  // 시계열(잔차 등)
  function series(o) {
    const F = frame(o.w || 640, o.h || 240, [46, 12, 12, 30]);
    const xs = scale(0, o.n - 1, F.L, F.w - F.R), ys = scale(o.y0, o.y1, F.h - F.B, F.T);
    let s = '';
    for (const v of ticks(o.y0, o.y1, 4)) s += `<line x1="${F.L}" x2="${F.w - F.R}" y1="${ys(v)}" y2="${ys(v)}" stroke="#eef1f4"/><text x="${F.L - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="11" fill="#6b7785">${o.yfmt ? o.yfmt(v) : v}</text>`;
    if (o.band) s += `<rect x="${F.L}" width="${F.w - F.L - F.R}" y="${ys(o.band[1])}" height="${ys(o.band[0]) - ys(o.band[1])}" fill="${o.bandColor || '#e8f0fa'}"/>`;
    for (const h of (o.hlines || [])) s += `<line x1="${F.L}" x2="${F.w - F.R}" y1="${ys(h.v)}" y2="${ys(h.v)}" stroke="${h.c}" stroke-width="1.5" ${h.dash ? 'stroke-dasharray="5 4"' : ''}/><text x="${F.w - F.R - 4}" y="${ys(h.v) - 5}" text-anchor="end" font-size="11" fill="${h.c}" paint-order="stroke" stroke="#fff" stroke-width="3.5" stroke-linejoin="round">${esc(h.t || '')}</text>`;
    for (const v of (o.vlines || [])) s += `<line x1="${xs(v.i)}" x2="${xs(v.i)}" y1="${F.T}" y2="${F.h - F.B}" stroke="${v.c || '#9aa6b2'}" stroke-dasharray="3 4"/><text x="${xs(v.i) + 4}" y="${F.T + 12}" font-size="11" fill="#6b7785">${esc(v.t || '')}</text>`;
    for (const p of (o.points || [])) s += `<circle cx="${xs(p.i)}" cy="${ys(Math.max(o.y0, Math.min(o.y1, p.v)))}" r="2.4" fill="${p.c || '#9aa6b2'}" fill-opacity=".6"/>`;
    for (const ln of (o.lines || [])) s += `<polyline fill="none" stroke="${ln.c}" stroke-width="${ln.w || 2.4}" points="${ln.vals.map((v, i) => v == null ? '' : xs(ln.x ? ln.x[i] : i).toFixed(1) + ',' + ys(v).toFixed(1)).filter(Boolean).join(' ')}"/>`;
    for (const t of (o.xt || [])) s += `<text x="${xs(t.i)}" y="${F.h - 10}" text-anchor="${t.i >= o.n - 1 ? 'end' : t.i <= 0 ? 'start' : 'middle'}" font-size="11" fill="#6b7785">${esc(t.t)}</text>`;
    return `<svg viewBox="0 0 ${F.w} ${F.h}" width="100%">${s}</svg>`;
  }
  root.NPCharts = { scatter, ciiBands, bars, series, esc };
})(window);
