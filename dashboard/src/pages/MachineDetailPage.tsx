import { Badge, Group, SimpleGrid, Stack } from '@mantine/core';
import { useParams } from 'react-router';
import { useBuilds, useMachine, useTrend } from '../api/hooks';
import { BuildsTable } from '../components/BuildsTable';
import { DurationTrend } from '../components/charts';
import { FilterBar } from '../components/FilterBar';
import { ErrorNote, KeyValue, Loading, PageHeader, Panel, StatTile } from '../components/Ui';
import { fmtDate, fmtDuration, fmtKb, fmtMb, fmtNumber } from '../lib/format';
import { useFilters } from '../state/filters';

export function MachineDetailPage() {
  const id = Number(useParams().id);
  const { filters } = useFilters();
  const machine = useMachine(id, filters);
  const trend = useTrend(filters, { machine: id });
  const builds = useBuilds(filters, { machine: id, pageSize: 15 });

  if (machine.error) return <ErrorNote error={machine.error} />;
  if (!machine.data) return <Loading h={400} />;
  const m = machine.data;

  return (
    <>
      <PageHeader
        title={
          <Group gap="sm">
            <span>{m.hostname}</span>
            {m.isCi ? <Badge variant="outline" color="gray">CI runner</Badge> : <Badge variant="light">Developer machine</Badge>}
          </Group>
        }
        subtitle={`${m.cpuModel ?? 'unknown CPU'} · ${m.logicalCores ?? '?'} threads · ${fmtMb(m.memoryMb)} · ${m.osPretty ?? m.osName ?? ''}`}
      />
      <FilterBar />
      <Stack gap="md">
        <SimpleGrid cols={{ base: 2, md: 3, xl: 6 }} spacing="md">
          <StatTile label="Builds" value={fmtNumber(m.builds)} />
          <StatTile label="Median build" value={fmtDuration(m.p50WallMs)} />
          <StatTile label="Median full build" value={fmtDuration(m.p50FullWallMs)} />
          <StatTile label="Avg. compile per TU" value={fmtDuration(m.avgCompileMs)} />
          <StatTile label="Speed index" value={m.speedIndex?.toFixed(0) ?? '–'} hint="100 = fleet median compile speed for identical files." />
          <StatTile label="Peak step memory" value={fmtKb(m.maxRssKb)} />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
          <div style={{ gridColumn: 'span 2' }}>
            <Panel title="Build duration on this machine">{trend.data ? <DurationTrend data={trend.data} /> : <Loading h={280} />}</Panel>
          </div>
          <Panel title="Hardware">
            <KeyValue
              items={[
                ['CPU', m.cpuModel],
                ['Vendor', m.cpuVendor],
                ['Cores / threads', `${m.physicalCores ?? '?'} / ${m.logicalCores ?? '?'}`],
                ['Clock (reported)', m.cpuMhz ? `${Math.round(m.cpuMhz)} MHz` : null],
                ['Memory', fmtMb(m.memoryMb)],
                ['OS', m.osPretty ?? m.osName],
                ['OS release', m.osRelease],
                ['Machine id', m.machineKey],
                ['First seen', fmtDate(m.firstSeen)],
                ['Last seen', fmtDate(m.lastSeen)],
              ]}
            />
          </Panel>
        </SimpleGrid>
        <Panel title="Recent builds">{builds.data ? <BuildsTable items={builds.data.items} compact /> : <Loading />}</Panel>
      </Stack>
    </>
  );
}
