import { Anchor, Box, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { Link, useNavigate } from 'react-router';
import { useBuilds, useFileHotspots, useMachines, useOverview, useTrend } from '../api/hooks';
import { BuildsTable } from '../components/BuildsTable';
import { BuildVolume, DurationTrend, NoteText, RankedBars } from '../components/charts';
import { FilterBar } from '../components/FilterBar';
import { Empty, ErrorNote, Loading, PageHeader, Panel, StatTile } from '../components/Ui';
import { fileName, fmtDelta, fmtDuration, fmtNumber, fmtPercent } from '../lib/format';
import { useFilters } from '../state/filters';

export function OverviewPage() {
  const { filters } = useFilters();
  const navigate = useNavigate();
  const overview = useOverview(filters);
  const trend = useTrend(filters);
  const files = useFileHotspots(filters, { sort: 'avgMs', limit: 10 });
  const machines = useMachines(filters);
  const recent = useBuilds(filters, { pageSize: 6, sort: 'startedAt', dir: 'desc' });

  const o = overview.data;
  // deltas only when the previous period has enough builds to compare against
  const p = o?.previous && o.previous.builds >= Math.max(20, o.builds * 0.25) ? o.previous : undefined;
  const heroDelta = fmtDelta(o?.p50WallMs, p?.p50WallMs);
  const heroWorse = o?.p50WallMs != null && p?.p50WallMs != null && o.p50WallMs > p.p50WallMs;
  const speed = (machines.data ?? []).filter((m) => m.speedIndex != null).sort((a, b) => (b.speedIndex ?? 0) - (a.speedIndex ?? 0)).slice(0, 12);

  return (
    <>
      <PageHeader title="Overview" subtitle="Build performance across all instrumented machines" />
      <FilterBar />
      {overview.error && <ErrorNote error={overview.error} />}
      {!o && overview.isLoading && <Loading />}
      {o && o.builds === 0 && (
        <Panel>
          <Empty>
            No builds in this range yet. <Anchor component={Link} to="/setup">Connect a build</Anchor> to start collecting data.
          </Empty>
        </Panel>
      )}
      {o && o.builds > 0 && (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
            <Panel>
              <Text size="xs" c="dimmed" fw={500}>
                Median build time
              </Text>
              <div className="hero-figure">{fmtDuration(o.p50WallMs)}</div>
              <Group gap={6} mt={6}>
                {heroDelta && (
                  <Text size="sm" fw={600} style={{ color: heroWorse ? 'var(--viz-delta-bad)' : 'var(--viz-delta-good)' }}>
                    {heroWorse ? '▲' : '▼'} {heroDelta}
                  </Text>
                )}
                <Text size="sm" c="dimmed">
                  {heroDelta ? 'vs previous period · ' : ''}
                  {fmtNumber(o.builds)} builds on {o.machines} machines
                </Text>
              </Group>
            </Panel>
            <SimpleGrid cols={2} spacing="md" style={{ gridColumn: 'span 2' }}>
              <StatTile label="Full build median" value={fmtDuration(o.fullP50WallMs)} current={o.fullP50WallMs} previous={p?.fullP50WallMs} lowerIsBetter hint="Builds that compiled (nearly) every translation unit of the project." />
              <StatTile label="90th percentile" value={fmtDuration(o.p90WallMs)} current={o.p90WallMs} previous={p?.p90WallMs} lowerIsBetter />
              <StatTile label="Success rate" value={fmtPercent(o.successRate)} current={o.successRate} previous={p?.successRate} />
              <StatTile
                label="Avg. compile time per TU"
                value={fmtDuration(o.avgCompileMs)}
                current={o.avgCompileMs}
                previous={p?.avgCompileMs}
                lowerIsBetter
                hint="Total compiler time divided by compiled translation units."
              />
            </SimpleGrid>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
            <StatTile label="Builds" value={fmtNumber(o.builds)} current={o.builds} previous={p?.builds} />
            <StatTile label="Developer hours waiting" value={`${fmtNumber(o.totalWallMs / 3_600_000)} h`} current={o.totalWallMs} previous={p?.totalWallMs} lowerIsBetter hint="Sum of build wall-clock time in the period." />
            <StatTile label="Translation units compiled" value={fmtNumber(o.compileUnits)} current={o.compileUnits} previous={p?.compileUnits} />
            <StatTile label="Avg. parallelism" value={o.avgParallelism ? `${o.avgParallelism.toFixed(1)}×` : '–'} current={o.avgParallelism} previous={p?.avgParallelism} hint="Summed step time divided by wall-clock time: how many jobs ran concurrently on average." />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <Panel title="Build duration" subtitle="Median and 90th percentile wall-clock time per period">
              {trend.data ? <DurationTrend data={trend.data} /> : <Loading h={280} />}
            </Panel>
            <Panel title="Builds" subtitle="Succeeded and failed builds per period">
              {trend.data ? <BuildVolume data={trend.data} height={300} /> : <Loading h={300} />}
            </Panel>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <Panel title="Slowest translation units" subtitle="Average compile time" actions={<Anchor component={Link} size="xs" to="/hotspots">All hotspots</Anchor>}>
              {files.data && files.data.length > 0 ? (
                <RankedBars
                  labels={files.data.map((f) => fileName(f.source))}
                  values={files.data.map((f) => f.avgMs ?? 0)}
                  format={fmtDuration}
                  durationAxis
                  ariaLabel="Slowest translation units by average compile time"
                  tooltipExtra={(i) => `<div style="opacity:.75">${files.data![i].compiles} compiles · p90 ${fmtDuration(files.data![i].p90Ms)}</div>`}
                  onClick={(p) => navigate(`/hotspots?search=${encodeURIComponent(files.data![p.dataIndex].source)}`)}
                />
              ) : files.isLoading ? (
                <Loading />
              ) : (
                <Empty />
              )}
            </Panel>
            <Panel title="Machine speed index" subtitle="100 = fleet median compile speed for the same files" actions={<Anchor component={Link} size="xs" to="/machines">All machines</Anchor>}>
              {speed.length > 0 ? (
                <>
                  <RankedBars
                    labels={speed.map((m) => `${m.hostname} · ${m.cpuModel ?? ''}`)}
                    values={speed.map((m) => m.speedIndex ?? 0)}
                    format={(n) => n.toFixed(0)}
                    reference={{ value: 100, label: 'median' }}
                    ariaLabel="Machines ranked by speed index"
                    tooltipExtra={(i) => `<div style="opacity:.75">${speed[i].logicalCores} threads · ${fmtNumber(speed[i].speedSamples)} samples</div>`}
                    onClick={(p) => navigate(`/machines/${speed[p.dataIndex].id}`)}
                  />
                  <NoteText>Per-file compile time relative to the fleet median of the same file; higher is faster.</NoteText>
                </>
              ) : machines.isLoading ? (
                <Loading />
              ) : (
                <Empty>Speed index needs the same files compiled on at least two machines.</Empty>
              )}
            </Panel>
          </SimpleGrid>

          <Panel title="Recent builds" actions={<Anchor component={Link} size="xs" to="/builds">All builds</Anchor>}>
            {recent.data ? <BuildsTable items={recent.data.items} compact /> : <Loading />}
          </Panel>
          <Box h={8} />
        </Stack>
      )}
    </>
  );
}
