import { Button, Group, SegmentedControl, Select } from '@mantine/core';
import { IconFilterOff } from '@tabler/icons-react';
import { useFilterOptions } from '../api/hooks';
import { RANGES, useFilters, type FilterState } from '../state/filters';

/** One row of filters above the content; scopes every chart, stat and table below it. */
export function FilterBar({ showKind = true }: { showKind?: boolean }) {
  const { filters, setFilter, reset, isDefault } = useFilters();
  const { data: options } = useFilterOptions();

  return (
    <Group gap="sm" wrap="wrap" mb="lg" align="flex-end">
      <SegmentedControl
        size="xs"
        value={filters.range}
        onChange={(v) => setFilter('range', v as FilterState['range'])}
        data={RANGES.map((r) => ({ value: r.value, label: r.label }))}
        aria-label="Time range"
      />
      <Select
        size="xs"
        w={200}
        placeholder="All projects"
        clearable
        searchable
        value={filters.project}
        onChange={(v) => setFilter('project', v)}
        data={(options?.projects ?? []).map((p) => ({ value: p.name, label: `${p.name} (${p.count})` }))}
        aria-label="Project"
      />
      <Select
        size="xs"
        w={190}
        placeholder="All branches"
        clearable
        searchable
        value={filters.branch}
        onChange={(v) => setFilter('branch', v)}
        data={options?.branches ?? []}
        aria-label="Branch"
      />
      <Select
        size="xs"
        w={150}
        placeholder="All build types"
        clearable
        value={filters.buildType}
        onChange={(v) => setFilter('buildType', v)}
        data={options?.buildTypes ?? []}
        aria-label="Build type"
      />
      <SegmentedControl
        size="xs"
        value={filters.source}
        onChange={(v) => setFilter('source', v as FilterState['source'])}
        data={[
          { value: 'all', label: 'All' },
          { value: 'local', label: 'Developer' },
          { value: 'ci', label: 'CI' },
        ]}
        aria-label="Build source"
      />
      {showKind && (
        <Select
          size="xs"
          w={170}
          value={filters.kind}
          onChange={(v) => setFilter('kind', (v ?? 'builds') as FilterState['kind'])}
          data={[
            { value: 'builds', label: 'Full + incremental' },
            { value: 'full', label: 'Full builds only' },
            { value: 'incremental', label: 'Incremental only' },
            { value: 'all', label: 'Everything (incl. configure)' },
          ]}
          aria-label="Build kind"
          allowDeselect={false}
        />
      )}
      {!isDefault && (
        <Button size="xs" variant="subtle" color="gray" leftSection={<IconFilterOff size={14} />} onClick={reset}>
          Reset
        </Button>
      )}
    </Group>
  );
}
