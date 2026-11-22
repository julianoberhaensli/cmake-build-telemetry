import { Alert, Anchor, Badge, Button, Code, CopyButton, Drawer, Group, Modal, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconArrowsDiff, IconBrandGithub, IconCrosshair, IconDownload, IconExternalLink, IconTrash } from '@tabler/icons-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDeleteBuilds, useIsAdmin, useStepCategories } from '../api/admin';
import { useBuild, useStep, useSteps } from '../api/hooks';
import type { BuildDetail, Step, StepCategory } from '../api/types';
import { TargetBreakdown } from '../components/buildCharts';
import { StepExplorer } from '../components/StepExplorer';
import { Timeline, TimelineLegend, type LegendItem, type TimelineHandle } from '../components/Timeline';
import { ErrorNote, KeyValue, KindBadge, Loading, PageHeader, Panel, ResultBadge, StatTile } from '../components/Ui';
import { ROLE_LABEL, roleColor, roleGroup, useViz } from '../components/viz';
import { fileName, fmtBytes, fmtDate, fmtDuration, fmtKb, fmtMb, fmtNumber, shortSha } from '../lib/format';
import { EMPTY_FILTER, PHASE_ROLES, fmtClock, isFilterActive, makeMatcher, slotColor, stepLabel, type StepFilter } from '../lib/steps';

export function BuildDetailPage() {
  const { id } = useParams();
  const build = useBuild(id);
  const steps = useSteps(id);
  const cats = useStepCategories();
  // selected: outlined on the timeline; drawer: the step whose details are open
  const [selected, setSelected] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<number | null>(null);
  const select = (seq: number | null) => {
    setSelected(seq);
    setDrawer(seq);
  };
  const locate = (seq: number) => {
    setSelected(seq);
    setDrawer(null);
    timeline.current?.focusStep(seq);
  };
  const [filter, setFilter] = useState<StepFilter>(EMPTY_FILTER);
  const timeline = useRef<TimelineHandle>(null);

  const categories = useMemo(() => new Map((cats.data ?? []).map((c) => [c.id, c])), [cats.data]);
  const match = useMemo(() => (isFilterActive(filter) ? makeMatcher(filter) : null), [filter]);
  const matches = useMemo(() => (steps.data ? (match ? steps.data.filter(match) : steps.data) : []), [steps.data, match]);

  if (build.error) return <ErrorNote error={build.error} />;
  if (!build.data) return <Loading h={400} />;
  const b = build.data;
  const m = b.machine;
  const vsMedian =
    b.kind === 'full' && b.projectMedianFullWallMs ? (b.wallMs - b.projectMedianFullWallMs) / b.projectMedianFullWallMs : null;
  const workCount = steps.data?.filter((s) => !PHASE_ROLES.has(s.role)).length ?? 0;
  const matchCount = matches.filter((s) => !PHASE_ROLES.has(s.role)).length;

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
            <DeleteBuildButton build={b} />
          </>
        }
      />

      <Stack gap="md">
        {!b.success && <FailedSteps steps={steps.data} onSelect={select} />}

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

        <Panel
          title="Timeline"
          subtitle="Each bar is one command on the job slot it ran in. Click a bar for its command, a legend entry to highlight that group."
          actions={
            match && (
              <Group gap={6} wrap="nowrap">
                <Text size="xs" c="dimmed" className="num">
                  {fmtNumber(matchCount)} of {fmtNumber(workCount)} steps highlighted
                </Text>
                <Button size="compact-xs" variant="subtle" onClick={() => setFilter(EMPTY_FILTER)}>
                  Clear
                </Button>
              </Group>
            )
          }
        >
          {steps.data ? (
            steps.data.length > 0 ? (
              <>
                <StepLegend steps={steps.data} categories={categories} filter={filter} setFilter={setFilter} />
                <Timeline ref={timeline} steps={steps.data} categories={categories} match={match} selectedSeq={selected} onSelect={select} />
              </>
            ) : (
              <Text size="sm" c="dimmed">This bundle was sent with detail level "summary" – no per-step data.</Text>
            )
          ) : (
            <Loading h={300} />
          )}
        </Panel>

        {steps.data && steps.data.length > 0 && (
          <Panel title="Steps" subtitle="Search, filter and sort every step. The same filter highlights the timeline above.">
            <StepExplorer
              steps={steps.data}
              categories={categories}
              filter={filter}
              onFilter={setFilter}
              matches={matches}
              onSelect={select}
              onLocate={locate}
              buildId={b.id}
            />
          </Panel>
        )}

        <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
          <Panel title="Time per target" subtitle="Accumulated across parallel jobs · click a bar to filter the steps">
            {b.targets.length > 0 ? <TargetBreakdown targets={b.targets} onTarget={(t) => setFilter({ ...EMPTY_FILTER, target: t })} /> : <Text size="sm" c="dimmed">No target data.</Text>}
          </Panel>
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

      <StepDrawer
        buildId={b.id}
        seq={drawer}
        step={steps.data?.find((s) => s.seq === drawer)}
        categories={categories}
        onClose={() => setDrawer(null)}
        onLocate={locate}
      />
    </>
  );
}

/** Roles present (in fixed order), then legend rules present, then failures; a click highlights. */
function StepLegend({
  steps,
  categories,
  filter,
  setFilter,
}: {
  steps: Step[];
  categories: Map<number, StepCategory>;
  filter: StepFilter;
  setFilter: (f: StepFilter) => void;
}) {
  const v = useViz();
  const roleCount = new Map<string, number>();
  const catCount = new Map<number, number>();
  let failed = 0;
  for (const s of steps) {
    if (PHASE_ROLES.has(s.role)) continue;
    roleCount.set(s.role, (roleCount.get(s.role) ?? 0) + 1);
    if (s.category !== null) catCount.set(s.category, (catCount.get(s.category) ?? 0) + 1);
    if (s.result) failed++;
  }
  const order = ['compile', 'link', 'custom', 'install', 'test'];
  const roles = [...roleCount.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const items: LegendItem[] = roles.map((r) => ({
    key: `role:${r}`,
    label: roleGroup(r) === 'other' ? r : ROLE_LABEL[roleGroup(r)],
    color: roleColor(v, r),
    count: roleCount.get(r)!,
    active: filter.role === r,
    onClick: () => setFilter({ ...filter, role: filter.role === r ? null : r }),
  }));
  for (const c of categories.values()) {
    if (!catCount.has(c.id)) continue;
    items.push({
      key: `cat:${c.id}`,
      label: c.name,
      color: slotColor(v, c.colorSlot),
      count: catCount.get(c.id)!,
      active: filter.category === c.id,
      onClick: () => setFilter({ ...filter, category: filter.category === c.id ? null : c.id }),
    });
  }
  if (failed > 0) {
    items.push({
      key: 'failed',
      label: 'Failed',
      color: v.critical,
      count: failed,
      active: filter.failedOnly,
      onClick: () => setFilter({ ...filter, failedOnly: !filter.failedOnly }),
    });
  }
  return <TimelineLegend items={items} />;
}

function DeleteBuildButton({ build }: { build: BuildDetail }) {
  const isAdmin = useIsAdmin();
  const del = useDeleteBuilds();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!isAdmin) return null;
  return (
    <>
      <Button size="xs" variant="default" color="red" leftSection={<IconTrash size={14} />} onClick={() => setOpen(true)}>
        Delete
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Delete this build?" centered>
        <Text size="sm">
          The build of <b>{build.project}</b> from {fmtDate(build.startedAt)} and its {fmtNumber(build.compileCount + build.linkCount)}+ steps are
          removed permanently. This cannot be undone.
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
          <Button color="red" loading={del.isPending} onClick={() => del.mutate([build.id], { onSuccess: () => navigate('/builds') })}>
            Delete build
          </Button>
        </Group>
      </Modal>
    </>
  );
}

function FailedSteps({ steps, onSelect }: { steps?: Step[]; onSelect: (seq: number) => void }) {
  const failed = (steps ?? []).filter((s) => s.result && s.role !== 'build' && s.role !== 'cmakeBuild');
  return (
    <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title="This build failed">
      {failed.length === 0
        ? 'The build tool reported a failure.'
        : failed.slice(0, 5).map((s) => (
            <div key={s.seq}>
              <Anchor size="sm" onClick={() => onSelect(s.seq)}>
                {stepLabel(s)}
              </Anchor>{' '}
              <Text span size="sm" c="dimmed">
                {s.role}
                {s.target ? ` · ${s.target}` : ''} · exit code {s.result} after {fmtDuration(s.durationMs)}
              </Text>
            </div>
          ))}
    </Alert>
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

function StepDrawer({
  buildId,
  seq,
  step: listed,
  categories,
  onClose,
  onLocate,
}: {
  buildId: string;
  seq: number | null;
  step?: Step;
  categories: Map<number, StepCategory>;
  onClose: () => void;
  onLocate: (seq: number) => void;
}) {
  const step = useStep(buildId, seq);
  const s = step.data;
  const cat = listed?.category != null ? categories.get(listed.category) : undefined;
  return (
    <Drawer
      opened={seq !== null}
      onClose={onClose}
      position="right"
      size="xl"
      title={<Text fw={600}>{listed ? stepLabel(listed) : s ? fileName(s.source ?? s.output ?? s.target ?? s.role) : 'Step'}</Text>}
    >
      {!s ? (
        <Loading />
      ) : (
        <Stack gap="md">
          <Group gap="xs">
            <Button size="xs" variant="default" leftSection={<IconCrosshair size={14} />} onClick={() => onLocate(s.seq)}>
              Show on timeline
            </Button>
          </Group>
          <KeyValue
            items={[
              ['Role', s.role],
              ['Legend group', cat?.name ?? null],
              ['Tool', listed?.tool ?? null],
              ['Target', s.target],
              ['Source', s.source],
              ['Output', s.output],
              ['Configuration', s.config],
              ['Started at', `${fmtClock(s.startMs)} after build start`],
              ['Duration', fmtDuration(s.durationMs)],
              ['Exit code', s.result === null ? '–' : String(s.result)],
              ['Peak memory', fmtKb(s.maxRssKb)],
              ['CPU user / system', s.userTimeUs != null ? `${fmtDuration(s.userTimeUs / 1000)} / ${fmtDuration((s.systemTimeUs ?? 0) / 1000)}` : '–'],
              ['Output size', fmtBytes(listed?.outputBytes)],
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
