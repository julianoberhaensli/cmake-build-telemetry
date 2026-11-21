import { Alert, Anchor, Badge, Button, Code, CopyButton, Drawer, Group, ScrollArea, SimpleGrid, Stack, Table, Tabs, Text } from '@mantine/core';
import { IconAlertTriangle, IconArrowsDiff, IconBrandGithub, IconDownload, IconExternalLink } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useBuild, useStep, useSteps } from '../api/hooks';
import type { BuildDetail, Step } from '../api/types';
import { TargetBreakdown, Timeline } from '../components/buildCharts';
import { ErrorNote, KeyValue, KindBadge, Loading, PageHeader, Panel, ResultBadge, StatTile } from '../components/Ui';
import { fileName, fmtBytes, fmtDate, fmtDuration, fmtKb, fmtMb, fmtNumber, shortSha } from '../lib/format';

export function BuildDetailPage() {
  const { id } = useParams();
  const build = useBuild(id);
  const steps = useSteps(id);
  const [selected, setSelected] = useState<number | null>(null);

  if (build.error) return <ErrorNote error={build.error} />;
  if (!build.data) return <Loading h={400} />;
  const b = build.data;
  const m = b.machine;
  const vsMedian =
    b.kind === 'full' && b.projectMedianFullWallMs ? (b.wallMs - b.projectMedianFullWallMs) / b.projectMedianFullWallMs : null;

  return (
    <>
      <PageHeader
        title={
          <Group gap="sm">
            <span>{b.project}</span>
            <ResultBadge success={b.success} />
            <KindBadge kind={b.kind} />
            {b.isCi && <Badge variant="outline" color="gray">CI · {b.ciProvider}</Badge>}
          </Group>
        }
        subtitle={
          <>
            {fmtDate(b.startedAt)} on{' '}
            <Anchor component={Link} to={`/machines/${b.machineId}`} size="sm">
              {m?.hostname ?? 'unknown machine'}
            </Anchor>
            {b.branch && <> · {b.branch}</>} {b.commitSha && <Code>{shortSha(b.commitSha)}</Code>}
          </>
        }
        actions={
          <>
            {b.ciUrl && (
              <Button component="a" href={b.ciUrl} target="_blank" rel="noreferrer" size="xs" variant="default" leftSection={b.ciProvider === 'github' ? <IconBrandGithub size={14} /> : <IconExternalLink size={14} />}>
                CI job
              </Button>
            )}
            <Button component={Link} to={`/compare?a=${b.id}`} size="xs" variant="default" leftSection={<IconArrowsDiff size={14} />}>
              Compare
            </Button>
            <Button component="a" href={`/api/v1/builds/${b.id}/trace`} size="xs" variant="default" leftSection={<IconDownload size={14} />}>
              Perfetto trace
            </Button>
          </>
        }
      />

      <Stack gap="md">
        {!b.success && <FailedSteps steps={steps.data} onSelect={setSelected} />}

        <SimpleGrid cols={{ base: 2, md: 3, xl: 6 }} spacing="md">
          <StatTile
            label="Wall-clock time"
            value={fmtDuration(b.wallMs)}
            current={vsMedian !== null ? b.wallMs : undefined}
            previous={vsMedian !== null ? b.projectMedianFullWallMs : undefined}
            lowerIsBetter
            deltaLabel="vs project median"
            hint="Compared with the project's median full build of the last 30 days."
          />
          <StatTile label="Translation units" value={fmtNumber(b.compileCount)} hint={`${fmtDuration(b.compileMs)} of compiler time`} />
          <StatTile label="Compiler time" value={fmtDuration(b.compileMs)} hint="Sum over all compile steps (CPU time across parallel jobs)." />
          <StatTile label="Link time" value={fmtDuration(b.linkMs)} hint={`${b.linkCount} link steps`} />
          <StatTile label="Parallelism" value={b.parallelism ? `${b.parallelism.toFixed(1)}×` : '–'} hint={`Machine has ${m?.logicalCores ?? '?'} hardware threads.`} />
          <StatTile label="Peak memory (one step)" value={fmtKb(b.maxRssKb)} hint="Largest max-RSS of a single compiler/linker process (CMake 4.5+)." />
        </SimpleGrid>

        <Panel title="Timeline" subtitle="Each bar is one command on the job slot it ran in. Drag the slider handles to zoom, click a bar for its command.">
          {steps.data ? steps.data.length > 0 ? <Timeline steps={steps.data} onSelect={setSelected} /> : <Text size="sm" c="dimmed">This bundle was sent with detail level "summary" – no per-step data.</Text> : <Loading h={300} />}
        </Panel>

        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Panel title="Slowest steps">
            {steps.data ? <SlowSteps steps={steps.data} onSelect={setSelected} /> : <Loading />}
          </Panel>
          <Panel title="Time per target" subtitle="Accumulated across parallel jobs">
            {b.targets.length > 0 ? <TargetBreakdown targets={b.targets} /> : <Text size="sm" c="dimmed">No target data.</Text>}
          </Panel>
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Panel title="Build environment">
            <Environment b={b} />
          </Panel>
          <Panel title="Machine">
            {m ? (
              <KeyValue
                items={[
                  ['Hostname', <Anchor component={Link} to={`/machines/${m.id}`} size="xs">{m.hostname}</Anchor>],
                  ['CPU', m.cpuModel],
                  ['Cores / threads', `${m.physicalCores ?? '?'} / ${m.logicalCores ?? '?'}`],
                  ['Memory', fmtMb(m.memoryMb)],
                  ['Operating system', `${m.osPretty ?? m.osName ?? ''} (${m.osRelease ?? ''})`],
                  ['Kind', m.isCi ? 'CI runner' : 'Developer machine'],
                ]}
              />
            ) : (
              <Text size="sm">–</Text>
            )}
          </Panel>
        </SimpleGrid>
      </Stack>

      <StepDrawer buildId={b.id} seq={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function FailedSteps({ steps, onSelect }: { steps?: Step[]; onSelect: (seq: number) => void }) {
  const failed = (steps ?? []).filter((s) => s.result);
  return (
    <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title="This build failed">
      {failed.length === 0
        ? 'The build tool reported a failure.'
        : failed.slice(0, 5).map((s) => (
            <div key={s.seq}>
              <Anchor size="sm" onClick={() => onSelect(s.seq)}>
                {s.role} {s.source ?? s.target}
              </Anchor>{' '}
              <Text span size="sm" c="dimmed">
                exit code {s.result} after {fmtDuration(s.durationMs)}
              </Text>
            </div>
          ))}
    </Alert>
  );
}

function SlowSteps({ steps, onSelect }: { steps: Step[]; onSelect: (seq: number) => void }) {
  const [role, setRole] = useState<string>('compile');
  const rows = useMemo(
    () => steps.filter((s) => s.role === role).sort((a, b) => b.durationMs - a.durationMs).slice(0, 20),
    [steps, role],
  );
  const roles = Array.from(new Set(steps.map((s) => s.role))).filter((r) => r !== 'build' && r !== 'cmakeBuild');
  return (
    <>
      <Tabs value={role} onChange={(v) => setRole(v ?? 'compile')} variant="pills" mb="xs">
        <Tabs.List>
          {roles.map((r) => (
            <Tabs.Tab key={r} value={r} size="xs">
              {r} ({steps.filter((s) => s.role === r).length})
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      <ScrollArea.Autosize mah={420}>
        <Table highlightOnHover fz="xs" verticalSpacing={5}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Step</Table.Th>
              <Table.Th>Target</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Duration</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Peak memory</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((s) => (
              <Table.Tr key={s.seq} className="clickable-row" onClick={() => onSelect(s.seq)}>
                <Table.Td>
                  <Text size="xs" fw={500} lineClamp={1} title={s.source ?? s.output ?? ''}>
                    {s.source ? fileName(s.source) : fileName(s.output) ?? s.role}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {s.source ?? s.output}
                  </Text>
                </Table.Td>
                <Table.Td>{s.target ?? '–'}</Table.Td>
                <Table.Td className="num" style={{ textAlign: 'right' }}>
                  {s.result ? <Badge color="red" size="xs" mr={6}>failed</Badge> : null}
                  {fmtDuration(s.durationMs)}
                </Table.Td>
                <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtKb(s.maxRssKb)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
    </>
  );
}

function Environment({ b }: { b: BuildDetail }) {
  const tags = b.tags ? Object.entries(b.tags) : [];
  return (
    <KeyValue
      items={[
        ['CMake', b.cmakeVersion],
        ['Generator / tool', [b.generator, b.buildTool].filter(Boolean).join(' · ')],
        ['Build type', b.buildType],
        ['C++ compiler', b.cxxCompilerId ? `${b.cxxCompilerId} ${b.cxxCompilerVersion ?? ''}` : null],
        ['C compiler', b.cCompilerId ? `${b.cCompilerId} ${b.cCompilerVersion ?? ''}` : null],
        ['Compiler launcher', b.compilerLauncher ?? 'none'],
        ['Linker', b.linkerType],
        ['Configure / generate', `${fmtDuration(b.configureMs)} / ${fmtDuration(b.generateMs)}`],
        ['Output size', fmtBytes(b.outputBytes)],
        ['Branch / commit', `${b.branch ?? '–'} · ${shortSha(b.commitSha)}`],
        ['CI job', b.ciJob],
        ['Developer (hashed)', b.userHash],
        ['Tags', tags.length ? tags.map(([k, v]) => `${k}=${v}`).join(', ') : null],
        ['Telemetry', `client ${b.clientVersion ?? '?'} · data v${b.dataVersion ?? '?'} · detail ${b.detail ?? '?'} · hook ${b.hook ?? '?'}`],
        ['Ingest key', b.ingestKey],
        ['Build id', b.id],
      ]}
    />
  );
}

function StepDrawer({ buildId, seq, onClose }: { buildId: string; seq: number | null; onClose: () => void }) {
  const step = useStep(buildId, seq);
  const s = step.data;
  return (
    <Drawer opened={seq !== null} onClose={onClose} position="right" size="xl" title={<Text fw={600}>{s ? fileName(s.source ?? s.output ?? s.target ?? s.role) : 'Step'}</Text>}>
      {!s ? (
        <Loading />
      ) : (
        <Stack gap="md">
          <KeyValue
            items={[
              ['Role', s.role],
              ['Target', s.target],
              ['Source', s.source],
              ['Output', s.output],
              ['Configuration', s.config],
              ['Started at', `${(s.startMs / 1000).toFixed(2)} s after build start`],
              ['Duration', fmtDuration(s.durationMs)],
              ['Exit code', s.result === null ? '–' : String(s.result)],
              ['Peak memory', fmtKb(s.maxRssKb)],
              ['CPU user / system', s.userTimeUs != null ? `${fmtDuration(s.userTimeUs / 1000)} / ${fmtDuration((s.systemTimeUs ?? 0) / 1000)}` : '–'],
            ]}
          />
          <div>
            <Group justify="space-between" mb={4}>
              <Text size="sm" fw={600}>
                Command
              </Text>
              {s.command && (
                <CopyButton value={s.command}>
                  {({ copied, copy }) => (
                    <Button size="compact-xs" variant="subtle" onClick={copy}>
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  )}
                </CopyButton>
              )}
            </Group>
            {s.command ? (
              <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {s.command}
              </Code>
            ) : (
              <Text size="sm" c="dimmed">
                Not recorded (detail level, server policy or retention).
              </Text>
            )}
          </div>
        </Stack>
      )}
    </Drawer>
  );
}
