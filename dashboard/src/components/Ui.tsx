import { Alert, Badge, Box, Center, Group, Loader, Paper, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconArrowDownRight, IconArrowUpRight, IconCircleCheck, IconCircleX, IconInfoCircle } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { fmtDelta } from '../lib/format';

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" mb="md" wrap="nowrap">
      <Box miw={0}>
        <Title order={2} fw={600}>
          {title}
        </Title>
        {subtitle && (
          <Text c="dimmed" size="sm" mt={2}>
            {subtitle}
          </Text>
        )}
      </Box>
      {actions && <Group gap="xs">{actions}</Group>}
    </Group>
  );
}

export function Panel({ title, subtitle, children, actions, p = 'md' }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode; p?: string }) {
  return (
    <Paper className="card" p={p} shadow="none" radius="lg">
      {(title || actions) && (
        <Group justify="space-between" mb="sm" align="flex-start" wrap="nowrap">
          <Box miw={0}>
            {title && (
              <Text fw={600} size="sm">
                {title}
              </Text>
            )}
            {subtitle && (
              <Text size="xs" c="dimmed">
                {subtitle}
              </Text>
            )}
          </Box>
          {actions}
        </Group>
      )}
      {children}
    </Paper>
  );
}

/**
 * Stat tile: label · value · optional delta vs. the previous period.
 * `lowerIsBetter` decides whether a rise is coloured as good or bad; the arrow icon and
 * signed text carry the direction, so colour is never the only cue.
 */
export function StatTile({
  label,
  value,
  current,
  previous,
  lowerIsBetter = false,
  hint,
  deltaLabel = 'vs previous period',
}: {
  label: string;
  value: ReactNode;
  current?: number | null;
  previous?: number | null;
  lowerIsBetter?: boolean;
  hint?: string;
  deltaLabel?: string;
}) {
  const delta = fmtDelta(current, previous);
  const up = current != null && previous != null && current > previous;
  const good = lowerIsBetter ? !up : up;
  const flat = current != null && previous != null && Math.abs(current - previous) / Math.max(Math.abs(previous), 1e-9) < 0.005;
  return (
    <Paper className="card" p="md" radius="lg">
      <Group gap={4} wrap="nowrap">
        <Text size="xs" c="dimmed" fw={500}>
          {label}
        </Text>
        {hint && (
          <Tooltip label={hint} multiline w={260} withArrow>
            <IconInfoCircle size={13} color="var(--viz-muted)" />
          </Tooltip>
        )}
      </Group>
      <div className="stat-value" style={{ marginTop: 4 }}>
        {value}
      </div>
      {delta && (
        <Group gap={2} mt={4} wrap="nowrap">
          {!flat && (up ? <IconArrowUpRight size={14} color={good ? 'var(--viz-delta-good)' : 'var(--viz-delta-bad)'} /> : <IconArrowDownRight size={14} color={good ? 'var(--viz-delta-good)' : 'var(--viz-delta-bad)'} />)}
          <Text size="xs" fw={600} style={{ color: flat ? 'var(--viz-text-2)' : good ? 'var(--viz-delta-good)' : 'var(--viz-delta-bad)' }}>
            {delta}
          </Text>
          <Text size="xs" c="dimmed">
            {deltaLabel}
          </Text>
        </Group>
      )}
    </Paper>
  );
}

export function ResultBadge({ success }: { success: boolean }) {
  return success ? (
    <Badge color="green" variant="light" leftSection={<IconCircleCheck size={12} />}>
      Succeeded
    </Badge>
  ) : (
    <Badge color="red" variant="light" leftSection={<IconCircleX size={12} />}>
      Failed
    </Badge>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  const color = kind === 'full' ? 'brand' : kind === 'incremental' ? 'gray' : 'violet';
  return (
    <Badge color={color} variant={kind === 'full' ? 'light' : 'outline'} size="sm">
      {kind}
    </Badge>
  );
}

export function Loading({ h = 200 }: { h?: number }) {
  return (
    <Center h={h}>
      <Loader size="sm" />
    </Center>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return (
    <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Could not load data" variant="light">
      {error instanceof Error ? error.message : String(error)}
    </Alert>
  );
}

export function Empty({ children = 'No builds match the current filters.' }: { children?: ReactNode }) {
  return (
    <Center h={160}>
      <Stack gap={4} align="center">
        <Text c="dimmed" size="sm">
          {children}
        </Text>
      </Stack>
    </Center>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <Box style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) 1fr', columnGap: 16, rowGap: 6 }}>
      {items.map(([k, v]) => (
        <Box key={k} style={{ display: 'contents' }}>
          <Text size="xs" c="dimmed">
            {k}
          </Text>
          <Text size="xs" style={{ wordBreak: 'break-all' }}>
            {v ?? '–'}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
