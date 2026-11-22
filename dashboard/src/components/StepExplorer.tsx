import { ActionIcon, Badge, Button, Checkbox, CloseButton, Group, Pagination, Select, Table, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconChevronDown, IconChevronUp, IconCrosshair, IconDownload, IconSearch, IconSelector } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import type { Step, StepCategory } from '../api/types';
import { fmtBytes, fmtDuration, fmtKb, fmtNumber } from '../lib/format';
import { EMPTY_FILTER, PHASE_ROLES, cpuMs, fmtClock, isFilterActive, slotColor, stepLabel, stepPath, stepsToCsv, type StepFilter } from '../lib/steps';
import { roleColor, useViz } from './viz';

type SortKey = 'name' | 'target' | 'start' | 'duration' | 'cpu' | 'rss' | 'output';
const PAGE = 50;

const SORTERS: Record<SortKey, (s: Step) => number | string | null> = {
  name: (s) => stepLabel(s).toLowerCase(),
  target: (s) => s.target?.toLowerCase() ?? null,
  start: (s) => s.startMs,
  duration: (s) => s.durationMs,
  cpu: (s) => cpuMs(s),
  rss: (s) => s.maxRssKb,
  output: (s) => s.outputBytes,
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5))];
}

/**
 * Every step of one build: search by file, target or tool, filter by role / legend rule /
 * target, sort by any measure. The same filter highlights the matching bars on the timeline.
 */
export function StepExplorer({
  steps,
  categories,
  filter,
  onFilter,
  matches,
  onSelect,
  onLocate,
  buildId,
}: {
  steps: Step[];
  categories: Map<number, StepCategory>;
  filter: StepFilter;
  onFilter: (f: StepFilter) => void;
  matches: Step[];
  onSelect: (seq: number) => void;
  onLocate: (seq: number) => void;
  buildId: string;
}) {
  const v = useViz();
  const [query, setQuery] = useState(filter.query);
  const [debounced] = useDebouncedValue(query, 160);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'duration', dir: 'desc' });
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (debounced !== filter.query) onFilter({ ...filter, query: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => setQuery(filter.query), [filter.query]);
  useEffect(() => setPage(1), [filter, sort]);

  const work = useMemo(() => steps.filter((s) => !PHASE_ROLES.has(s.role)), [steps]);
  const roleOptions = useMemo(() => {
    const counts = new Map<string, number>();
    work.forEach((s) => counts.set(s.role, (counts.get(s.role) ?? 0) + 1));
    return [...counts].sort((a, b) => b[1] - a[1]).map(([r, n]) => ({ value: r, label: `${r} (${fmtNumber(n)})` }));
  }, [work]);
  const targetOptions = useMemo(() => {
    const counts = new Map<string, number>();
    work.forEach((s) => s.target && counts.set(s.target, (counts.get(s.target) ?? 0) + 1));
    return [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([t, n]) => ({ value: t, label: `${t} (${fmtNumber(n)})` }));
  }, [work]);
  const categoryOptions = useMemo(() => {
    const counts = new Map<number, number>();
    work.forEach((s) => s.category !== null && counts.set(s.category, (counts.get(s.category) ?? 0) + 1));
    const opts = [...categories.values()]
      .filter((c) => counts.has(c.id))
      .map((c) => ({ value: String(c.id), label: `${c.name} (${fmtNumber(counts.get(c.id) ?? 0)})` }));
    return opts.length ? [...opts, { value: '-1', label: 'No legend rule' }] : [];
  }, [work, categories]);

  const rows = useMemo(() => {
    const list = matches.filter((s) => !PHASE_ROLES.has(s.role));
    const get = SORTERS[sort.key];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x === y) return a.seq - b.seq;
      if (x === null) return 1; // missing values last in both directions
      if (y === null) return -1;
      return (x < y ? -1 : 1) * dir;
    });
  }, [matches, sort]);

  const stats = useMemo(() => {
    const d = rows.map((s) => s.durationMs).sort((a, b) => a - b);
    const cpu = rows.reduce((n, s) => n + (cpuMs(s) ?? 0), 0);
    return {
      total: d.reduce((n, x) => n + x, 0),
      p50: percentile(d, 0.5),
      p95: percentile(d, 0.95),
      cpu: rows.some((s) => s.userTimeUs != null) ? cpu : null,
      rss: rows.reduce<number | null>((m, s) => (s.maxRssKb != null && (m === null || s.maxRssKb > m) ? s.maxRssKb : m), null),
    };
  }, [rows]);

  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const hasCpu = work.some((s) => s.userTimeUs != null);
  const hasRss = work.some((s) => s.maxRssKb != null);
  const hasOut = work.some((s) => s.outputBytes != null);

  const exportCsv = () => {
    const blob = new Blob([stepsToCsv(rows, categories)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `build-${buildId.slice(0, 8)}-steps.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const Th = ({ label, k, right }: { label: string; k: SortKey; right?: boolean }) => {
    const active = sort.key === k;
    const Icon = active ? (sort.dir === 'asc' ? IconChevronUp : IconChevronDown) : IconSelector;
    return (
      <Table.Th style={{ textAlign: right ? 'right' : undefined, whiteSpace: 'nowrap' }}>
        <UnstyledButton
          onClick={() => setSort({ key: k, dir: active && sort.dir === 'desc' ? 'asc' : active ? 'desc' : k === 'name' || k === 'target' || k === 'start' ? 'asc' : 'desc' })}
          aria-label={`Sort by ${label}`}
        >
          <Group gap={2} wrap="nowrap" justify={right ? 'flex-end' : 'flex-start'}>
            <Text size="xs" fw={600}>
              {label}
            </Text>
            <Icon size={13} />
          </Group>
        </UnstyledButton>
      </Table.Th>
    );
  };

  return (
    <>
      <Group gap="xs" mb="sm" align="flex-end" wrap="wrap">
        <TextInput
          size="xs"
          w={260}
          placeholder="Search file, target or tool…"
          leftSection={<IconSearch size={14} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          rightSection={query ? <CloseButton size="xs" onClick={() => setQuery('')} aria-label="Clear search" /> : null}
          aria-label="Search steps"
        />
        <Select size="xs" w={170} placeholder="All roles" data={roleOptions} value={filter.role} onChange={(r) => onFilter({ ...filter, role: r })} clearable aria-label="Role" />
        {categoryOptions.length > 0 && (
          <Select
            size="xs"
            w={190}
            placeholder="All legend groups"
            data={categoryOptions}
            value={filter.category === null ? null : String(filter.category)}
            onChange={(c) => onFilter({ ...filter, category: c === null ? null : Number(c) })}
            clearable
            aria-label="Legend group"
          />
        )}
        <Select
          size="xs"
          w={230}
          placeholder="All targets"
          data={targetOptions}
          value={filter.target}
          onChange={(t) => onFilter({ ...filter, target: t })}
          searchable
          clearable
          limit={200}
          nothingFoundMessage="No such target"
          aria-label="Target"
        />
        {work.some((s) => s.result) && (
          <Checkbox size="xs" label="Failed only" checked={filter.failedOnly} onChange={(e) => onFilter({ ...filter, failedOnly: e.currentTarget.checked })} mb={6} />
        )}
        {isFilterActive(filter) && (
          <Button size="xs" variant="subtle" onClick={() => onFilter(EMPTY_FILTER)}>
            Reset
          </Button>
        )}
        <Button size="xs" variant="default" ml="auto" leftSection={<IconDownload size={14} />} onClick={exportCsv} disabled={rows.length === 0}>
          CSV
        </Button>
      </Group>

      <Text size="xs" c="dimmed" mb={6} className="num">
        <b style={{ color: 'var(--viz-text-1)' }}>{fmtNumber(rows.length)}</b> of {fmtNumber(work.length)} steps · {fmtDuration(stats.total)} in total · median{' '}
        {fmtDuration(stats.p50)} · p95 {fmtDuration(stats.p95)}
        {stats.cpu != null && <> · CPU {fmtDuration(stats.cpu)}</>}
        {stats.rss != null && <> · peak {fmtKb(stats.rss)}</>}
      </Text>

      <Table.ScrollContainer minWidth={760}>
        <Table highlightOnHover fz="xs" verticalSpacing={5}>
          <Table.Thead>
            <Table.Tr>
              <Th label="Step" k="name" />
              <Th label="Target" k="target" />
              <Table.Th>Type</Table.Th>
              <Th label="Start" k="start" right />
              <Th label="Duration" k="duration" right />
              {hasCpu && <Th label="CPU" k="cpu" right />}
              {hasRss && <Th label="Peak memory" k="rss" right />}
              {hasOut && <Th label="Output" k="output" right />}
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pageRows.map((s) => {
              const cat = s.category !== null ? categories.get(s.category) : undefined;
              return (
                <Table.Tr key={s.seq} className="clickable-row" onClick={() => onSelect(s.seq)}>
                  <Table.Td maw={420}>
                    <Text size="xs" fw={500} lineClamp={1} title={stepLabel(s)}>
                      {stepLabel(s)}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1} title={stepPath(s)}>
                      {stepPath(s) || '–'}
                    </Text>
                  </Table.Td>
                  <Table.Td maw={200}>
                    <Text size="xs" lineClamp={1} title={s.target ?? ''}>
                      {s.target ?? '–'}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <span className="legend-key" style={{ background: s.result ? v.critical : cat ? slotColor(v, cat.colorSlot) : roleColor(v, s.role) }} />
                    {cat?.name ?? s.role}
                    {s.result ? (
                      <Badge color="red" size="xs" ml={6}>
                        exit {s.result}
                      </Badge>
                    ) : null}
                  </Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtClock(s.startMs)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(s.durationMs)}</Table.Td>
                  {hasCpu && <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(cpuMs(s))}</Table.Td>}
                  {hasRss && <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtKb(s.maxRssKb)}</Table.Td>}
                  {hasOut && <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtBytes(s.outputBytes)}</Table.Td>}
                  <Table.Td w={32} onClick={(e) => e.stopPropagation()}>
                    <Tooltip label="Show on timeline">
                      <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => onLocate(s.seq)} aria-label="Show on timeline">
                        <IconCrosshair size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {rows.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="lg">
          No step matches.
        </Text>
      )}
      {rows.length > PAGE && (
        <Group justify="space-between" mt="sm">
          <Text size="xs" c="dimmed">
            {fmtNumber((page - 1) * PAGE + 1)}–{fmtNumber(Math.min(page * PAGE, rows.length))} of {fmtNumber(rows.length)}
          </Text>
          <Pagination size="sm" total={Math.ceil(rows.length / PAGE)} value={page} onChange={setPage} />
        </Group>
      )}
    </>
  );
}
