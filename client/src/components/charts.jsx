// Small SVG chart kit (no chart library): single-series column chart, horizontal stacked bar and
// horizontal bar list. Thin marks with 4px rounded data-ends square at the baseline, 2px surface
// gaps, solid hairline grid, per-mark hover / keyboard-focus tooltips (values lead), a selective
// direct label, and a table-view twin for every chart. Colours come from the validated categorical
// slots defined as CSS custom properties (.viz-root in styles.css), light & dark.
import { useLayoutEffect, useRef, useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { cx } from './ui';

/** ₹ compact in Indian units: 950 · 12K · 1.5L · 2.1Cr */
export function compactInr(n, symbol = true) {
  const v = Math.abs(Number(n) || 0);
  const s = v >= 1e7 ? +(v / 1e7).toFixed(v >= 1e8 ? 0 : 1) + 'Cr' : v >= 1e5 ? +(v / 1e5).toFixed(v >= 1e6 ? 0 : 1) + 'L' : v >= 1e3 ? +(v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'K' : String(Math.round(v));
  return (n < 0 ? '−' : '') + (symbol ? '₹' : '') + s;
}

function niceTicks(max, count = 4, integer = false) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  if (integer) step = Math.max(1, Math.ceil(step));
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width)));
    ro.observe(ref.current);
    setW(Math.max(240, ref.current.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** rounded top (data end) + square baseline */
function colPath(x, y, w, h, r = 4) {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
/** rounded right end (data end) + square left */
function barPath(x, y, w, h, r = 4, roundEnd = true) {
  if (w <= 0) return '';
  const rr = roundEnd ? Math.min(r, h / 2, w) : 0;
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div className="viz-tip pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-line bg-surface px-2.5 py-2 text-[12px] shadow-pop" style={{ left: tip.x, top: tip.y, transform: tip.flip ? 'translate(-100%, -100%)' : 'translate(0, -100%)' }}>
      <div className="mb-1 text-[11px] text-muted">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          {r.color && <span className="inline-block h-[3px] w-3 shrink-0 rounded-full" style={{ background: r.color }} />}
          <span className="font-bold text-ink">{r.value}</span>
          <span className="text-muted">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Card shell with the chart / table toggle (the accessible twin). */
export function ChartFrame({ title, subtitle, legend, table, children, actions }) {
  const [mode, setMode] = useState('chart');
  return (
    <figure className="viz-root card min-w-0 p-4">
      <figcaption className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-[15px] font-bold text-ink">{title}</div>
          {subtitle && <div className="text-[12px] text-muted">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-1.5">
          {actions}
          {table && (
            <div className="inline-flex rounded-lg border border-line bg-surface2 p-0.5" role="group" aria-label="Chart or table view">
              <button type="button" onClick={() => setMode('chart')} className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold', mode === 'chart' ? 'bg-surface text-ink shadow-sm' : 'text-muted')}><BarChart3 className="h-3.5 w-3.5" />Chart</button>
              <button type="button" onClick={() => setMode('table')} className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold', mode === 'table' ? 'bg-surface text-ink shadow-sm' : 'text-muted')}><Table2 className="h-3.5 w-3.5" />Table</button>
            </div>
          )}
        </div>
      </figcaption>
      {legend && mode === 'chart' && <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">{legend.map((l) => <span key={l.label} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />{l.label}</span>)}</div>}
      {mode === 'chart' ? children : table}
    </figure>
  );
}

export function DataTable({ columns, rows }) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-line">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 bg-surface2"><tr>{columns.map((c) => <th key={c.label} className={cx('px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-muted', c.num && 'text-right')}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line/70">{columns.map((c) => <td key={c.label} className={cx('px-3 py-1', c.num && 'text-right tnum')}>{c.get(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/**
 * Vertical columns, one series. data: [{ key, label (x tick), title (tooltip heading), value, rows?: [{label,value}] }]
 * format: value → string (axis & labels). highlight: index of the column to label at its cap (default: max).
 */
export function ColumnChart({ data, height = 200, format = (v) => String(v), tickFormat, ariaLabel, color = 'var(--series-1)', integer = false }) {
  const [ref, w] = useWidth();
  const [tip, setTip] = useState(null);
  const [hover, setHover] = useState(-1);
  const padL = 44;
  const padR = 8;
  const padT = 18;
  const padB = 24;
  const plotW = w - padL - padR;
  const plotH = height - padT - padB;
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max, 4, integer);
  const top = ticks[ticks.length - 1] || 1;
  const slot = plotW / Math.max(1, data.length);
  const bw = Math.max(2, Math.min(24, slot - 2));
  const y = (v) => padT + plotH - (v / top) * plotH;
  const maxIdx = data.reduce((bi, d, i) => (d.value > (data[bi] ? data[bi].value : -Infinity) ? i : bi), 0);
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 34))));
  const show = (i) => {
    const d = data[i];
    const x = padL + i * slot + slot / 2;
    setHover(i);
    setTip({ x: x + (x > w * 0.7 ? -8 : 8), y: Math.max(28, y(d.value) - 6), flip: x > w * 0.7, title: d.title || d.label, rows: d.rows || [{ label: '', value: format(d.value), color }] });
  };
  return (
    <div ref={ref} className="relative w-full" onMouseLeave={() => { setTip(null); setHover(-1); }}>
      <svg width={w} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth="1" shapeRendering="crispEdges" />
            <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[color:var(--viz-muted)] text-[10.5px] tnum">{(tickFormat || format)(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          const h = Math.max(0, (d.value / top) * plotH);
          return (
            <g key={d.key}>
              <path d={colPath(x, y(d.value), bw, h)} fill={color} opacity={hover >= 0 && hover !== i ? 0.55 : 1} />
              {i === maxIdx && d.value > 0 && <text x={x + bw / 2} y={y(d.value) - 5} textAnchor="middle" className="fill-[color:var(--viz-text)] text-[10.5px] font-semibold">{format(d.value)}</text>}
              {i % every === 0 && <text x={padL + i * slot + slot / 2} y={height - 6} textAnchor="middle" className="fill-[color:var(--viz-muted)] text-[10.5px]">{d.label}</text>}
              <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" tabIndex={0} aria-label={(d.title || d.label) + ': ' + format(d.value)}
                onMouseEnter={() => show(i)} onFocus={() => show(i)} onBlur={() => { setTip(null); setHover(-1); }} className="cursor-default outline-none focus:stroke-[color:var(--viz-axis)]" />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/**
 * Horizontal stacked bars. rows: [{ key, label, parts: [n, n], total?, sub? }]; series: [{ name, color }]
 * The total is labelled outside the bar end; segments separated by a 2px surface gap.
 */
export function StackedBarH({ rows, series, format = (v) => String(v), rowHeight = 34, ariaLabel }) {
  const [ref, w] = useWidth();
  const [tip, setTip] = useState(null);
  const labelW = Math.min(170, Math.max(110, w * 0.26));
  const valueW = 70;
  const plotW = w - labelW - valueW - 8;
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((s, v) => s + Math.max(0, v), 0)));
  const bh = Math.min(20, rowHeight - 12);
  const height = rows.length * rowHeight + 4;
  const show = (r, i) => {
    const total = r.parts.reduce((t, v) => t + Math.max(0, v), 0);
    const x = labelW + ((total / max) * plotW) / 2;
    setTip({ x: x + 8, y: i * rowHeight + 4, flip: x > w * 0.6, title: r.label, rows: series.filter((sr) => sr.name).map((sr, j) => ({ label: sr.name, value: format(r.parts[j] || 0), color: sr.color })).concat(series.length === 1 && !series[0].name ? [{ label: '', value: format(r.parts[0] || 0), color: series[0].color }] : []).concat(r.sub ? [{ label: r.sub, value: '' }] : []) });
  };
  return (
    <div ref={ref} className="relative w-full" onMouseLeave={() => setTip(null)}>
      <svg width={w} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
        {rows.map((r, i) => {
          const y0 = i * rowHeight + (rowHeight - bh) / 2;
          let x = labelW;
          const total = r.total !== undefined ? r.total : r.parts.reduce((s, v) => s + Math.max(0, v), 0);
          const lastIdx = r.parts.reduce((li, v, j) => (v > 0 ? j : li), -1);
          return (
            <g key={r.key}>
              <text x={labelW - 8} y={y0 + bh / 2} dy="0.32em" textAnchor="end" className="fill-[color:var(--viz-text)] text-[12px]">{r.label}</text>
              <line x1={labelW} x2={labelW} y1={y0 - 3} y2={y0 + bh + 3} stroke="var(--viz-axis)" strokeWidth="1" shapeRendering="crispEdges" />
              {r.parts.map((v, j) => {
                const segW = (Math.max(0, v) / max) * plotW;
                const gap = j < lastIdx && segW > 2 ? 2 : 0;
                const p = barPath(x, y0, Math.max(0, segW - gap), bh, 4, j === lastIdx);
                const out = <path key={j} d={p} fill={series[j].color} />;
                x += segW;
                return out;
              })}
              <text x={labelW + (total / max) * plotW + 6} y={y0 + bh / 2} dy="0.32em" className="fill-[color:var(--viz-text)] text-[11.5px] font-semibold">{format(total)}</text>
              <rect x={0} y={i * rowHeight} width={w} height={rowHeight} fill="transparent" tabIndex={0} aria-label={r.label + ': ' + series.map((s, j) => s.name + ' ' + format(r.parts[j] || 0)).join(', ')}
                onMouseEnter={() => show(r, i)} onFocus={() => show(r, i)} onBlur={() => setTip(null)} className="outline-none" />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Horizontal bar list, one series (value at the tip). rows: [{ key, label, value, sub? }] */
export function BarListH({ rows, format = (v) => String(v), color = 'var(--series-1)', rowHeight = 30, ariaLabel }) {
  return <StackedBarH rows={rows.map((r) => ({ key: r.key, label: r.label, parts: [r.value], sub: r.sub }))} series={[{ name: '', color }]} format={format} rowHeight={rowHeight} ariaLabel={ariaLabel} />;
}
