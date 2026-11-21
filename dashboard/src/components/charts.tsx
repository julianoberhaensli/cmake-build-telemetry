import { Group, SegmentedControl, Table, Text } from '@mantine/core';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import type { TrendPoint } from '../api/types';
import { esc, fmtDuration, fmtSeconds } from '../lib/format';
import { EChart, type ChartClick } from './EChart';
import { baseChart, categoryAxis, tipRow, useViz, valueAxis } from './viz';

function bucketLabel(iso: string, spanDays: number) {
  return spanDays <= 2 ? dayjs(iso).format('HH:mm') : dayjs(iso).format('MMM D');
}

/** Build duration over time: median and 90th percentile (one y-axis, legend + end labels). */
export function DurationTrend({ data, height = 280 }: { data: TrendPoint[]; height?: number }) {
  const v = useViz();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const spanDays = data.length > 1 ? dayjs(data[data.length - 1].bucket).diff(dayjs(data[0].bucket), 'day') : 0;

  const option = useMemo(() => {
    const series = [
      { name: 'Median (p50)', key: 'p50WallMs' as const, color: v.series[0] },
      { name: '90th percentile', key: 'p90WallMs' as const, color: v.series[1] },
    ];
    return {
      ...baseChart(v),
      grid: { left: 8, right: 96, top: 36, bottom: 8, containLabel: true },
      legend: {
        top: 0,
        left: 0,
        icon: 'roundRect',
        itemWidth: 14,
        itemHeight: 3,
        textStyle: { color: v.text2, fontSize: 12 },
      },
      tooltip: {
        ...baseChart(v).tooltip,
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: v.axis, width: 1 } },
        formatter: (ps: { dataIndex: number }[]) => {
          const p = data[ps[0].dataIndex];
          return (
            `<div style="margin-bottom:4px;opacity:.75">${esc(dayjs(p.bucket).format('ddd, MMM D YYYY HH:mm'))} · ${p.builds} builds</div>` +
            series.map((s) => tipRow(s.color, s.name, fmtDuration(p[s.key]), 'line')).join('')
          );
        },
      },
      xAxis: categoryAxis(v, { data: data.map((d) => bucketLabel(d.bucket, spanDays)), boundaryGap: false }),
      yAxis: valueAxis(v, (n: number) => fmtSeconds(n)),
      series: series.map((s) => ({
        name: s.name,
        type: 'line',
        data: data.map((d) => d[s.key]),
        connectNulls: true,
        showSymbol: data.length < 40,
        symbol: 'circle',
        symbolSize: 8,
        itemStyle: { color: s.color, borderColor: v.surface, borderWidth: 2 },
        lineStyle: { width: 2, color: s.color, cap: 'round', join: 'round' },
        emphasis: { focus: 'series' },
        endLabel: {
          show: true,
          color: v.text2,
          fontSize: 11,
          formatter: (p: { value: number }) => `${s.name.split(' ')[0]} ${fmtDuration(p.value)}`,
        },
      })),
    };
  }, [data, v, spanDays]);

  return (
    <>
      <Group justify="flex-end" mb={4}>
        <SegmentedControl size="xs" value={view} onChange={(x) => setView(x as 'chart' | 'table')} data={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
      </Group>
      {view === 'chart' ? (
        <EChart option={option} height={height} ariaLabel="Build duration percentiles over time" />
      ) : (
        <Table.ScrollContainer minWidth={400} mah={height} type="native">
          <Table fz="xs" stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Period</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Builds</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Failed</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Median</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>p90</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Full build median</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((d) => (
                <Table.Tr key={d.bucket}>
                  <Table.Td>{dayjs(d.bucket).format('YYYY-MM-DD HH:mm')}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{d.builds}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{d.failed}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(d.p50WallMs)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(d.p90WallMs)}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(d.fullP50WallMs)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </>
  );
}

/** Builds per bucket, stacked: succeeded (series blue) + failed (status critical, labelled). */
export function BuildVolume({ data, height = 220 }: { data: TrendPoint[]; height?: number }) {
  const v = useViz();
  const spanDays = data.length > 1 ? dayjs(data[data.length - 1].bucket).diff(dayjs(data[0].bucket), 'day') : 0;
  const option = useMemo(
    () => ({
      ...baseChart(v),
      grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: v.text2, fontSize: 12 } },
      tooltip: {
        ...baseChart(v).tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: v.s1Wash } },
        formatter: (ps: { dataIndex: number }[]) => {
          const p = data[ps[0].dataIndex];
          return (
            `<div style="margin-bottom:4px;opacity:.75">${esc(dayjs(p.bucket).format('ddd, MMM D YYYY HH:mm'))}</div>` +
            tipRow(v.series[0], 'succeeded', String(p.builds - p.failed)) +
            tipRow(v.critical, 'failed', String(p.failed))
          );
        },
      },
      xAxis: categoryAxis(v, { data: data.map((d) => bucketLabel(d.bucket, spanDays)) }),
      yAxis: valueAxis(v, (n: number) => String(n), { minInterval: 1 }),
      series: [
        {
          name: 'Succeeded',
          type: 'bar',
          stack: 'b',
          barMaxWidth: 24,
          data: data.map((d) => d.builds - d.failed),
          itemStyle: { color: v.series[0], borderColor: v.surface, borderWidth: 1, borderRadius: [0, 0, 0, 0] },
        },
        {
          name: 'Failed',
          type: 'bar',
          stack: 'b',
          barMaxWidth: 24,
          data: data.map((d) => d.failed),
          itemStyle: { color: v.critical, borderColor: v.surface, borderWidth: 1, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }),
    [data, v, spanDays],
  );
  return <EChart option={option} height={height} ariaLabel="Builds per period, succeeded and failed" />;
}

/** Horizontal ranked bars for one measure (single series, so no legend box). */
export function RankedBars({
  labels,
  values,
  format,
  height,
  onClick,
  reference,
  ariaLabel,
  tooltipExtra,
  axisFormat,
}: {
  labels: string[];
  values: number[];
  format: (n: number) => string;
  axisFormat?: (n: number) => string;
  height?: number;
  onClick?: ChartClick;
  reference?: { value: number; label: string };
  ariaLabel: string;
  tooltipExtra?: (i: number) => string;
}) {
  const v = useViz();
  const h = height ?? Math.max(120, labels.length * 30 + 40);
  const option = useMemo(
    () => ({
      ...baseChart(v),
      grid: { left: 8, right: 64, top: reference ? 20 : 4, bottom: 4, containLabel: true },
      tooltip: {
        ...baseChart(v).tooltip,
        trigger: 'item',
        formatter: (p: { dataIndex: number }) =>
          `<div style="max-width:420px;white-space:normal;word-break:break-all;margin-bottom:4px">${esc(labels[p.dataIndex])}</div>` +
          tipRow(v.series[0], '', format(values[p.dataIndex])) +
          (tooltipExtra ? tooltipExtra(p.dataIndex) : ''),
      },
      xAxis: valueAxis(v, axisFormat ?? format, { splitNumber: 4 }),
      yAxis: categoryAxis(v, {
        data: labels,
        inverse: true,
        axisLabel: {
          color: v.text2,
          fontSize: 11,
          width: 220,
          overflow: 'truncate',
        },
      }),
      series: [
        {
          type: 'bar',
          data: values,
          barMaxWidth: 16,
          itemStyle: { color: v.series[0], borderRadius: [0, 4, 4, 0] },
          emphasis: { itemStyle: { color: v.series[0], opacity: 0.85 } },
          cursor: onClick ? 'pointer' : 'default',
          label: { show: true, position: 'right', color: v.text2, fontSize: 11, formatter: (p: { value: number }) => format(p.value) },
          markLine: reference
            ? {
                symbol: 'none',
                silent: true,
                lineStyle: { color: v.muted, width: 1, type: 'solid' },
                label: { formatter: reference.label, color: v.muted, fontSize: 11, position: 'start' },
                data: [{ xAxis: reference.value }],
              }
            : undefined,
        },
      ],
    }),
    [labels, values, format, axisFormat, v, reference, onClick, tooltipExtra],
  );
  return <EChart option={option} height={h} onClick={onClick} ariaLabel={ariaLabel} />;
}

export function NoteText({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xs" c="dimmed" mt="xs">
      {children}
    </Text>
  );
}
