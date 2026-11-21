import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/** Global dashboard filter, stored in the URL so every view is a shareable link. */
export interface FilterState {
  range: RangeKey;
  project: string | null;
  branch: string | null;
  source: 'all' | 'ci' | 'local';
  kind: 'builds' | 'full' | 'incremental' | 'all';
  buildType: string | null;
}

export type RangeKey = '24h' | '7d' | '30d' | '90d' | '180d';

export const RANGES: { value: RangeKey; label: string; hours: number }[] = [
  { value: '24h', label: '24 h', hours: 24 },
  { value: '7d', label: '7 days', hours: 24 * 7 },
  { value: '30d', label: '30 days', hours: 24 * 30 },
  { value: '90d', label: '90 days', hours: 24 * 90 },
  { value: '180d', label: '180 days', hours: 24 * 180 },
];

const DEFAULTS: FilterState = { range: '30d', project: null, branch: null, source: 'all', kind: 'builds', buildType: null };

export function useFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<FilterState>(() => {
    const range = (params.get('range') as RangeKey) ?? DEFAULTS.range;
    return {
      range: RANGES.some((r) => r.value === range) ? range : DEFAULTS.range,
      project: params.get('project'),
      branch: params.get('branch'),
      source: (params.get('source') as FilterState['source']) ?? DEFAULTS.source,
      kind: (params.get('kind') as FilterState['kind']) ?? DEFAULTS.kind,
      buildType: params.get('buildType'),
    };
  }, [params]);

  const setFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K] | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null || value === undefined || value === DEFAULTS[key]) next.delete(key);
          else next.set(key, String(value));
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const reset = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);
  const isDefault = useMemo(
    () => (Object.keys(DEFAULTS) as (keyof FilterState)[]).every((k) => filters[k] === DEFAULTS[k]),
    [filters],
  );

  return { filters, setFilter, reset, isDefault };
}

/** Stable key for react-query (no timestamps, so it does not change every render). */
export function filterKey(f: FilterState): string {
  return JSON.stringify(f);
}

/** API query parameters; the time window is resolved at fetch time. */
export function toApiParams(f: FilterState, extra: Record<string, string | number | boolean | null | undefined> = {}) {
  const hours = RANGES.find((r) => r.value === f.range)?.hours ?? 24 * 30;
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600_000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    project: f.project,
    branch: f.branch,
    ci: f.source === 'all' ? null : f.source === 'ci',
    kind: f.kind === 'builds' ? null : f.kind,
    buildType: f.buildType,
    ...extra,
  };
}
