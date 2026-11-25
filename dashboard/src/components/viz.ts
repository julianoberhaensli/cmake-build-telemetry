import { useEffect, useState } from 'react';
import { fmtAxisDuration, tickStep } from '../lib/format';

/** Chart tokens resolved from CSS custom properties for the active color scheme. */
export interface VizTokens {
  surface: string;
  text1: string;
  text2: string;
  muted: string;
  grid: string;
  axis: string;
  series: string[];
  s1Wash: string;
  good: string;
  warning: string;
  serious: string;
  critical: string;
  divNeg: string;
  divPos: string;
  scheme: 'light' | 'dark';
}

function read(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readAll(): VizTokens {
  return {
    surface: read('--viz-surface'),
    text1: read('--viz-text-1'),
    text2: read('--viz-text-2'),
    muted: read('--viz-muted'),
    grid: read('--viz-grid'),
    axis: read('--viz-axis'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => read(`--viz-s${i}`)),
    s1Wash: read('--viz-s1-wash'),
    good: read('--viz-good'),
    warning: read('--viz-warning'),
    serious: read('--viz-serious'),
    critical: read('--viz-critical'),
    divNeg: read('--viz-div-neg'),
    divPos: read('--viz-div-pos'),
    scheme: document.documentElement.getAttribute('data-mantine-color-scheme') === 'dark' ? 'dark' : 'light',
  };
}

/** Re-reads the tokens whenever Mantine flips the color-scheme attribute on <html>. */
export function useViz(): VizTokens {
  const [tokens, setTokens] = useState(readAll);
  useEffect(() => {
    const mo = new MutationObserver(() => setTokens(readAll()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mantine-color-scheme'] });
    setTokens(readAll());
    return () => mo.disconnect();
  }, []);
  return tokens;
}

/**
 * Build-step role groups in fixed categorical order (colour follows the role, never its
 * rank). The build tool's own run ("phase") is neutral chrome, not a series.
 */
export type RoleGroup = 'compile' | 'link' | 'custom' | 'configure' | 'other' | 'tool';
export const ROLE_GROUPS: RoleGroup[] = ['compile', 'link', 'custom', 'configure', 'other', 'tool'];

export function roleGroup(role: string): RoleGroup {
  switch (role) {
    case 'compile':
    case 'link':
    case 'custom':
      return role;
    case 'configure':
    case 'generate':
      return 'configure';
    case 'build':
    case 'cmakeBuild':
      return 'tool';
    default:
      return 'other';
  }
}

export const ROLE_LABEL: Record<RoleGroup, string> = {
  compile: 'Compile',
  link: 'Link',
  custom: 'Custom command',
  configure: 'Configure / generate',
  other: 'Install / test',
  tool: 'Build tool run',
};

export function roleColor(v: VizTokens, role: string, failed = false): string {
  if (failed) return v.critical;
  const g = roleGroup(role);
  return g === 'tool' ? v.axis : v.series[ROLE_GROUPS.indexOf(g)];
}

/** Shared axis / grid / tooltip styling (recessive chrome, hairlines, no dashes). */
export function baseChart(v: VizTokens) {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: v.text2 },
    animationDuration: 300,
    tooltip: {
      backgroundColor: v.surface,
      borderColor: v.axis,
      borderWidth: 1,
      textStyle: { color: v.text1, fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 8px;',
    },
  };
}

export function valueAxis(v: VizTokens, formatter: (n: number) => string, extra: object = {}) {
  return {
    type: 'value',
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: v.grid, width: 1, type: 'solid' } },
    axisLabel: { color: v.muted, fontSize: 11, formatter },
    ...extra,
  };
}

/**
 * Value axis for durations in ms. ECharts' own "nice" steps are decimal (500 s, 1000 s …),
 * which reads badly once builds take most of an hour, so the interval comes from time units
 * instead (… 30 s, 1 / 2 / 5 / 10 / 15 / 30 min, 1 / 2 / 4 h …) and ticks read "45m", "1h 15m".
 * `headroom` adds a step when the largest value would sit on the top gridline, leaving room
 * for the point and the labels drawn next to it.
 */
export function durationAxis(
  v: VizTokens,
  values: Iterable<number | null | undefined>,
  opts: { ticks?: number; headroom?: boolean; signed?: boolean; extra?: object } = {},
) {
  let lo = 0;
  let hi = 0;
  for (const x of values) {
    if (x == null || !Number.isFinite(x)) continue;
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  const step = tickStep(Math.max(hi - lo, 1000), opts.ticks ?? 5);
  const min = Math.floor(lo / step) * step;
  let max = Math.max(step, Math.ceil(hi / step) * step);
  if (opts.headroom && hi > 0 && max - hi < step * 0.25) max += step;
  const fmt = (n: number) => (opts.signed && n > 0 ? '+' : '') + fmtAxisDuration(n, step);
  return valueAxis(v, fmt, { min, max, interval: step, ...opts.extra });
}

export function categoryAxis(v: VizTokens, extra: object = {}) {
  return {
    type: 'category',
    axisLine: { lineStyle: { color: v.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: v.muted, fontSize: 11 },
    ...extra,
  };
}

/** Tooltip row: value leads (strong), label follows, keyed by a short line/swatch. */
export function tipRow(color: string, label: string, value: string, key: 'line' | 'box' = 'box'): string {
  const keyEl =
    key === 'line'
      ? `<span style="display:inline-block;width:14px;height:2px;border-radius:1px;background:${color};margin-right:8px;vertical-align:3px"></span>`
      : `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${color};margin-right:8px;vertical-align:-1px"></span>`;
  return `<div style="display:flex;align-items:center;gap:4px;margin:2px 0">${keyEl}<b style="min-width:64px">${value}</b><span style="opacity:.75">${label}</span></div>`;
}
