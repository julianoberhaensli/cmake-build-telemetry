import { useSearchParams } from 'react-router';
import { useBuilds } from '../api/hooks';
import { BuildsTable, type SortState } from '../components/BuildsTable';
import { FilterBar } from '../components/FilterBar';
import { ErrorNote, Loading, PageHeader, Panel } from '../components/Ui';
import { useFilters } from '../state/filters';

const PAGE_SIZE = 50;

export function BuildsPage() {
  const { filters } = useFilters();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1) || 1;
  const sort: SortState = { sort: params.get('sort') ?? 'startedAt', dir: (params.get('dir') as 'asc' | 'desc') ?? 'desc' };
  const extra = {
    page,
    pageSize: PAGE_SIZE,
    sort: sort.sort,
    dir: sort.dir,
    success: params.get('success'),
    machine: params.get('machine'),
  };
  const builds = useBuilds(filters, extra);

  const update = (patch: Record<string, string | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      return next;
    });

  return (
    <>
      <PageHeader title="Builds" subtitle="Every instrumented build; click a row for its timeline" />
      <FilterBar />
      {builds.error && <ErrorNote error={builds.error} />}
      <Panel>
        {builds.data ? (
          <BuildsTable
            items={builds.data.items}
            total={builds.data.total}
            page={page}
            pageSize={PAGE_SIZE}
            onPage={(p) => update({ page: String(p) })}
            sort={sort}
            onSort={(s) => update({ sort: s.sort, dir: s.dir, page: null })}
          />
        ) : (
          <Loading h={400} />
        )}
      </Panel>
    </>
  );
}
