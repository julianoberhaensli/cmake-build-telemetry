import { Alert, Anchor, Button, Code, CopyButton, Group, List, Stack, Table, Tabs, Text, ThemeIcon } from '@mantine/core';
import { IconDownload, IconInfoCircle, IconShieldLock } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useClientInfo } from '../api/hooks';
import { PageHeader, Panel } from '../components/Ui';

function Snippet({ code, lang }: { code: string; lang?: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <Code block style={{ whiteSpace: 'pre', overflowX: 'auto', paddingRight: 72 }} aria-label={lang}>
        {code}
      </Code>
      <CopyButton value={code}>
        {({ copied, copy }) => (
          <Button size="compact-xs" variant="default" onClick={copy} style={{ position: 'absolute', top: 8, right: 8 }}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </CopyButton>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Group align="flex-start" wrap="nowrap" gap="md">
      <ThemeIcon radius="xl" size={26} variant="light">
        <Text size="xs" fw={700}>
          {n}
        </Text>
      </ThemeIcon>
      <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm">
          {title}
        </Text>
        {children}
      </Stack>
    </Group>
  );
}

export function SetupPage() {
  const { data: info } = useClientInfo();
  const url = info?.publicUrl || window.location.origin;
  const tokenFlag = info?.ingestRequiresKey ? ' -DBUILD_TELEMETRY_TOKEN=<your-key>' : '';
  const tokenEnv = info?.ingestRequiresKey ? '\nexport BUILD_TELEMETRY_TOKEN=<your-key>' : '';

  return (
    <>
      <PageHeader
        title="Connect your builds"
        subtitle="One CMake file, no other dependencies. Requires CMake 4.3+ and a Ninja or Makefile generator; older setups simply skip telemetry."
        actions={
          <Button component="a" href="/api/v1/client/BuildTelemetry.cmake" download="BuildTelemetry.cmake" leftSection={<IconDownload size={16} />}>
            Download BuildTelemetry.cmake
          </Button>
        }
      />
      <Stack gap="md">
        {info?.ingestRequiresKey && (
          <Alert icon={<IconShieldLock size={16} />} color="brand" variant="light" title="This server requires an ingest API key">
            Ask your administrator for a key and pass it as <Code>BUILD_TELEMETRY_TOKEN</Code> (environment variable recommended, so it never lands in a repository).
          </Alert>
        )}
        <Tabs defaultValue="project" variant="outline">
          <Tabs.List>
            <Tabs.Tab value="project">Project (recommended)</Tabs.Tab>
            <Tabs.Tab value="noedit">Without editing the project</Tabs.Tab>
            <Tabs.Tab value="machine">Whole machine / CI runner</Tabs.Tab>
            <Tabs.Tab value="ci">CI pipelines</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="project" pt="md">
            <Panel>
              <Stack gap="lg">
                <Step n={1} title="Add the module to your repository">
                  <Text size="sm">The downloaded copy already points at this server ({url}).</Text>
                  <Snippet code={`curl -fsSL ${url}/api/v1/client/BuildTelemetry.cmake -o cmake/BuildTelemetry.cmake`} />
                </Step>
                <Step n={2} title="Include it once in the top-level CMakeLists.txt">
                  <Snippet code={`include(cmake/BuildTelemetry.cmake)`} />
                  <Text size="xs" c="dimmed">
                    Safe with any <Code>cmake_minimum_required</Code>: on CMake &lt; 4.3, Visual Studio/Xcode generators or without an endpoint it prints one status line and does nothing.
                  </Text>
                </Step>
                <Step n={3} title="Build as usual">
                  <Snippet code={`cmake -S . -B build -G Ninja${tokenFlag}\nninja -C build        # or: cmake --build build`} />
                  <Text size="xs" c="dimmed">
                    The build appears here a few seconds after it finishes. Uploads run in the background; when the server is unreachable data is queued and retried later.
                  </Text>
                </Step>
              </Stack>
            </Panel>
          </Tabs.Panel>

          <Tabs.Panel value="noedit" pt="md">
            <Panel>
              <Stack gap="sm">
                <Text size="sm">
                  Inject the module at configure time with <Code>CMAKE_PROJECT_TOP_LEVEL_INCLUDES</Code> (CMake 3.24+) - on the command line or in a <Code>CMakeUserPresets.json</Code>:
                </Text>
                <Snippet code={`cmake -S . -B build -G Ninja \\\n  -DCMAKE_PROJECT_TOP_LEVEL_INCLUDES=/path/to/BuildTelemetry.cmake \\\n  -DBUILD_TELEMETRY_URL=${url}${tokenFlag}`} />
                <Snippet
                  lang="json"
                  code={`{
  "version": 6,
  "configurePresets": [{
    "name": "telemetry", "inherits": "default",
    "cacheVariables": {
      "CMAKE_PROJECT_TOP_LEVEL_INCLUDES": "\${sourceDir}/../BuildTelemetry.cmake",
      "BUILD_TELEMETRY_URL": "${url}"
    }
  }]
}`}
                />
              </Stack>
            </Panel>
          </Tabs.Panel>

          <Tabs.Panel value="machine" pt="md">
            <Panel>
              <Stack gap="sm">
                <Text size="sm">
                  Installs a user-wide CMake instrumentation query: every CMake 4.3+ build of this user is instrumented, no project changes at all. Ideal for build agents and golden images.
                </Text>
                <Snippet code={`cmake -DBUILD_TELEMETRY_URL=${url}${tokenFlag} -P BuildTelemetry.cmake install\ncmake -P BuildTelemetry.cmake test        # connectivity + key check\ncmake -P BuildTelemetry.cmake status\ncmake -P BuildTelemetry.cmake uninstall`} />
              </Stack>
            </Panel>
          </Tabs.Panel>

          <Tabs.Panel value="ci" pt="md">
            <Panel>
              <Stack gap="sm">
                <Text size="sm">
                  CI is detected automatically (GitHub Actions, GitLab, Azure Pipelines, Jenkins, Buildkite, TeamCity, CircleCI, Bitbucket): branch, commit and job link are attached and uploads finish before the step ends.
                </Text>
                <Snippet code={`export BUILD_TELEMETRY_URL=${url}${tokenEnv}\nexport BUILD_TELEMETRY_TAGS="team=platform,pipeline=nightly"\ncmake -S . -B build -G Ninja && cmake --build build\ncmake -P cmake/BuildTelemetry.cmake flush build   # optional: retry anything still queued`} />
              </Stack>
            </Panel>
          </Tabs.Panel>
        </Tabs>

        <Panel title="Settings" subtitle="CMake variable (-D...) or environment variable of the same name; the environment wins at build time">
          <Table fz="sm" verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Default</Table.Th>
                <Table.Th>Meaning</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[
                ['BUILD_TELEMETRY', 'ON', 'Master switch. OFF / 0 disables (configure: removes instrumentation; build: skips upload). DO_NOT_TRACK=1 is honoured too.'],
                ['BUILD_TELEMETRY_URL', 'this server', 'Server base URL.'],
                ['BUILD_TELEMETRY_TOKEN', '–', 'Ingest API key (prefer the environment variable).'],
                ['BUILD_TELEMETRY_DETAIL', 'full', 'full = per step incl. command lines · nocommands = per step without commands · summary = totals per role only.'],
                ['BUILD_TELEMETRY_ANONYMIZE', 'OFF', 'Hash host name, replace source/build paths, drop commands.'],
                ['BUILD_TELEMETRY_USER_ID', 'hash', 'hash | plain | none - how the OS user is reported.'],
                ['BUILD_TELEMETRY_TAGS', '–', 'key=value list (comma separated) to group builds, e.g. team=engine.'],
                ['BUILD_TELEMETRY_UPLOAD', 'auto', 'auto (background locally, synchronous on CI) | async | sync.'],
                ['BUILD_TELEMETRY_TIMEOUT', '10', 'Upload timeout in seconds; failures back off exponentially (1 min … 1 h).'],
                ['BUILD_TELEMETRY_DYNAMIC_SYSINFO', 'OFF', 'Also record CPU load / memory before and after every command (adds overhead).'],
              ].map(([n, d, m]) => (
                <Table.Tr key={n}>
                  <Table.Td>
                    <Code>{n}</Code>
                  </Table.Td>
                  <Table.Td>{d}</Table.Td>
                  <Table.Td>{m}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Panel>

        <Alert icon={<IconInfoCircle size={16} />} variant="light" color="gray" title="What is collected">
          <List size="sm" spacing={2}>
            <List.Item>Per command: role, target, source file, start time, duration, exit code, output size, peak memory and CPU time (CMake 4.5+), and – at detail “full” – the command line.</List.Item>
            <List.Item>Per build: CMake version, generator, compilers, build type, launcher (ccache…), branch/commit, CI job, tags.</List.Item>
            <List.Item>Per machine: CPU model, cores, memory, OS, a random machine id; the OS user only as a hash.</List.Item>
          </List>
          <Text size="xs" mt="xs">
            Source code is never read or sent. API reference: <Anchor href="/api/docs">/api/docs</Anchor>
          </Text>
        </Alert>
      </Stack>
    </>
  );
}
