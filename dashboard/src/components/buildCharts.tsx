import { Group, Text } from '@mantine/core';
import * as echarts from 'echarts/core';
import { useMemo } from 'react';
import type { Step, TargetAgg } from '../api/types';
import { esc, fileName, fmtDuration, fmtKb, fmtSeconds } from '../lib/format';
import { EChart } from './EChart';
import { ROLE_GROUPS, ROLE_LABEL, baseChart, categoryAxis, roleColor, roleGroup, tipRow, useViz, valueAxis } from './viz';

function stepName(s: Step) {
  return s.source ? fileName(s.source) : s.output ? fileName(s.output) : s.target ?? s.role;
}

/**
 * Gantt view of one build: every step on the concurrency lane it ran in (reconstructed
 * server-side), coloured by role in fixed order. Phases (configure, generate, the build
 * tool itself) sit on their own top row. Zoom with the wheel / slider, click for details.
 */
export function Timeline({ steps, onSelect }: { steps: Step[]; onSelect: (seq: number) => void }) {
  const v = useViz();
  const lanes = Math.max(0, ...steps.map((s) => s.lane)) + 1;
  const visible = steps.filter((s) => s.lane >= 0 || s.startMs > -120_000); // hide configure runs long before the build
  const height = Math.min(Math.max(lanes * 12 + 110, 240), 760);
  const rolesPresent = ROLE_GROUPS.filter((g) => steps.some((s) => roleGroup(s.role) === g));

  const option = useMemo(() => {
    const t0 = Math.min(0, ...visible.map((s) => s.startMs));
    const categories = ['Phases', ...Array.from({ length: lanes }, (_, i) => `Job ${i + 1}`)];
    return {
      ...baseChart(v),
      animation: false,
      grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
      tooltip: {
        ...baseChart(v).tooltip,
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const s = visible[p.dataIndex];
          const color = roleColor(v, s.role, !!s.result);
          return (
            `<div style="max-width:460px;white-space:normal;word-break:break-all;margin-bottom:4px"><b>${esc(stepName(s))}</b>` +
            `<div style="opacity:.7">${esc(s.source ?? s.output ?? '')}</div></div>` +
            tipRow(color, s.role + (s.target ? ` · ${esc(s.target)}` : ''), fmtDuration(s.durationMs)) +
            `<div style="opacity:.75;margin-top:2px">starts at ${fmtSeconds(s.startMs)}${s.maxRssKb ? ` · peak ${fmtKb(s.maxRssKb)}` : ''}${s.result ? ` · <b>exit code ${s.result}</b>` : ''}</div>`
          );
        },
      },
      dataZoom: [
        // no 'inside' zoom: it captures the mouse wheel and blocks page scrolling
        { type: 'slider', xAxisIndex: 0, height: 18, bottom: 8, filterMode: 'weakFilter', borderColor: v.grid, textStyle: { color: v.muted } },
      ],
      xAxis: valueAxis(v, (n: number) => fmtSeconds(n), { min: t0, max: 'dataMax', splitNumber: 8 }),
      yAxis: categoryAxis(v, {
        data: categories,
        inverse: true,
        axisLabel: { color: v.muted, fontSize: 10, interval: lanes > 24 ? Math.ceil(lanes / 24) - 1 : 0 },
        splitLine: { show: false },
      }),
      series: [
        {
          type: 'custom',
          cursor: 'pointer',
          encode: { x: [1, 2], y: 0 },
          data: visible.map((s, i) => ({
            value: [s.lane + 1, s.startMs, s.startMs + Math.max(s.durationMs, 1), i],
            itemStyle: { color: roleColor(v, s.role, !!s.result) },
          })),
          renderItem: (params: { coordSys: { x: number; y: number; width: number; height: number } }, api: {
            value: (i: number) => number;
            coord: (v: number[]) => number[];
            size: (v: number[]) => number[];
            style: () => object;
          }) => {
            const lane = api.value(0);
            const start = api.coord([api.value(1), lane]);
            const end = api.coord([api.value(2), lane]);
            const h = Math.max(3, api.size([0, 1])[1] * 0.72);
            const rect = echarts.graphic.clipRectByRect(
              { x: start[0], y: start[1] - h / 2, width: Math.max(end[0] - start[0] - 1, 1), height: h },
              { x: params.coordSys.x, y: params.coordSys.y, width: params.coordSys.width, height: params.coordSys.height },
            );
            return rect && { type: 'rect', transition: [], shape: { ...rect, r: Math.min(2, h / 2) }, style: api.style() };
          },
        },
      ],
    };
  }, [visible, lanes, v]);

  return (
    <>
      <Group gap="md" mb={6}>
        {rolesPresent.map((r) => (
          <Text key={r} size="xs" c="dimmed">
            <span className="legend-key" style={{ background: r === 'tool' ? v.axis : v.series[ROLE_GROUPS.indexOf(r)] }} />
            {ROLE_LABEL[r]}
          </Text>
        ))}
        {steps.some((s) => s.result) && (
          <Text size="xs" c="dimmed">
            <span className="legend-key" style={{ background: v.critical }} />
            Failed step
          </Text>
        )}
      </Group>
      <EChart
        option={option}
        height={height}
        onClick={(p) => onSelect(visible[p.dataIndex].seq)}
        ariaLabel={`Build timeline with ${steps.length} steps on ${lanes} parallel jobs`}
      />
    </>
  );
}

/** Per-target time split into compile / link / custom (stacked, legend + tooltip). */
export function TargetBreakdown({ targets }: { targets: TargetAgg[] }) {
  const v = useViz();
  const top = targets.slice(0, 15);
  const option = useMemo(() => {
    const series = [
      { name: 'Compile', key: 'compileMs' as const, color: v.series[0] },
      { name: 'Link', key: 'linkMs' as const, color: v.series[1] },
      { name: 'Custom command', key: 'customMs' as const, color: v.series[2] },
    ].filter((s) => top.some((t) => t[s.key] > 0));
    return {
      ...baseChart(v),
      grid: { left: 8, right: 24, top: 32, bottom: 4, containLabel: true },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: v.text2, fontSize: 12 } },
      tooltip: {
        ...baseChart(v).tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: v.s1Wash } },
        formatter: (ps: { dataIndex: number }[]) => {
          const t = top[ps[0].dataIndex];
          return (
            `<div style="margin-bottom:4px"><b>${esc(t.target)}</b> <span style="opacity:.7">${esc(t.targetType ?? '')} · ${t.compiles} TUs</span></div>` +
            series.map((s) => tipRow(s.color, s.name, fmtDuration(t[s.key]))).join('')
          );
        },
      },
      xAxis: valueAxis(v, (n: number) => fmtSeconds(n), { splitNumber: 4 }),
      yAxis: categoryAxis(v, { data: top.map((t) => t.target), inverse: true, axisLabel: { color: v.text2, fontSize: 11, width: 160, overflow: 'truncate' } }),
      series: series.map((s, i) => ({
        name: s.name,
        type: 'bar',
        stack: 't',
        barMaxWidth: 16,
        data: top.map((t) => t[s.key]),
        itemStyle: { color: s.color, borderColor: v.surface, borderWidth: 1, borderRadius: i === series.length - 1 ? [0, 4, 4, 0] : 0 },
      })),
    };
  }, [top, v]);
  return <EChart option={option} height={Math.max(160, top.length * 28 + 50)} ariaLabel="Time per target split by step type" />;
}
