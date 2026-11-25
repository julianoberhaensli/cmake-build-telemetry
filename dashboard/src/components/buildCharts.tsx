import { useMemo } from 'react';
import type { TargetAgg } from '../api/types';
import { esc, fmtDuration } from '../lib/format';
import { EChart } from './EChart';
import { baseChart, categoryAxis, durationAxis, tipRow, useViz } from './viz';

/** Per-target time split into compile / link / custom (stacked, legend + tooltip). */
export function TargetBreakdown({ targets, onTarget }: { targets: TargetAgg[]; onTarget?: (target: string) => void }) {
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
      xAxis: durationAxis(v, top.map((t) => t.compileMs + t.linkMs + t.customMs), { ticks: 4 }),
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
  return (
    <EChart
      option={option}
      height={Math.max(160, top.length * 28 + 50)}
      onClick={onTarget ? (p) => onTarget(top[p.dataIndex].target) : undefined}
      ariaLabel="Time per target split by step type"
    />
  );
}
