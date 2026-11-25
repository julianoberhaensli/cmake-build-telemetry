import { Badge, Group, SegmentedControl, Stack, Table, Text, Tooltip } from '@mantine/core';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useHardware, useMachines } from '../api/hooks';
import { NoteText, RankedBars } from '../components/charts';
import { FilterBar } from '../components/FilterBar';
import { Empty, ErrorNote, Loading, PageHeader, Panel } from '../components/Ui';
import { fmtAgo, fmtDuration, fmtMb, fmtNumber } from '../lib/format';
import { useFilters } from '../state/filters';

const SPEED_HELP =
  'Each compile step is divided by the fleet-wide median time of the same file in the same project; the index is 100 divided by the median of those ratios. 100 = fleet median, 150 = compiles 1.5× as fast. Comparable across projects and file mixes.';

export function MachinesPage() {
  const { filters } = useFilters();
  const [view, setView] = useState<'machines' | 'hardware'>('machines');
  return (
    <>
      <PageHeader
        title="Machines"
        subtitle="Compare hardware: compile speed of the same translation units and full-build times"
        actions={
          <SegmentedControl
            size="xs"
            value={view}
            onChange={(v) => setView(v as 'machines' | 'hardware')}
            data={[
              { value: 'machines', label: 'Individual machines' },
              { value: 'hardware', label: 'Hardware profiles' },
            ]}
          />
        }
      />
      <FilterBar />
      {view === 'machines' ? <MachinesView /> : <HardwareView />}
      {!filters.project && (
        <NoteText>Tip: pick a project to compare full-build times like for like; the speed index is already normalized per file.</NoteText>
      )}
    </>
  );
}

function MachinesView() {
  const { filters } = useFilters();
  const navigate = useNavigate();
  const q = useMachines(filters);
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Loading h={400} />;
  if (q.data.length === 0) return <Panel><Empty /></Panel>;
  const ranked = [...q.data].filter((m) => m.speedIndex != null).sort((a, b) => (b.speedIndex ?? 0) - (a.speedIndex ?? 0));
  return (
    <Stack gap="md">
      {ranked.length > 0 && (
        <Panel title="Speed index" subtitle="100 = fleet median compile speed for identical files; higher is faster">
          <RankedBars
            labels={ranked.map((m) => `${m.hostname} · ${m.cpuModel ?? ''}`)}
            values={ranked.map((m) => m.speedIndex ?? 0)}
            format={(n) => n.toFixed(0)}
            reference={{ value: 100, label: 'median' }}
            ariaLabel="Machines ranked by speed index"
            tooltipExtra={(i) => `<div style="opacity:.75">${ranked[i].logicalCores} threads · ${fmtMb(ranked[i].memoryMb)} · ${fmtNumber(ranked[i].speedSamples)} samples</div>`}
            onClick={(p) => navigate(`/machines/${ranked[p.dataIndex].id}`)}
          />
          <NoteText>{SPEED_HELP}</NoteText>
        </Panel>
      )}
      <Panel title="All machines">
        <Table.ScrollContainer minWidth={1100}>
          <Table highlightOnHover fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Machine</Table.Th>
                <Table.Th>CPU</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Threads</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Memory</Table.Th>
                <Table.Th>OS</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Builds</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Median full build</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Avg. TU</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Parallelism</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>
                  <Tooltip label={SPEED_HELP} multiline w={320} withArrow>
                    <span>Speed index ⓘ</span>
                  </Tooltip>
                </Table.Th>
                <Table.Th>Last seen</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {q.data.map((m) => (
                <Table.Tr key={m.id} className="clickable-row" onClick={() => navigate(`/machines/${m.id}`)}>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" fw={500}>
                        {m.hostname}
                      </Text>
                      {m.isCi && <Badge size="xs" variant="outline" color="gray">CI</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={1}>
                      {m.cpuModel}
                    </Text>
                  </Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{m.logicalCores ?? '–'}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtMb(m.memoryMb)}</Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={1}>
                      {m.osPretty ?? m.osName}
                    </Text>
                  </Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>
                    {m.builds}
                    {m.failed > 0 && <Text span size="xs" c="red"> ({m.failed} failed)</Text>}
                  </Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(m.p50FullWallMs)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(m.avgCompileMs)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{m.avgParallelism ? `${m.avgParallelism.toFixed(1)}×` : '–'}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>
                    <Text size="sm" fw={600}>
                      {m.speedIndex?.toFixed(0) ?? '–'}
                    </Text>
                  </Table.Td>
                  <Table.Td>{fmtAgo(m.lastSeen)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Panel>
    </Stack>
  );
}

function HardwareView() {
  const { filters } = useFilters();
  const q = useHardware(filters);
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Loading h={400} />;
  if (q.data.length === 0) return <Panel><Empty /></Panel>;
  const withFull = [...q.data].filter((h) => h.p50FullWallMs != null).sort((a, b) => (a.p50FullWallMs ?? 0) - (b.p50FullWallMs ?? 0));
  return (
    <Stack gap="md">
      {withFull.length > 0 && (
        <Panel title="Median full build by hardware profile" subtitle={filters.project ? `Project ${filters.project}` : 'All projects – pick one for a like-for-like comparison'}>
          <RankedBars
            labels={withFull.map((h) => h.key)}
            values={withFull.map((h) => h.p50FullWallMs ?? 0)}
            format={fmtDuration}
            durationAxis
            ariaLabel="Hardware profiles by median full build time"
            tooltipExtra={(i) => `<div style="opacity:.75">${withFull[i].machines} machines · ${withFull[i].builds} builds · speed index ${withFull[i].speedIndex?.toFixed(0) ?? '–'}</div>`}
          />
        </Panel>
      )}
      <Panel title="Hardware profiles" subtitle="Machines grouped by CPU model, hardware threads, memory and OS">
        <Table.ScrollContainer minWidth={900}>
          <Table fz="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>CPU</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Threads</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Memory</Table.Th>
                <Table.Th>OS</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Machines</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Builds</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Median full build</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Avg. TU</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Speed index</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {q.data.map((h) => (
                <Table.Tr key={h.key}>
                  <Table.Td>{h.cpuModel}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{h.logicalCores}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{h.memoryGb} GB</Table.Td>
                  <Table.Td>{h.osName}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{h.machines}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{h.builds}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(h.p50FullWallMs)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(h.avgCompileMs)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>
                    <Text size="sm" fw={600}>
                      {h.speedIndex?.toFixed(0) ?? '–'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Panel>
    </Stack>
  );
}
