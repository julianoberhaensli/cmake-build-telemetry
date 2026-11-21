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

/** Axis-friendly duration with a fixed unit chosen by the caller. */
export function fmtSeconds(ms: number): string {
  const s = ms / 1000;
  return s >= 100 ? `${Math.round(s)} s` : s >= 10 ? `${s.toFixed(0)} s` : `${s.toFixed(1)} s`;
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
