import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Modal,
  Pagination,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconLock, IconLogout, IconPlus, IconTrash } from '@tabler/icons-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  useAdminMachines,
  useAdminSession,
  useDeleteBuilds,
  useDeleteMachine,
  useDeleteMatchingBuilds,
  useLogin,
  useLogout,
  useSaveCategories,
  useStepCategories,
} from '../api/admin';
import { useBuilds } from '../api/hooks';
import type { AdminMachine, StepCategory } from '../api/types';
import { FilterBar } from '../components/FilterBar';
import { ErrorNote, Loading, PageHeader, Panel, ResultBadge } from '../components/Ui';
import { useViz } from '../components/viz';
import { fmtAgo, fmtDate, fmtDuration, fmtNumber } from '../lib/format';
import { slotColor } from '../lib/steps';
import { useFilters } from '../state/filters';

export function AdminPage() {
  const session = useAdminSession();
  const logout = useLogout();

  if (session.error) return <ErrorNote error={session.error} />;
  if (!session.data) return <Loading h={300} />;
  const s = session.data;

  return (
    <>
      <PageHeader
        title="Administration"
        subtitle="Delete builds and machines, and define legend groups for the build timeline"
        actions={
          s.isAdmin && s.via === 'password' ? (
            <Button size="xs" variant="default" leftSection={<IconLogout size={14} />} loading={logout.isPending} onClick={() => logout.mutate()}>
              Sign out
            </Button>
          ) : undefined
        }
      />
      {!s.isAdmin ? (
        <SignIn passwordConfigured={s.passwordConfigured} roleConfigured={s.roleConfigured} />
      ) : (
        <Tabs defaultValue="builds" keepMounted={false}>
          <Tabs.List mb="md">
            <Tabs.Tab value="builds">Builds</Tabs.Tab>
            <Tabs.Tab value="machines">Machines</Tabs.Tab>
            <Tabs.Tab value="legend">Legend groups</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="builds">
            <BuildsAdmin />
          </Tabs.Panel>
          <Tabs.Panel value="machines">
            <MachinesAdmin />
          </Tabs.Panel>
          <Tabs.Panel value="legend">
            <LegendAdmin />
          </Tabs.Panel>
        </Tabs>
      )}
    </>
  );
}

function SignIn({ passwordConfigured, roleConfigured }: { passwordConfigured: boolean; roleConfigured: boolean }) {
  const login = useLogin();
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) login.mutate(password);
  };

  if (!passwordConfigured && !roleConfigured) {
    return (
      <Panel title="Administration is not enabled">
        <Text size="sm" mb="xs">
          Set an admin password on the server (at least 12 characters) and restart it. With Docker Compose, add to <Code>.env</Code>:
        </Text>
        <Code block>ADMIN_PASSWORD=choose-a-long-password</Code>
        <Text size="sm" mt="xs" c="dimmed">
          Other deployments: environment variable <Code>Telemetry__Admin__Password</Code>. With OIDC sign-in, <Code>Telemetry__Admin__Role</Code> makes every user with
          that role an admin.
        </Text>
      </Panel>
    );
  }

  return (
    <Panel title="Admin sign-in">
      <Stack gap="sm" maw={380}>
        {roleConfigured && (
          <Text size="sm" c="dimmed">
            Users with the admin role of your identity provider are admins automatically.
          </Text>
        )}
        {passwordConfigured && (
          <form onSubmit={submit}>
            <Stack gap="sm">
              <PasswordInput
                label="Admin password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                autoComplete="current-password"
                autoFocus
                error={login.error ? (login.error.message === 'Wrong password' ? 'Wrong password' : login.error.message) : undefined}
              />
              <Group>
                <Button type="submit" leftSection={<IconLock size={14} />} loading={login.isPending} disabled={!password}>
                  Sign in
                </Button>
              </Group>
            </Stack>
          </form>
        )}
      </Stack>
    </Panel>
  );
}

function Confirm({
  opened,
  title,
  children,
  action,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  opened: boolean;
  title: string;
  children: ReactNode;
  action: string;
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onCancel} title={title} centered>
      <Text size="sm">{children}</Text>
      <Text size="sm" mt="xs" fw={600}>
        This cannot be undone.
      </Text>
      {error && (
        <Text size="sm" c="red" mt="xs">
          {error.message}
        </Text>
      )}
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button color="red" loading={pending} onClick={onConfirm}>
          {action}
        </Button>
      </Group>
    </Modal>
  );
}

// --- builds ----------------------------------------------------------------------------------

const PAGE = 50;

function BuildsAdmin() {
  const { filters } = useFilters();
  const [page, setPage] = useState(1);
  const builds = useBuilds(filters, { page, pageSize: PAGE, sort: 'startedAt', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<'selected' | 'matching' | null>(null);
  const del = useDeleteBuilds();
  const delMatching = useDeleteMatchingBuilds();
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [filters]);

  const items = builds.data?.items ?? [];
  const total = builds.data?.total ?? 0;
  const allOnPage = items.length > 0 && items.every((b) => selected.has(b.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const finish = (n: number | undefined) => {
    setConfirm(null);
    setSelected(new Set());
    setDone(`Deleted ${fmtNumber(n ?? 0)} build(s).`);
  };

  return (
    <>
      <FilterBar />
      {done && (
        <Alert color="green" variant="light" mb="md" withCloseButton onClose={() => setDone(null)}>
          {done}
        </Alert>
      )}
      <Panel
        title={`${fmtNumber(total)} builds match the filter`}
        subtitle="Select builds on this page, or delete everything the filter above matches."
        actions={
          <Group gap="xs">
            <Button size="xs" color="red" variant="light" leftSection={<IconTrash size={14} />} disabled={selected.size === 0} onClick={() => setConfirm('selected')}>
              Delete selected ({selected.size})
            </Button>
            <Button size="xs" color="red" variant="outline" leftSection={<IconTrash size={14} />} disabled={total === 0} onClick={() => setConfirm('matching')}>
              Delete all {fmtNumber(total)} matching
            </Button>
          </Group>
        }
      >
        {builds.error && <ErrorNote error={builds.error} />}
        {!builds.data ? (
          <Loading />
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table highlightOnHover fz="xs" verticalSpacing={5}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={32}>
                    <Checkbox
                      size="xs"
                      checked={allOnPage}
                      indeterminate={!allOnPage && items.some((b) => selected.has(b.id))}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          items.forEach((b) => (allOnPage ? next.delete(b.id) : next.add(b.id)));
                          return next;
                        })
                      }
                      aria-label="Select all on this page"
                    />
                  </Table.Th>
                  <Table.Th>Started</Table.Th>
                  <Table.Th>Project</Table.Th>
                  <Table.Th>Machine</Table.Th>
                  <Table.Th>Kind</Table.Th>
                  <Table.Th>Result</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Duration</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>TUs</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((b) => (
                  <Table.Tr key={b.id} bg={selected.has(b.id) ? 'var(--viz-s1-wash)' : undefined}>
                    <Table.Td>
                      <Checkbox size="xs" checked={selected.has(b.id)} onChange={() => toggle(b.id)} aria-label={`Select build ${b.id}`} />
                    </Table.Td>
                    <Table.Td>
                      <Anchor component={Link} to={`/builds/${b.id}`} size="xs">
                        {fmtDate(b.startedAt)}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>{b.project}</Table.Td>
                    <Table.Td>{b.hostname ?? '–'}</Table.Td>
                    <Table.Td>{b.kind}</Table.Td>
                    <Table.Td>
                      <ResultBadge success={b.success} />
                    </Table.Td>
                    <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtDuration(b.wallMs)}</Table.Td>
                    <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtNumber(b.compileCount)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {total > PAGE && (
          <Group justify="flex-end" mt="sm">
            <Pagination size="sm" total={Math.ceil(total / PAGE)} value={page} onChange={setPage} />
          </Group>
        )}
      </Panel>

      <Confirm
        opened={confirm === 'selected'}
        title={`Delete ${selected.size} build(s)?`}
        action="Delete builds"
        pending={del.isPending}
        error={del.error}
        onCancel={() => setConfirm(null)}
        onConfirm={() => del.mutate([...selected], { onSuccess: (r) => finish(r?.deleted) })}
      >
        The selected builds and all their steps are removed permanently.
      </Confirm>
      <Confirm
        opened={confirm === 'matching'}
        title={`Delete all ${fmtNumber(total)} matching builds?`}
        action={`Delete ${fmtNumber(total)} builds`}
        pending={delMatching.isPending}
        error={delMatching.error}
        onCancel={() => setConfirm(null)}
        onConfirm={() => delMatching.mutate({ filters, extra: {} }, { onSuccess: (r) => finish(r?.deleted) })}
      >
        Every build that the filter bar above matches (time range, project, branch, source, kind, build type) is removed with its steps, not only this page.
      </Confirm>
    </>
  );
}

// --- machines --------------------------------------------------------------------------------

function MachinesAdmin() {
  const machines = useAdminMachines(true);
  const del = useDeleteMachine();
  const [target, setTarget] = useState<AdminMachine | null>(null);
  const [query, setQuery] = useState('');
  const rows = useMemo(
    () => (machines.data ?? []).filter((m) => !query || `${m.hostname} ${m.cpuModel} ${m.osPretty}`.toLowerCase().includes(query.toLowerCase())),
    [machines.data, query],
  );

  return (
    <Panel
      title={`${fmtNumber(machines.data?.length ?? 0)} machines`}
      subtitle="Deleting a machine also deletes all of its builds. A machine that uploads again is added back."
      actions={<TextInput size="xs" placeholder="Search…" value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={200} aria-label="Search machines" />}
    >
      {machines.error && <ErrorNote error={machines.error} />}
      {!machines.data ? (
        <Loading />
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table highlightOnHover fz="xs" verticalSpacing={5}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Machine</Table.Th>
                <Table.Th>CPU</Table.Th>
                <Table.Th>OS</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Builds</Table.Th>
                <Table.Th>Last build</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((m) => (
                <Table.Tr key={m.id}>
                  <Table.Td>
                    <Anchor component={Link} to={`/machines/${m.id}`} size="xs">
                      {m.hostname ?? `#${m.id}`}
                    </Anchor>{' '}
                    {m.isCi && (
                      <Badge size="xs" variant="outline" color="gray">
                        CI
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{m.cpuModel ?? '–'}</Table.Td>
                  <Table.Td>{m.osPretty ?? '–'}</Table.Td>
                  <Table.Td className="num" style={{ textAlign: 'right' }}>{fmtNumber(m.builds)}</Table.Td>
                  <Table.Td>{m.lastBuildAt ? fmtAgo(m.lastBuildAt) : 'never'}</Table.Td>
                  <Table.Td w={40}>
                    <Tooltip label="Delete machine and its builds">
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => setTarget(m)} aria-label={`Delete ${m.hostname}`}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Confirm
        opened={target !== null}
        title={`Delete ${target?.hostname ?? 'machine'}?`}
        action="Delete machine"
        pending={del.isPending}
        error={del.error}
        onCancel={() => setTarget(null)}
        onConfirm={() => target && del.mutate(target.id, { onSuccess: () => setTarget(null) })}
      >
        The machine and its {fmtNumber(target?.builds ?? 0)} build(s) are removed permanently.
      </Confirm>
    </Panel>
  );
}

// --- legend groups ---------------------------------------------------------------------------

type Draft = Omit<StepCategory, 'id' | 'position'> & { key: number };

const ROLE_OPTIONS = [
  { value: '', label: 'Any step' },
  { value: 'custom', label: 'Custom commands' },
  { value: 'compile', label: 'Compile' },
  { value: 'link', label: 'Link' },
  { value: 'install', label: 'Install' },
  { value: 'test', label: 'Test' },
];
const FIELD_OPTIONS = [
  { value: 'command', label: 'Command line' },
  { value: 'file', label: 'Source / output file' },
  { value: 'target', label: 'Target name' },
];

let nextKey = 1;

function LegendAdmin() {
  const v = useViz();
  const cats = useStepCategories();
  const save = useSaveCategories();
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (cats.data && draft === null) setDraft(cats.data.map(({ id: _id, position: _p, ...r }) => ({ ...r, key: nextKey++ })));
  }, [cats.data, draft]);

  if (cats.error) return <ErrorNote error={cats.error} />;
  if (!draft) return <Loading />;

  const update = (key: number, patch: Partial<Draft>) => {
    setSaved(false);
    setDraft((d) => d!.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const move = (i: number, dir: -1 | 1) => {
    setSaved(false);
    setDraft((d) => {
      const next = [...d!];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });
  };
  const add = () => {
    setSaved(false);
    const used = new Set(draft.map((r) => r.colorSlot));
    // role colours use slots 1-5; start new groups on the free slots 6-8
    const slot = [6, 7, 8, 4, 5, 2, 3, 1].find((s) => !used.has(s)) ?? 6;
    setDraft([...draft, { key: nextKey++, name: '', colorSlot: slot, role: 'custom', field: 'command', pattern: '', isRegex: false, enabled: true }]);
  };

  return (
    <Panel
      title="Legend groups"
      subtitle="Steps that match a rule get its name and colour on every build timeline, and can be filtered by it. Rules are checked from top to bottom; the first match wins."
      actions={
        <Group gap="xs">
          <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={add}>
            Add group
          </Button>
          <Button
            size="xs"
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                draft.map(({ key: _k, ...r }) => ({ ...r, name: r.name.trim(), role: r.role || null })),
                { onSuccess: () => setSaved(true) },
              )
            }
          >
            Save
          </Button>
        </Group>
      }
    >
      {save.error && (
        <Alert color="red" variant="light" mb="sm">
          {save.error.message}
        </Alert>
      )}
      {saved && (
        <Alert color="green" variant="light" mb="sm" withCloseButton onClose={() => setSaved(false)}>
          Saved. Build timelines now use these groups.
        </Alert>
      )}
      {draft.length === 0 && (
        <Text size="sm" c="dimmed" mb="sm">
          No groups yet. Example: name <b>Qt moc</b>, steps <b>Custom commands</b>, match <b>Command line</b> containing <Code>moc</Code>.
        </Text>
      )}
      <Stack gap="sm">
        {draft.map((r, i) => (
          <Group key={r.key} gap="xs" align="flex-end" wrap="wrap" className="card" p="xs" style={{ borderRadius: 10 }}>
            <Switch size="xs" checked={r.enabled} onChange={(e) => update(r.key, { enabled: e.currentTarget.checked })} aria-label="Enabled" mb={8} />
            <TextInput size="xs" label="Name" w={170} value={r.name} onChange={(e) => update(r.key, { name: e.currentTarget.value })} maxLength={64} />
            <div>
              <Text size="xs" fw={500} mb={4}>
                Colour
              </Text>
              <Group gap={4} wrap="nowrap">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    className="swatch"
                    style={{ background: slotColor(v, slot) }}
                    aria-pressed={r.colorSlot === slot}
                    aria-label={`Colour ${slot}${slot <= 5 ? ` (also used by ${['compile', 'link', 'custom commands', 'configure', 'install/test'][slot - 1]})` : ''}`}
                    title={slot <= 5 ? `Also the colour of ${['compile', 'link', 'custom commands', 'configure', 'install/test'][slot - 1]}` : undefined}
                    onClick={() => update(r.key, { colorSlot: slot })}
                  />
                ))}
              </Group>
            </div>
            <Select size="xs" label="Steps" w={150} data={ROLE_OPTIONS} value={r.role ?? ''} onChange={(x) => update(r.key, { role: x || null })} allowDeselect={false} />
            <Select size="xs" label="Match" w={170} data={FIELD_OPTIONS} value={r.field} onChange={(x) => update(r.key, { field: (x ?? 'command') as Draft['field'] })} allowDeselect={false} />
            <TextInput
              size="xs"
              label={r.isRegex ? 'Regular expression' : 'Contains (case-insensitive)'}
              w={240}
              value={r.pattern}
              onChange={(e) => update(r.key, { pattern: e.currentTarget.value })}
              classNames={{ input: 'mono' }}
              maxLength={512}
            />
            <Checkbox size="xs" label="Regex" checked={r.isRegex} onChange={(e) => update(r.key, { isRegex: e.currentTarget.checked })} mb={8} />
            <Group gap={2} ml="auto" mb={4}>
              <ActionIcon size="sm" variant="subtle" color="gray" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                <IconArrowUp size={14} />
              </ActionIcon>
              <ActionIcon size="sm" variant="subtle" color="gray" disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                <IconArrowDown size={14} />
              </ActionIcon>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="red"
                onClick={() => {
                  setSaved(false);
                  setDraft(draft.filter((x) => x.key !== r.key));
                }}
                aria-label="Remove group"
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
          </Group>
        ))}
      </Stack>
    </Panel>
  );
}
