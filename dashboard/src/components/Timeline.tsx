import { ActionIcon, Group, SegmentedControl, Text, Tooltip } from '@mantine/core';
import { IconArrowsHorizontal, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Step, StepCategory } from '../api/types';
import { esc, fmtDuration, fmtKb, tickStep } from '../lib/format';
import { cpuMs, fmtClock, fmtSpan, stepColor, stepLabel, stepPath } from '../lib/steps';
import { useViz } from './viz';

export interface TimelineHandle {
  /** Zoom to a step and scroll the timeline into view (the caller marks it selected). */
  focusStep: (seq: number) => void;
}

interface Props {
  steps: Step[];
  categories: Map<number, StepCategory>;
  /** Highlight filter: matching steps keep their colour, the rest is dimmed. */
  match: ((s: Step) => boolean) | null;
  selectedSeq: number | null;
  onSelect: (seq: number | null) => void;
}

type Density = 'compact' | 'normal' | 'large';

const LABEL_W = 58;
const AXIS_H = 22;
const OVERVIEW_H = 46;
const MIN_SPAN_MS = 20;
const BINS = 800;

interface Prepared {
  vis: Step[];
  /** row 0 = phases, row n = job lane n-1; indices into vis, sorted by start */
  rows: number[][];
  starts: Float64Array[];
  ends: Float64Array[];
  t0: number;
  t1: number;
  lanes: number;
  /** concurrency profile over [t0, t1] for the overview */
  profile: Float32Array;
}

function prepare(steps: Step[]): Prepared {
  // configure runs long before the build would squeeze everything else into a sliver
  const vis = steps.filter((s) => s.lane >= 0 || s.startMs > -120_000);
  const lanes = Math.max(0, ...vis.map((s) => s.lane)) + 1;
  const rows: number[][] = Array.from({ length: lanes + 1 }, () => []);
  vis.forEach((s, i) => rows[s.lane < 0 ? 0 : s.lane + 1].push(i));
  for (const r of rows) r.sort((a, b) => vis[a].startMs - vis[b].startMs);
  const starts = rows.map((r) => Float64Array.from(r, (i) => vis[i].startMs));
  // lanes never overlap, so end times are sorted too (phases are few and drawn in full)
  const ends = rows.map((r) => Float64Array.from(r, (i) => vis[i].startMs + Math.max(vis[i].durationMs, 1)));
  const t0 = Math.min(0, ...vis.map((s) => s.startMs));
  const t1 = Math.max(t0 + 1000, ...vis.map((s) => s.startMs + s.durationMs));

  const profile = new Float32Array(BINS);
  const binW = (t1 - t0) / BINS;
  for (let r = 1; r < rows.length; r++) {
    for (const i of rows[r]) {
      const a = (vis[i].startMs - t0) / binW;
      const b = (vis[i].startMs + vis[i].durationMs - t0) / binW;
      for (let k = Math.max(0, Math.floor(a)); k < Math.min(BINS, Math.ceil(b)); k++) {
        profile[k] += Math.min(b, k + 1) - Math.max(a, k);
      }
    }
  }
  return { vis, rows, starts, ends, t0, t1, lanes, profile };
}

/** First index whose value is >= x. */
function lowerBound(arr: Float64Array, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return '#ffffff';
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#0b0b0b' : '#ffffff';
}

/**
 * Gantt view of one build on a canvas: each bar is a command on the job slot it ran in
 * (reconstructed server-side), phases on the top row. Only bars inside the visible window
 * are drawn, so 10 000+ steps zoom and pan smoothly.
 */
export const Timeline = forwardRef<TimelineHandle, Props>(function Timeline({ steps, categories, match, selectedSeq, onSelect }, ref) {
  const v = useViz();
  const data = useMemo(() => prepare(steps), [steps]);
  const colors = useMemo(() => data.vis.map((s) => stepColor(v, s, categories)), [data, v, categories]);
  const matched = useMemo(() => (match ? data.vis.map(match) : null), [data, match]);
  const [density, setDensity] = useState<Density>('normal');

  const wrapRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const view = useRef({ s: data.t0, e: data.t1 });
  const hover = useRef<{ x: number; idx: number | null } | null>(null);
  const brush = useRef<{ x0: number; x1: number } | null>(null);
  const frame = useRef(0);
  const [readout, setReadout] = useState({ s: data.t0, e: data.t1 });

  const rowCount = data.lanes + 1;
  const baseRow = Math.min(18, Math.max(5, Math.round(520 / rowCount)));
  const rowH = Math.max(3, Math.round(baseRow * (density === 'compact' ? 0.6 : density === 'large' ? 1.7 : 1)));
  const height = AXIS_H + rowCount * rowH + 6;
  const plotW = Math.max(100, width - LABEL_W - 8);

  // a new build resets the view
  useEffect(() => {
    view.current = { s: data.t0, e: data.t1 };
    setReadout({ ...view.current });
  }, [data]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setWidth(Math.round(e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const msOf = useCallback((x: number) => view.current.s + ((x - LABEL_W) / plotW) * (view.current.e - view.current.s), [plotW]);

  // --- drawing ------------------------------------------------------------------------
  const drawMain = useCallback(() => {
    const c = mainRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const { s, e } = view.current;
    const span = e - s;
    const pxPerMs = plotW / span;
    const bottom = AXIS_H + rowCount * rowH;

    // grid + axis labels (clock offsets from build start)
    const step = tickStep(span, plotW / 90);
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let t = Math.ceil(s / step) * step; t <= e; t += step) {
      const x = Math.round(LABEL_W + (t - s) * pxPerMs) + 0.5;
      ctx.fillStyle = v.grid;
      ctx.fillRect(x - 0.5, AXIS_H, 1, bottom - AXIS_H);
      ctx.fillStyle = v.muted;
      ctx.fillText(fmtClock(t, step), x, AXIS_H / 2);
    }
    ctx.fillStyle = v.axis;
    ctx.fillRect(LABEL_W, AXIS_H + rowH, plotW, 1); // phases | jobs separator

    // bars (only the visible window of each row)
    ctx.save();
    ctx.beginPath();
    ctx.rect(LABEL_W, AXIS_H, plotW, bottom - AXIS_H);
    ctx.clip();
    const barH = Math.max(2, Math.round(rowH * 0.74));
    const labelsFit = barH >= 11;
    const passes = matched ? [false, true] : [true];
    let selRect: number[] | null = null;
    let hovRect: number[] | null = null;
    for (const highlightPass of passes) {
      ctx.globalAlpha = matched && !highlightPass ? 0.16 : 1;
      for (let r = 0; r < data.rows.length; r++) {
        const row = data.rows[r];
        const y = AXIS_H + r * rowH + Math.floor((rowH - barH) / 2);
        const first = r === 0 ? 0 : lowerBound(data.ends[r], s);
        for (let k = first; k < row.length; k++) {
          const i = row[k];
          const st = data.starts[r][k];
          if (st > e) break;
          if (matched && matched[i] !== highlightPass) continue;
          const en = data.ends[r][k];
          if (en < s) continue;
          const x0 = LABEL_W + (st - s) * pxPerMs;
          const w0 = (en - st) * pxPerMs;
          const w = w0 > 3 ? w0 - 1 : Math.max(w0, 1); // 1px surface gap between neighbours
          ctx.fillStyle = colors[i];
          ctx.fillRect(x0, y, w, barH);
          if (labelsFit && w > 44) {
            const label = stepLabel(data.vis[i]);
            const max = Math.floor((w - 8) / 6.3);
            if (max >= 3) {
              ctx.fillStyle = inkOn(colors[i]);
              ctx.textAlign = 'left';
              ctx.fillText(label.length > max ? label.slice(0, max - 1) + '…' : label, Math.max(x0, LABEL_W) + 4, y + barH / 2 + 0.5);
            }
          }
          if (data.vis[i].seq === selectedSeq) selRect = [x0, y, w, barH];
          if (hover.current?.idx === i) hovRect = [x0, y, w, barH];
        }
      }
    }
    ctx.globalAlpha = 1;
    if (hovRect) {
      ctx.strokeStyle = v.text2;
      ctx.lineWidth = 1;
      ctx.strokeRect(hovRect[0] - 0.5, hovRect[1] - 0.5, hovRect[2] + 1, hovRect[3] + 1);
    }
    if (selRect) {
      ctx.strokeStyle = v.text1;
      ctx.lineWidth = 2;
      ctx.strokeRect(selRect[0] - 1, selRect[1] - 1, selRect[2] + 2, selRect[3] + 2);
    }

    // shift-drag selection
    if (brush.current) {
      const a = Math.min(brush.current.x0, brush.current.x1);
      const b = Math.max(brush.current.x0, brush.current.x1);
      ctx.fillStyle = v.s1Wash;
      ctx.fillRect(a, AXIS_H, b - a, bottom - AXIS_H);
      ctx.fillStyle = v.series[0];
      ctx.fillRect(a, AXIS_H, 1, bottom - AXIS_H);
      ctx.fillRect(b, AXIS_H, 1, bottom - AXIS_H);
    }
    ctx.restore();

    // crosshair with the time under the pointer
    const h = hover.current;
    if (h && h.x >= LABEL_W && h.x <= LABEL_W + plotW) {
      ctx.fillStyle = v.text2;
      ctx.fillRect(Math.round(h.x), AXIS_H, 1, bottom - AXIS_H);
      const t = fmtClock(msOf(h.x), Math.max(1, tickStep(span, plotW / 90) / 10));
      const tw = ctx.measureText(t).width + 10;
      const tx = Math.min(Math.max(h.x - tw / 2, LABEL_W), LABEL_W + plotW - tw);
      ctx.fillStyle = v.text1;
      ctx.fillRect(tx, 2, tw, AXIS_H - 4);
      ctx.fillStyle = v.surface;
      ctx.textAlign = 'center';
      ctx.fillText(t, tx + tw / 2, AXIS_H / 2);
    }

    // lane labels (every n-th when rows are thin)
    ctx.textAlign = 'right';
    ctx.fillStyle = v.muted;
    ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
    const every = Math.max(1, Math.ceil(11 / rowH));
    for (let r = 0; r < rowCount; r++) {
      if (r > 1 && (r - 1) % every !== 0) continue;
      ctx.fillText(r === 0 ? 'Phases' : `Job ${r}`, LABEL_W - 8, AXIS_H + r * rowH + rowH / 2);
    }
  }, [width, height, plotW, rowCount, rowH, data, colors, matched, selectedSeq, v, msOf]);

  const drawOverview = useCallback(() => {
    const c = overRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(OVERVIEW_H * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(OVERVIEW_H * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, OVERVIEW_H);
    const top = 4;
    const h = OVERVIEW_H - 8;
    const full = data.t1 - data.t0;
    const X = (ms: number) => LABEL_W + ((ms - data.t0) / full) * plotW;

    // parallelism over the whole build (100 % = every job slot busy)
    ctx.fillStyle = v.grid;
    ctx.fillRect(LABEL_W, top + h, plotW, 1);
    ctx.beginPath();
    ctx.moveTo(LABEL_W, top + h);
    for (let k = 0; k < BINS; k++) {
      ctx.lineTo(LABEL_W + ((k + 0.5) / BINS) * plotW, top + h - (Math.min(data.profile[k], data.lanes) / Math.max(1, data.lanes)) * h);
    }
    ctx.lineTo(LABEL_W + plotW, top + h);
    ctx.closePath();
    ctx.fillStyle = v.s1Wash;
    ctx.fill();
    ctx.strokeStyle = v.series[0];
    ctx.lineWidth = 1;
    ctx.stroke();

    // visible window: dim the rest, outline + grab handles
    const a = X(view.current.s);
    const b = X(view.current.e);
    ctx.fillStyle = v.scheme === 'dark' ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.6)';
    ctx.fillRect(LABEL_W, 0, Math.max(0, a - LABEL_W), OVERVIEW_H);
    ctx.fillRect(b, 0, Math.max(0, LABEL_W + plotW - b), OVERVIEW_H);
    ctx.strokeStyle = v.text2;
    ctx.lineWidth = 1;
    ctx.strokeRect(a + 0.5, 0.5, Math.max(1, b - a - 1), OVERVIEW_H - 1);
    ctx.fillStyle = v.text2;
    for (const x of [a, b]) ctx.fillRect(x - 2, OVERVIEW_H / 2 - 8, 4, 16);

    ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = v.muted;
    ctx.fillText('Busy jobs', LABEL_W - 8, OVERVIEW_H / 2);
  }, [width, plotW, data, v]);

  const render = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      drawMain();
      drawOverview();
      setReadout((r) => (r.s === view.current.s && r.e === view.current.e ? r : { ...view.current }));
    });
  }, [drawMain, drawOverview]);

  useEffect(() => {
    render();
    return () => cancelAnimationFrame(frame.current);
  }, [render]);

  // --- view changes -------------------------------------------------------------------
  const setView = useCallback(
    (s: number, e: number) => {
      const full = data.t1 - data.t0;
      let span = Math.min(Math.max(e - s, MIN_SPAN_MS), full);
      s = Math.min(Math.max(s, data.t0), data.t1 - span);
      span = Math.min(span, data.t1 - s);
      view.current = { s, e: s + span };
      render();
    },
    [data, render],
  );

  const zoom = useCallback(
    (factor: number, anchorMs?: number) => {
      const { s, e } = view.current;
      const a = anchorMs ?? (s + e) / 2;
      setView(a - (a - s) * factor, a + (e - a) * factor);
    },
    [setView],
  );
  const pan = useCallback((fraction: number) => {
    const { s, e } = view.current;
    setView(s + (e - s) * fraction, e + (e - s) * fraction);
  }, [setView]);
  const fit = useCallback(() => setView(data.t0, data.t1), [data, setView]);

  useImperativeHandle(ref, () => ({
    focusStep: (seq) => {
      const st = data.vis.find((x) => x.seq === seq);
      if (!st) return;
      const pad = Math.max(st.durationMs * 0.6, (data.t1 - data.t0) * 0.002, 200);
      setView(st.startMs - pad, st.startMs + st.durationMs + pad);
      wrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
  }), [data, setView]);

  // --- hit testing --------------------------------------------------------------------
  const hit = useCallback(
    (x: number, y: number): number | null => {
      if (x < LABEL_W || y < AXIS_H) return null;
      const r = Math.floor((y - AXIS_H) / rowH);
      if (r < 0 || r >= data.rows.length) return null;
      const t = msOf(x);
      const tol = 3 * ((view.current.e - view.current.s) / plotW);
      const row = data.rows[r];
      if (r === 0) {
        // phases overlap (the build tool spans everything): prefer the shortest hit
        let best: number | null = null;
        row.forEach((i, k) => {
          if (data.starts[0][k] - tol <= t && data.ends[0][k] + tol >= t && (best === null || data.vis[i].durationMs < data.vis[best].durationMs)) best = i;
        });
        return best;
      }
      const k = lowerBound(data.ends[r], t - tol);
      if (k < row.length && data.starts[r][k] - tol <= t) return row[k];
      return null;
    },
    [data, rowH, plotW, msOf],
  );

  const showTip = useCallback(
    (idx: number | null, x: number, y: number) => {
      const tip = tipRef.current;
      if (!tip) return;
      if (idx === null) {
        tip.style.display = 'none';
        return;
      }
      const s = data.vis[idx];
      const cat = s.category !== null ? categories.get(s.category) : undefined;
      const cpu = cpuMs(s);
      tip.innerHTML =
        `<div style="font-weight:600;word-break:break-all">${esc(stepLabel(s))}</div>` +
        (stepPath(s) ? `<div style="opacity:.7;word-break:break-all;margin-bottom:4px">${esc(stepPath(s))}</div>` : '') +
        `<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><span style="width:10px;height:10px;border-radius:3px;background:${colors[idx]}"></span>` +
        `<b>${fmtDuration(s.durationMs)}</b><span style="opacity:.75">${esc(cat?.name ?? s.role)}${s.target ? ' · ' + esc(s.target) : ''}</span></div>` +
        `<div style="opacity:.75">starts at ${fmtClock(s.startMs)}${cpu != null ? ` · CPU ${fmtDuration(cpu)}` : ''}${s.maxRssKb ? ` · peak ${fmtKb(s.maxRssKb)}` : ''}${s.result ? ` · <b>exit code ${s.result}</b>` : ''}</div>`;
      tip.style.display = 'block';
      const wrapW = wrapRef.current!.clientWidth;
      const tw = tip.offsetWidth;
      const left = x + 16 + tw > wrapW ? x - tw - 12 : x + 16;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${(mainRef.current?.offsetTop ?? 0) + y + 14}px`;
    },
    [data, categories, colors],
  );

  // --- pointer + wheel + keys on the main canvas ----------------------------------------
  const drag = useRef<{ x: number; s: number; e: number; moved: boolean; brushing: boolean } | null>(null);

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const x = ev.nativeEvent.offsetX;
    drag.current = { x, ...view.current, moved: false, brushing: ev.shiftKey };
    if (ev.shiftKey) brush.current = { x0: x, x1: x };
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const x = ev.nativeEvent.offsetX;
    const y = ev.nativeEvent.offsetY;
    const d = drag.current;
    if (d) {
      if (Math.abs(x - d.x) > 3) d.moved = true;
      if (d.brushing) {
        brush.current = { x0: d.x, x1: Math.min(Math.max(x, LABEL_W), LABEL_W + plotW) };
      } else if (d.moved) {
        const dt = ((x - d.x) / plotW) * (d.e - d.s);
        setView(d.s - dt, d.e - dt);
      }
      hover.current = { x, idx: null };
      showTip(null, x, y);
      ev.currentTarget.style.cursor = d.brushing ? 'col-resize' : 'grabbing';
      render();
      return;
    }
    const idx = hit(x, y);
    hover.current = { x, idx };
    ev.currentTarget.style.cursor = idx !== null ? 'pointer' : 'grab';
    showTip(idx, x, y);
    render();
  };

  const onPointerUp = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.brushing && brush.current) {
      const a = Math.min(brush.current.x0, brush.current.x1);
      const b = Math.max(brush.current.x0, brush.current.x1);
      brush.current = null;
      if (b - a > 4) setView(msOf(a), msOf(b));
      else render();
      return;
    }
    if (!d.moved) {
      const idx = hit(ev.nativeEvent.offsetX, ev.nativeEvent.offsetY);
      onSelect(idx === null ? null : data.vis[idx].seq);
    }
  };

  const onDoubleClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const idx = hit(ev.nativeEvent.offsetX, ev.nativeEvent.offsetY);
    if (idx !== null) {
      const st = data.vis[idx];
      const pad = Math.max(st.durationMs * 0.6, 100);
      setView(st.startMs - pad, st.startMs + st.durationMs + pad);
    } else {
      zoom(0.5, msOf(ev.nativeEvent.offsetX));
    }
  };

  // wheel needs a non-passive listener to prevent page scroll / browser zoom
  useEffect(() => {
    const c = mainRef.current;
    const o = overRef.current;
    if (!c || !o) return;
    const onWheel = (ev: WheelEvent) => {
      const rect = (ev.currentTarget as HTMLCanvasElement).getBoundingClientRect();
      const x = ev.clientX - rect.left;
      if (ev.ctrlKey || ev.metaKey || ev.currentTarget === o) {
        // trackpad pinch arrives as ctrl+wheel; the overview zooms without a modifier
        ev.preventDefault();
        const anchor = ev.currentTarget === o ? data.t0 + ((x - LABEL_W) / plotW) * (data.t1 - data.t0) : msOf(x);
        zoom(Math.exp(ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.002)), anchor);
      } else if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
        ev.preventDefault();
        const px = ev.shiftKey && ev.deltaX === 0 ? ev.deltaY : ev.deltaX;
        pan(px / plotW);
      }
      // plain vertical wheel scrolls the page
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    o.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      c.removeEventListener('wheel', onWheel);
      o.removeEventListener('wheel', onWheel);
    };
  }, [zoom, pan, msOf, plotW, data]);

  const onKeyDown = (ev: React.KeyboardEvent) => {
    const k = ev.key;
    if (k === '+' || k === '=' || k === 'w') zoom(0.6);
    else if (k === '-' || k === '_' || k === 's') zoom(1 / 0.6);
    else if (k === 'a' || k === 'ArrowLeft') pan(-0.2);
    else if (k === 'd' || k === 'ArrowRight') pan(0.2);
    else if (k === '0' || k === 'f') fit();
    else if (k === 'Escape') onSelect(null);
    else return;
    ev.preventDefault();
  };

  // --- overview: drag the window, its edges, or brush a new range ------------------------
  const odrag = useRef<{ mode: 'move' | 'l' | 'r' | 'brush'; x: number; s: number; e: number; moved: boolean } | null>(null);
  const overZone = (x: number): 'move' | 'l' | 'r' | 'brush' => {
    const full = data.t1 - data.t0;
    const a = LABEL_W + ((view.current.s - data.t0) / full) * plotW;
    const b = LABEL_W + ((view.current.e - data.t0) / full) * plotW;
    if (Math.abs(x - a) <= 6) return 'l';
    if (Math.abs(x - b) <= 6) return 'r';
    // fully zoomed out the window is everything: dragging selects a range instead
    return x > a && x < b && b - a < plotW * 0.98 ? 'move' : 'brush';
  };
  const overMs = (x: number) => data.t0 + ((x - LABEL_W) / plotW) * (data.t1 - data.t0);

  const onOverDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const x = ev.nativeEvent.offsetX;
    odrag.current = { mode: overZone(x), x, ...view.current, moved: false };
  };
  const onOverMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const x = ev.nativeEvent.offsetX;
    const d = odrag.current;
    if (!d) {
      const z = overZone(x);
      ev.currentTarget.style.cursor = z === 'move' ? 'grab' : z === 'brush' ? 'crosshair' : 'ew-resize';
      return;
    }
    if (Math.abs(x - d.x) > 2) d.moved = true;
    const dt = overMs(x) - overMs(d.x);
    if (d.mode === 'move') setView(d.s + dt, d.e + dt);
    else if (d.mode === 'l') setView(Math.min(d.s + dt, d.e - MIN_SPAN_MS), d.e);
    else if (d.mode === 'r') setView(d.s, Math.max(d.e + dt, d.s + MIN_SPAN_MS));
    else if (d.moved) setView(Math.min(overMs(d.x), overMs(x)), Math.max(overMs(d.x), overMs(x)));
  };
  const onOverUp = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const d = odrag.current;
    odrag.current = null;
    if (d && d.mode === 'brush' && !d.moved) {
      // click: centre the current window there
      const half = (view.current.e - view.current.s) / 2;
      const c = overMs(ev.nativeEvent.offsetX);
      setView(c - half, c + half);
    }
  };

  const fullSpan = data.t1 - data.t0;
  const zoomed = readout.e - readout.s < fullSpan * 0.999;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <Group justify="space-between" mb={6} gap="xs" wrap="wrap">
        <Group gap={4}>
          <Tooltip label="Zoom in (+, W, Ctrl+wheel)">
            <ActionIcon variant="default" size="md" onClick={() => zoom(0.5)} aria-label="Zoom in">
              <IconZoomIn size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Zoom out (−, S)">
            <ActionIcon variant="default" size="md" onClick={() => zoom(2)} aria-label="Zoom out" disabled={!zoomed}>
              <IconZoomOut size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Show the whole build (0, F)">
            <ActionIcon variant="default" size="md" onClick={fit} aria-label="Show whole build" disabled={!zoomed}>
              <IconArrowsHorizontal size={16} />
            </ActionIcon>
          </Tooltip>
          <Text size="xs" c="dimmed" ml={6} className="num">
            {fmtClock(readout.s)} – {fmtClock(readout.e)} · {fmtSpan(readout.e - readout.s)}
            {zoomed && ` of ${fmtSpan(fullSpan)}`}
          </Text>
        </Group>
        <Group gap="xs">
          <Text size="xs" c="dimmed" visibleFrom="md">
            Drag to pan · Shift+drag to zoom to a range · Ctrl+wheel zooms · double-click a bar
          </Text>
          <SegmentedControl
            size="xs"
            value={density}
            onChange={(x) => setDensity(x as Density)}
            data={[
              { value: 'compact', label: 'Compact' },
              { value: 'normal', label: 'Normal' },
              { value: 'large', label: 'Large' },
            ]}
            aria-label="Row height"
          />
        </Group>
      </Group>
      <canvas
        ref={overRef}
        style={{ width: '100%', height: OVERVIEW_H, display: 'block', touchAction: 'none' }}
        onPointerDown={onOverDown}
        onPointerMove={onOverMove}
        onPointerUp={onOverUp}
        aria-label="Build overview: busy job slots over time; drag to choose the visible range"
      />
      <canvas
        ref={mainRef}
        tabIndex={0}
        className="timeline-canvas"
        style={{ width: '100%', height, display: 'block', marginTop: 4, touchAction: 'none', cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          hover.current = null;
          showTip(null, 0, 0);
          render();
        }}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        role="img"
        aria-label={`Build timeline with ${steps.length} steps on ${data.lanes} parallel jobs. Keys: plus/minus zoom, arrows pan, 0 fits.`}
      />
      <div ref={tipRef} className="timeline-tip" style={{ display: 'none' }} />
    </div>
  );
});

/** Legend entry; clicking it filters/highlights that group. */
export interface LegendItem {
  key: string;
  label: string;
  color: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

export function TimelineLegend({ items }: { items: LegendItem[] }) {
  return (
    <Group gap={6} mb={8} wrap="wrap">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`legend-chip${it.active ? ' active' : ''}`}
          onClick={it.onClick}
          aria-pressed={it.active}
          title={it.active ? 'Show all steps' : `Highlight ${it.label}`}
        >
          <span className="legend-key" style={{ background: it.color }} />
          {it.label}
          <span className="legend-count">{it.count.toLocaleString('en-US')}</span>
        </button>
      ))}
    </Group>
  );
}
