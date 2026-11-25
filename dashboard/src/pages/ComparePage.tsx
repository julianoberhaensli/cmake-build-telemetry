import { Anchor, Button, Group, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useCompare } from '../api/hooks';
import type { BuildListItem } from '../api/types';
import { EChart } from '../components/EChart';
import { Empty, ErrorNote, KeyValue, Loading, PageHeader, Panel } from '../components/Ui';
import { baseChart, categoryAxis, durationAxis, tipRow, useViz } from '../components/viz';
import { esc, fileName, fmtDate, fmtDuration } from '../lib/format';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const [a, setA] = useState(params.get('a') ?? '');
  const [b, setB] = useState(params.get('b') ?? '');
  const qa = params.get('a');
  const qb = params.get('b');
  const q = useCompare(qa && GUID.test(qa) ? qa : null, qb && GUID.test(qb) ? qb : null);

  return (
    <>
      <PageHeader title="Compare builds" subtitle="Per-file compile-time difference between a baseline (A) and a candidate (B)" />
      <Panel>
        <Group align="flex-end" gap="sm">
          <TextInput label="Build A (baseline)" placeholder="build id" w={340} value={a} onChange={(e) => setA(e.currentTarget.value.trim())} error={a && !GUID.test(a) ? 'not a build id' : undefined} />
          <TextInput label="Build B (candidate)" placeholder="build id" w={340} value={b} onChange={(e) => setB(e.currentTarget.value.trim())} error={b && !GUID.test(b) ? 'not a build id' : undefined} />
          <Button disabled={!GUID.test(a) || !GUID.test(b)} onClick={() => setParams({ a, b })}>
            Compare
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          Open a build and use “Compare” to prefill A, then paste the id of the second build (shown at the bottom of every build page).
        </Text>
      </Panel>
      <div style={{ height: 16 }} />
      {q.error && <ErrorNote error={q.error} />}
      {q.isLoading && <Loading h={300} />}
      {q.data && <CompareResultView a={q.data.a} b={q.data.b} files={q.data.files} />}
    </>
  );
}

function Summary({ label, b }: { label: string; b: BuildListItem }) {
  return (
    <Panel title={label}>
      <KeyValue
        items={[
          ['Build', <Anchor component={Link} to={`/builds/${b.id}`} size="xs">{b.project} · {fmtDate(b.startedAt)}</Anchor>],
          ['Machine', `${b.hostname} (${b.cpuModel ?? '?'}, ${b.logicalCores ?? '?'} threads)`],
          ['Wall-clock', fmtDuration(b.wallMs)],
          ['Translation units', String(b.compileCount)],
          ['Compiler time', fmtDuration(b.compileMs)],
          ['Parallelism', b.parallelism ? `${b.parallelism.toFixed(1)}×` : '–'],
          ['Branch', b.branch],
        ]}
      />
    </Panel>
  );
}

function CompareResultView({ a, b, files }: { a: BuildListItem; b: BuildListItem; files: { source: string; target: string | null; aMs: number | null; bMs: number | null; deltaMs: number }[] }) {
  const v = useViz();
  const both = files.filter((f) => f.aMs != null && f.bMs != null);
  const top = both.slice(0, 20);
  // Diverging: slower in B (positive) red pole, faster (negative) blue pole.
  const option = useMemo(
    () => ({
      ...baseChart(v),
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        ...baseChart(v).tooltip,
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const f = top[p.dataIndex];
          return (
            `<div style="margin-bottom:4px;word-break:break-all;max-width:420px">${esc(f.source)}</div>` +
            tipRow(v.muted, 'build A', fmtDuration(f.aMs)) +
            tipRow(f.deltaMs > 0 ? v.divPos : v.divNeg, 'build B', fmtDuration(f.bMs))
          );
        },
      },
      xAxis: durationAxis(v, top.map((f) => f.deltaMs), { ticks: 4, signed: true }),
      yAxis: categoryAxis(v, { data: top.map((f) => fileName(f.source)), inverse: true, axisLabel: { color: v.text2, fontSize: 11, width: 200, overflow: 'truncate' } }),
      series: [
        {
          type: 'bar',
          barMaxWidth: 14,
          data: top.map((f) => ({
            value: f.deltaMs,
            itemStyle: { color: f.deltaMs > 0 ? v.divPos : v.divNeg, borderRadius: f.deltaMs > 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] },
          })),
          label: {
            show: true,
            position: 'right',
            color: v.text2,
            fontSize: 11,
            formatter: (p: { value: number }) => `${p.value > 0 ? '+' : '−'}${fmtDuration(Math.abs(p.value))}`,
          },
        },
      ],
    }),
    [top, v],
  );
  const slower = both.filter((f) => f.deltaMs > 0).reduce((s, f) => s + f.deltaMs, 0);
  const faster = both.filter((f) => f.deltaMs < 0).reduce((s, f) => s - f.deltaMs, 0);

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Summary label="A · baseline" b={a} />
        <Summary label="B · candidate" b={b} />
      </SimpleGrid>
      <Panel
        title="Largest per-file differences (B − A)"
        subtitle={`${both.length} files compiled in both builds · ${fmtDuration(slower)} slower in total, ${fmtDuration(faster)} faster`}
      >
        {top.length > 0 ? (
          <>
            <Group gap="md" mb={6}>
              <Text size="xs" c="dimmed">
                <span className="legend-key" style={{ background: v.divPos }} />
                slower in B
              </Text>
              <Text size="xs" c="dimmed">
                <span className="legend-key" style={{ background: v.divNeg }} />
                faster in B
              </Text>
            </Group>
            <EChart option={option} height={Math.max(160, top.length * 26 + 30)} ariaLabel="Per-file compile time difference" />
          </>
        ) : (
          <Empty>The two builds have no compiled files in common.</Empty>
        )}
      </Panel>
      <Panel title="All files">
        <Table.ScrollContainer minWidth={700}>
          <Table fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Translation unit</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>A</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>B</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Δ</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {files.map((f) => (
                <Table.Tr key={f.source}>
                  <Table.Td>
                    <Text size="xs">{f.source}</Text>
                  </Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{f.aMs == null ? 'not compiled' : fmtDuration(f.aMs)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{f.bMs == null ? 'not compiled' : fmtDuration(f.bMs)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>
                    {f.aMs != null && f.bMs != null ? `${f.deltaMs > 0 ? '+' : f.deltaMs < 0 ? '−' : ''}${fmtDuration(Math.abs(f.deltaMs))}` : '–'}
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
