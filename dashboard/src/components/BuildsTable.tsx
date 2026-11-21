import { Badge, Group, Pagination, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import type { BuildListItem } from '../api/types';
import { fmtAgo, fmtDate, fmtDuration, shortSha } from '../lib/format';
import { Empty, KindBadge, ResultBadge } from './Ui';

export interface SortState {
  sort: string;
  dir: 'asc' | 'desc';
}

function Th({ label, field, sort, onSort, align }: { label: string; field?: string; sort?: SortState; onSort?: (s: SortState) => void; align?: 'right' }) {
  if (!field || !sort || !onSort) {
    return <Table.Th style={{ textAlign: align }}>{label}</Table.Th>;
  }
  const active = sort.sort === field;
  const Icon = active ? (sort.dir === 'asc' ? IconChevronUp : IconChevronDown) : IconSelector;
  return (
    <Table.Th style={{ textAlign: align }}>
      <UnstyledButton onClick={() => onSort({ sort: field, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}>
        <Group gap={2} wrap="nowrap" justify={align === 'right' ? 'flex-end' : 'flex-start'}>
          <Text size="sm" fw={600}>
            {label}
          </Text>
          <Icon size={14} />
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}

export function BuildsTable({
  items,
  total,
  page,
  pageSize,
  onPage,
  sort,
  onSort,
  compact = false,
}: {
  items: BuildListItem[];
  total?: number;
  page?: number;
  pageSize?: number;
  onPage?: (p: number) => void;
  sort?: SortState;
  onSort?: (s: SortState) => void;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  if (items.length === 0) return <Empty />;
  return (
    <>
      <Table.ScrollContainer minWidth={compact ? 700 : 1100}>
        <Table highlightOnHover verticalSpacing={compact ? 6 : 8} fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Th label="Started" field="startedAt" sort={sort} onSort={onSort} />
              <Th label="Project" field="project" sort={sort} onSort={onSort} />
              <Th label="Machine" field="hostname" sort={sort} onSort={onSort} />
              {!compact && <Th label="Branch" />}
              <Th label="Kind" />
              <Th label="Result" />
              <Th label="Duration" field="wallMs" sort={sort} onSort={onSort} align="right" />
              <Th label="TUs" field="compileCount" sort={sort} onSort={onSort} align="right" />
              {!compact && <Th label="Parallelism" field="parallelism" sort={sort} onSort={onSort} align="right" />}
              {!compact && <Th label="Compiler" />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((b) => (
              <Table.Tr key={b.id} className="clickable-row" onClick={() => navigate(`/builds/${b.id}`)}>
                <Table.Td>
                  <Tooltip label={fmtDate(b.startedAt)} withArrow>
                    <Text size="sm">{fmtAgo(b.startedAt)}</Text>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {b.project}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm">{b.hostname ?? '–'}</Text>
                    {b.isCi && (
                      <Badge size="xs" variant="outline" color="gray">
                        CI
                      </Badge>
                    )}
                  </Group>
                  {!compact && (
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {b.cpuModel} · {b.logicalCores} threads
                    </Text>
                  )}
                </Table.Td>
                {!compact && (
                  <Table.Td>
                    <Text size="sm" lineClamp={1}>
                      {b.branch ?? '–'}
                    </Text>
                    <Text size="xs" c="dimmed" className="mono">
                      {shortSha(b.commitSha)}
                    </Text>
                  </Table.Td>
                )}
                <Table.Td>
                  <KindBadge kind={b.kind} />
                </Table.Td>
                <Table.Td>
                  <ResultBadge success={b.success} />
                </Table.Td>
                <Table.Td className="num" style={{ textAlign: 'right' }}>
                  {fmtDuration(b.wallMs)}
                </Table.Td>
                <Table.Td className="num" style={{ textAlign: 'right' }}>
                  {b.compileCount.toLocaleString('en-US')}
                </Table.Td>
                {!compact && (
                  <Table.Td className="num" style={{ textAlign: 'right' }}>
                    {b.parallelism ? `${b.parallelism.toFixed(1)}×` : '–'}
                  </Table.Td>
                )}
                {!compact && (
                  <Table.Td>
                    <Text size="sm" lineClamp={1}>
                      {b.cxxCompilerId ? `${b.cxxCompilerId} ${b.cxxCompilerVersion ?? ''}` : '–'}
                    </Text>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {onPage && total !== undefined && page !== undefined && pageSize !== undefined && total > pageSize && (
        <Group justify="space-between" mt="md">
          <Text size="xs" c="dimmed">
            {total.toLocaleString('en-US')} builds
          </Text>
          <Pagination size="sm" total={Math.ceil(total / pageSize)} value={page} onChange={onPage} />
        </Group>
      )}
    </>
  );
}
