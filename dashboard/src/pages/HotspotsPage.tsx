import { Badge, Group, Select, Stack, Table, Tabs, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useSearchParams } from 'react-router';
import { useFileHotspots, useTargetHotspots } from '../api/hooks';
import { NoteText, RankedBars } from '../components/charts';
import { FilterBar } from '../components/FilterBar';
import { Empty, ErrorNote, Loading, PageHeader, Panel } from '../components/Ui';
import { fileName, fmtDuration, fmtKb, fmtNumber } from '../lib/format';
import { fmtSeconds } from '../lib/format';
import { useFilters } from '../state/filters';

const FILE_SORTS = [
  { value: 'totalMs', label: 'Total time (impact)' },
  { value: 'avgMs', label: 'Average time' },
  { value: 'p90Ms', label: '90th percentile' },
  { value: 'maxMs', label: 'Slowest single compile' },
  { value: 'compiles', label: 'Most recompiled' },
  { value: 'maxRssKb', label: 'Peak memory' },
];

export function HotspotsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'files';
  return (
    <>
      <PageHeader title="Hotspots" subtitle="Where build time goes: translation units and targets across all builds in range" />
      <FilterBar />
      <Tabs
        value={tab}
        onChange={(v) =>
          setParams((p) => {
            const n = new URLSearchParams(p);
            n.set('tab', v ?? 'files');
            return n;
          })
        }
        mb="md"
      >
        <Tabs.List>
          <Tabs.Tab value="files">Translation units</Tabs.Tab>
          <Tabs.Tab value="targets">Targets</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {tab === 'files' ? <FilesView /> : <TargetsView />}
    </>
  );
}

function metric(sort: string, f: { totalMs: number; avgMs: number | null; p90Ms: number | null; maxMs: number; compiles: number; maxRssKb: number | null }) {
  switch (sort) {
    case 'avgMs':
      return f.avgMs ?? 0;
    case 'p90Ms':
      return f.p90Ms ?? 0;
    case 'maxMs':
      return f.maxMs;
    case 'compiles':
      return f.compiles;
    case 'maxRssKb':
      return f.maxRssKb ?? 0;
    default:
      return f.totalMs;
  }
}

function FilesView() {
  const { filters } = useFilters();
  const [params, setParams] = useSearchParams();
  const sort = params.get('sort') ?? 'totalMs';
  const search = params.get('search') ?? '';
  const [debounced] = useDebouncedValue(search, 300);
  const q = useFileHotspots(filters, { sort, limit: 200, search: debounced || null });
  const set = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );
  const format = sort === 'compiles' ? fmtNumber : sort === 'maxRssKb' ? fmtKb : fmtDuration;
  const top = (q.data ?? []).slice(0, 15);

  return (
    <Stack gap="md">
      <Group gap="sm">
        <TextInput size="xs" w={320} placeholder="Filter by path…" leftSection={<IconSearch size={14} />} value={search} onChange={(e) => set('search', e.currentTarget.value)} />
        <Select size="xs" w={220} value={sort} onChange={(v) => set('sort', v)} data={FILE_SORTS} allowDeselect={false} aria-label="Rank by" />
      </Group>
      {q.error && <ErrorNote error={q.error} />}
      {!q.data ? (
        <Loading h={400} />
      ) : q.data.length === 0 ? (
        <Panel>
          <Empty />
        </Panel>
      ) : (
        <>
          <Panel title={`Top translation units by ${FILE_SORTS.find((s) => s.value === sort)?.label.toLowerCase()}`}>
            <RankedBars labels={top.map((f) => f.source)} values={top.map((f) => metric(sort, f))} format={format} axisFormat={sort === 'compiles' || sort === 'maxRssKb' ? undefined : fmtSeconds} ariaLabel="Top translation units" />
            <NoteText>“Total time” = average × number of compiles: the files whose speed-up saves the most fleet time.</NoteText>
          </Panel>
          <Panel>
            <Table.ScrollContainer minWidth={1000}>
              <Table fz="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Translation unit</Table.Th>
                    <Table.Th>Target</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Compiles</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Machines</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Average</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>p90</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Max</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Peak memory</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {q.data.map((f) => (
                    <Table.Tr key={f.source}>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {fileName(f.source)}
                          {f.failures > 0 && <Badge size="xs" color="red" ml={6}>{f.failures} failed</Badge>}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {f.source}
                        </Text>
                      </Table.Td>
                      <Table.Td>{f.target}</Table.Td>
                      <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtNumber(f.compiles)}</Table.Td>
                      <Table.Td className="num" style={{ textAlign: 'right' }}>{f.machines}</Table.Td>
                      <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(f.avgMs)}</Table.Td>
                      <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(f.p90Ms)}</Table.Td>
                      <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(f.maxMs)}</Table.Td>
                      <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(f.totalMs)}</Table.Td>
                      <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtKb(f.maxRssKb)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Panel>
        </>
      )}
    </Stack>
  );
}

function TargetsView() {
  const { filters } = useFilters();
  const q = useTargetHotspots(filters, { limit: 100 });
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Loading h={400} />;
  if (q.data.length === 0) return <Panel><Empty /></Panel>;
  const top = q.data.slice(0, 15);
  return (
    <Stack gap="md">
      <Panel title="Targets by accumulated time" subtitle="Compile + link + custom commands, summed over all builds in range">
        <RankedBars labels={top.map((t) => t.target)} values={top.map((t) => t.totalMs)} format={fmtDuration} axisFormat={fmtSeconds} ariaLabel="Targets by accumulated time" />
      </Panel>
      <Panel>
        <Table.ScrollContainer minWidth={800}>
          <Table fz="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Target</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Builds</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Compiles</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Avg. compile</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Avg. link</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {q.data.map((t) => (
                <Table.Tr key={t.target}>
                  <Table.Td fw={500}>{t.target}</Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {t.targetType ?? '–'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtNumber(t.builds)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtNumber(t.compiles)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(t.avgCompileMs)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(t.avgLinkMs)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(t.totalMs)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Panel>
    </Stack>
  );
}
