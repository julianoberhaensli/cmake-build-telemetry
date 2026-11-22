import type { Step, StepCategory } from '../api/types';
import { roleColor, type VizTokens } from '../components/viz';
import { fileName } from './format';

export const PHASE_ROLES = new Set(['configure', 'generate', 'build', 'cmakeBuild', 'cmakeInstall', 'ctest']);

/** Short, human name of a step: the TU, the linked file, or the tool of a custom command. */
export function stepLabel(s: Step): string {
  if (s.role === 'compile' && s.source) return fileName(s.source);
  if (s.role === 'link') return s.output ? fileName(s.output) : (s.target ?? 'link');
  if (PHASE_ROLES.has(s.role)) return s.role === 'build' || s.role === 'cmakeBuild' ? 'build tool' : s.role;
  // custom / install / test: CMakeFiles/<target> outputs are phony stamps, the tool says more
  const out = s.output && !/^CMakeFiles\//.test(s.output) ? fileName(s.output) : null;
  if (s.tool && out) return `${s.tool} → ${out}`;
  return s.tool ?? out ?? s.source ?? s.target ?? s.role;
}

/** Second line: full path of the source or output. */
export function stepPath(s: Step): string {
  return s.source ?? s.output ?? '';
}

export function cpuMs(s: Step): number | null {
  return s.userTimeUs == null ? null : (s.userTimeUs + (s.systemTimeUs ?? 0)) / 1000;
}

/** Filter shared by the timeline (highlight) and the step explorer (rows). */
export interface StepFilter {
  query: string;
  role: string | null;
  /** legend rule id, or -1 for "no category" */
  category: number | null;
  target: string | null;
  failedOnly: boolean;
}

export const EMPTY_FILTER: StepFilter = { query: '', role: null, category: null, target: null, failedOnly: false };

export function isFilterActive(f: StepFilter): boolean {
  return f.query.trim() !== '' || f.role !== null || f.category !== null || f.target !== null || f.failedOnly;
}

/** Every whitespace-separated term must occur in the name, path, target, tool or role. */
export function makeMatcher(f: StepFilter): (s: Step) => boolean {
  const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return (s) => {
    if (f.role !== null && s.role !== f.role) return false;
    if (f.category !== null && (f.category === -1 ? s.category !== null : s.category !== f.category)) return false;
    if (f.target !== null && s.target !== f.target) return false;
    if (f.failedOnly && !s.result) return false;
    if (terms.length === 0) return true;
    const hay = `${s.source ?? ''}\n${s.output ?? ''}\n${s.target ?? ''}\n${s.tool ?? ''}\n${s.role}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  };
}

/** Colour of a step: failure > legend rule > role. */
export function stepColor(v: VizTokens, s: Step, categories: Map<number, StepCategory>): string {
  // the build tool "fails" whenever any step fails; the failed step itself carries the red
  if (s.result && s.role !== 'build' && s.role !== 'cmakeBuild') return v.critical;
  const c = s.category !== null ? categories.get(s.category) : undefined;
  return c ? slotColor(v, c.colorSlot) : roleColor(v, s.role);
}

export function slotColor(v: VizTokens, slot: number): string {
  return v.series[Math.min(Math.max(slot, 1), v.series.length) - 1];
}

// --- time axis ---------------------------------------------------------------------------

const STEPS_MS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500,
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
  3_600_000, 7_200_000, 14_400_000,
];

/** Tick interval so that roughly `targetTicks` fit: 1 2 5 … ms, 1 2 5 10 15 30 s, 1 2 5 10 15 30 min, 1 2 4 h. */
export function tickStep(spanMs: number, targetTicks: number): number {
  const raw = spanMs / Math.max(1, targetTicks);
  return STEPS_MS.find((s) => s >= raw) ?? STEPS_MS[STEPS_MS.length - 1];
}

/** Clock-style offset from build start: 0:05, 12:30, 1:02:00; sub-second steps add decimals. */
export function fmtClock(ms: number, stepMs = 1000): string {
  const neg = ms < 0;
  const abs = Math.abs(ms);
  const totalS = Math.floor(abs / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  let text = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  if (stepMs < 1000) {
    const digits = stepMs >= 100 ? 1 : stepMs >= 10 ? 2 : 3;
    text += '.' + String(Math.floor(abs % 1000)).padStart(3, '0').slice(0, digits);
  }
  return (neg ? '−' : '') + text;
}

/** Duration of a span as a readable unit ("6m 15s", "820 ms"). */
export function fmtSpan(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// --- export ------------------------------------------------------------------------------

export function stepsToCsv(steps: Step[], categories: Map<number, StepCategory>): string {
  const cols = ['seq', 'role', 'category', 'name', 'target', 'source', 'output', 'tool', 'start_ms', 'duration_ms', 'cpu_ms', 'max_rss_kb', 'output_bytes', 'result'];
  const q = (v: unknown) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = steps.map((s) =>
    [s.seq, s.role, s.category !== null ? categories.get(s.category)?.name : '', stepLabel(s), s.target, s.source, s.output, s.tool, s.startMs, s.durationMs, cpuMs(s)?.toFixed(0), s.maxRssKb, s.outputBytes, s.result]
      .map(q)
      .join(','),
  );
  return [cols.join(','), ...rows].join('\n');
}
