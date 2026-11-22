import { Badge, Button, Group, Modal, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useDeleteMachine, useIsAdmin } from '../api/admin';
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
        actions={<DeleteMachineButton id={m.id} hostname={m.hostname} />}
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

function DeleteMachineButton({ id, hostname }: { id: number; hostname: string | null }) {
  const isAdmin = useIsAdmin();
  const del = useDeleteMachine();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!isAdmin) return null;
  return (
    <>
      <Button size="xs" variant="default" color="red" leftSection={<IconTrash size={14} />} onClick={() => setOpen(true)}>
        Delete machine
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={`Delete ${hostname ?? 'this machine'}?`} centered>
        <Text size="sm">
          The machine and <b>all of its builds</b> (in every time range) are removed permanently. This cannot be undone. If it uploads
          again, it is added back as a new machine.
        </Text>
        {del.error && (
          <Text size="sm" c="red" mt="xs">
            {del.error.message}
          </Text>
        )}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button color="red" loading={del.isPending} onClick={() => del.mutate(id, { onSuccess: () => navigate('/machines') })}>
            Delete machine
          </Button>
        </Group>
      </Modal>
    </>
  );
}
