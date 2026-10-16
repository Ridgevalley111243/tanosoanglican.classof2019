import { h, s, cedis, cedisShort, monthLabel, monthShort } from './ui.js';

// Paid vs still-owed dues per month, as stacked columns.
// Two series, so: a legend, a hover tooltip per column, and a table view.
export function duesChart(rows) {
  // Size the drawing to the screen so 11px labels stay 11px on a phone.
  const W = Math.round(Math.min(640, Math.max(300, window.innerWidth - 80)));
  const H = 220, pad = { t: 12, r: 8, b: 26, l: 52 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const max = Math.max(1, ...rows.map((r) => Number(r.paid) + Number(r.unpaid)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = (v) => pad.t + ih - (v / top) * ih;
  const band = iw / Math.max(rows.length, 1);
  const bw = Math.min(24, band * 0.6);
  const GAP = 2;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Dues paid and still owed for each month' });
  const grid = s('g', { class: 'grid' });
  const axis = s('g', { class: 'axis' });
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
    axis.append(s('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, cedisShort(v)));
  }
  svg.append(grid, axis);

  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'chart-tip', hidden: true });

  rows.forEach((r, i) => {
    const paid = Number(r.paid), owed = Number(r.unpaid);
    const cx = pad.l + band * i + band / 2;
    const x = cx - bw / 2;
    const col = s('g', { class: 'col' });
    // Paid sits on the baseline; owed stacks above it after a 2px surface gap.
    const paidTop = y(paid);
    const owedTop = y(paid + owed);
    if (paid > 0) col.append(bar(x, paidTop, bw, y(0) - paidTop, owed > 0 ? 0 : 4, 'var(--chart-paid)'));
    if (owed > 0) col.append(bar(x, owedTop, bw, Math.max(0, paidTop - owedTop - (paid > 0 ? GAP : 0)), 4, 'var(--chart-owed)'));
    axis.append(s('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, monthShort(r.period)));

    // Hit target is the whole band, taller than the mark.
    const hit = s('rect', { class: 'hit', x: pad.l + band * i, y: pad.t, width: band, height: ih });
    const show = () => {
      col.classList.add('active');
      tip.replaceChildren(
        h('b', {}, monthLabel(r.period)),
        h('div', { class: 'r' }, h('span', {}, h('i', { class: 'key paid' }), ' Paid'), h('span', { class: 'num' }, cedis(paid))),
        h('div', { class: 'r' }, h('span', {}, h('i', { class: 'key owed' }), ' Still owed'), h('span', { class: 'num' }, cedis(owed))));
      tip.hidden = false;
      const box = wrap.getBoundingClientRect();
      const px = (cx / W) * box.width;
      tip.style.left = `${Math.min(Math.max(px - 80, 0), box.width - 170)}px`;
      tip.style.top = `${Math.max(0, (owedTop / H) * box.height - 84)}px`;
    };
    const hide = () => { col.classList.remove('active'); tip.hidden = true; };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('click', show);
    svg.append(col, hit);
  });

  svg.append(s('line', { class: 'baseline', x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0) }));
  wrap.append(svg, tip);

  return h('div', {},
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'key paid' }), 'Paid (confirmed)'),
      h('span', {}, h('i', { class: 'key owed' }), 'Still owed')),
    wrap,
    h('details', { class: 'table-view' }, h('summary', {}, 'Show as a table'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Month'), h('th', { class: 'r' }, 'Paid'), h('th', { class: 'r' }, 'Still owed'))),
        h('tbody', {}, rows.map((r) => h('tr', {},
          h('td', {}, monthLabel(r.period)), h('td', { class: 'r num' }, cedis(r.paid)), h('td', { class: 'r num' }, cedis(r.unpaid)))))))));
}

// A column with only its data end rounded; square where it meets the baseline or the gap.
function bar(x, y, w, hgt, r, fill) {
  if (hgt <= 0) return s('g');
  const rr = Math.min(r, hgt, w / 2);
  const d = `M${x},${y + hgt} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + hgt} Z`;
  return s('path', { d, fill });
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
