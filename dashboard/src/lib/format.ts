import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

/** 850 ms · 12.3 s · 4m 05s · 1h 02m */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

// --- time axes ---------------------------------------------------------------------------

const STEPS_MS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500,
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
  3_600_000, 7_200_000, 14_400_000, 21_600_000, 43_200_000, 86_400_000,
];

/** Tick interval so that roughly `targetTicks` fit: 1 2 5 … ms, 1 2 5 10 15 30 s, 1 2 5 10 15 30 min, 1 2 4 6 12 24 h. */
export function tickStep(spanMs: number, targetTicks: number): number {
  const raw = spanMs / Math.max(1, targetTicks);
  const fixed = STEPS_MS.find((s) => s >= raw);
  if (fixed !== undefined) return fixed;
  // beyond a day: 1 2 5 × 10^k days
  const days = raw / 86_400_000;
  const pow = 10 ** Math.floor(Math.log10(days));
  return ([1, 2, 5, 10].find((m) => m * pow >= days) ?? 10) * pow * 86_400_000;
}

/** Axis label for a duration tick: "0", "500 ms", "15 s", "1m 30s", "45m", "1h", "1h 30m". */
export function fmtAxisDuration(ms: number, stepMs: number): string {
  const neg = ms < 0;
  const abs = Math.abs(ms);
  let text: string;
  if (abs === 0) text = '0';
  else if (abs < 1000) text = `${Math.round(abs)} ms`;
  else if (abs < 60_000) text = `${stepMs < 1000 ? +(abs / 1000).toFixed(stepMs >= 100 ? 1 : 2) : Math.round(abs / 1000)} s`;
  else if (abs < 3_600_000) {
    const m = Math.floor(abs / 60_000);
    const s = Math.round((abs % 60_000) / 1000);
    text = s ? `${m}m ${String(s).padStart(2, '0')}s` : `${m}m`;
  } else {
    const h = Math.floor(abs / 3_600_000);
    const m = Math.round((abs % 3_600_000) / 60_000);
    text = m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
  }
  return neg ? `−${text}` : text;
}

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return Math.round(n).toLocaleString('en-US');
}

export function fmtPercent(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? '–' : `${(v * 100).toFixed(digits)}%`;
}

export function fmtKb(kb: number | null | undefined): string {
  if (kb === null || kb === undefined) return '–';
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${Math.round(kb / 1024)} MB`;
  return `${kb} KB`;
}

export function fmtMb(mb: number | null | undefined): string {
  return mb === null || mb === undefined ? '–' : mb >= 1024 ? `${Math.round(mb / 1024)} GB` : `${mb} MB`;
}

export function fmtBytes(b: number | null | undefined): string {
  return b === null || b === undefined ? '–' : fmtKb(Math.round(b / 1024));
}

export function fmtDate(iso: string): string {
  return dayjs(iso).format('YYYY-MM-DD HH:mm');
}

export function fmtAgo(iso: string): string {
  return dayjs(iso).fromNow();
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 8) : '–';
}

export function fileName(path: string | null | undefined): string {
  if (!path) return '–';
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/** Signed relative change, e.g. "+12.4%". */
export function fmtDelta(current: number | null | undefined, previous: number | null | undefined): string | null {
  if (current == null || previous == null || previous === 0) return null;
  const d = (current - previous) / previous;
  return `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}%`;
}

/** Escape untrusted strings for HTML tooltips. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
