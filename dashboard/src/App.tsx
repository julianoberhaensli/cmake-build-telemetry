import { ActionIcon, AppShell, Box, Burger, Group, NavLink, Text, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import {
  IconApi,
  IconArrowsDiff,
  IconDeviceDesktopAnalytics,
  IconFlame,
  IconLayoutDashboard,
  IconListDetails,
  IconLogout,
  IconMoon,
  IconPlugConnected,
  IconServer2,
  IconShieldLock,
  IconSun,
  IconViewportNarrow,
  IconViewportWide,
} from '@tabler/icons-react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { useMe } from './api/hooks';
import { AdminPage } from './pages/AdminPage';
import { BuildDetailPage } from './pages/BuildDetailPage';
import { BuildsPage } from './pages/BuildsPage';
import { ComparePage } from './pages/ComparePage';
import { HotspotsPage } from './pages/HotspotsPage';
import { MachineDetailPage } from './pages/MachineDetailPage';
import { MachinesPage } from './pages/MachinesPage';
import { OverviewPage } from './pages/OverviewPage';
import { SetupPage } from './pages/SetupPage';
import { Empty } from './components/Ui';

const NAV = [
  { to: '/', label: 'Overview', icon: IconLayoutDashboard, exact: true },
  { to: '/builds', label: 'Builds', icon: IconListDetails },
  { to: '/machines', label: 'Machines', icon: IconServer2 },
  { to: '/hotspots', label: 'Hotspots', icon: IconFlame },
  { to: '/compare', label: 'Compare', icon: IconArrowsDiff },
  { to: '/setup', label: 'Connect builds', icon: IconPlugConnected },
  { to: '/admin', label: 'Admin', icon: IconShieldLock },
];

/** Keep the global filter (range, project, …) when moving between list pages. */
const KEEP = ['range', 'project', 'branch', 'source', 'kind', 'buildType'];

/** Page content width: 'full' stretches across the screen, 'centered' caps it at CENTERED_MAX_W. */
type LayoutMode = 'full' | 'centered';
const CENTERED_MAX_W = 1400;

export function App() {
  const [opened, { toggle, close }] = useDisclosure();
  // per viewer, in this browser only; read synchronously so a centered layout does not flash full width
  const [layout, setLayout] = useLocalStorage<LayoutMode>({ key: 'bt-layout', defaultValue: 'full', getInitialValueInEffect: false });
  const location = useLocation();
  const { setColorScheme } = useMantineColorScheme();
  // resolved scheme ('auto' follows the OS), so the toggle always flips what is on screen
  const colorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const { data: me } = useMe();
  const current = new URLSearchParams(location.search);
  const carry = new URLSearchParams();
  KEEP.forEach((k) => current.get(k) && carry.set(k, current.get(k)!));
  const suffix = carry.toString() ? `?${carry}` : '';

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <IconDeviceDesktopAnalytics size={22} color="var(--viz-s1)" />
            <Text fw={700}>Build Telemetry</Text>
          </Group>
          <Group gap="xs">
            {me?.authenticated && (
              <Text size="sm" c="dimmed">
                {me.name}
              </Text>
            )}
            <Tooltip label="API reference">
              <ActionIcon component="a" href="/api/docs" variant="subtle" color="gray" aria-label="API reference">
                <IconApi size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={layout === 'centered' ? 'Full width' : 'Centered layout'}>
              <ActionIcon
                className="layout-toggle"
                variant="subtle"
                color="gray"
                onClick={() => setLayout(layout === 'centered' ? 'full' : 'centered')}
                aria-label={layout === 'centered' ? 'Use full width' : 'Use centered layout'}
              >
                {layout === 'centered' ? <IconViewportWide size={18} /> : <IconViewportNarrow size={18} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label={colorScheme === 'dark' ? 'Light mode' : 'Dark mode'}>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
                aria-label="Toggle color scheme"
              >
                {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Tooltip>
            {me?.authMode === 'oidc' && me.authenticated && (
              <Tooltip label="Sign out">
                <ActionIcon component="a" href="/auth/logout" variant="subtle" color="gray" aria-label="Sign out">
                  <IconLogout size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        <AppShell.Section grow>
        {NAV.map((n) => {
          const active = n.exact ? location.pathname === n.to : location.pathname.startsWith(n.to);
          return (
            <NavLink
              key={n.to}
              component={Link}
              to={n.to + (n.to === '/setup' || n.to === '/compare' || n.to === '/admin' ? '' : suffix)}
              label={n.label}
              leftSection={<n.icon size={18} stroke={1.6} />}
              active={active}
              onClick={close}
              style={{ borderRadius: 8 }}
            />
          );
        })}
        </AppShell.Section>
        <AppShell.Section>
          <Text size="xs" c="dimmed" px="sm" title={me?.version && me.version !== __APP_VERSION__ ? `Server ${me.version}` : undefined}>
            Build Telemetry {__APP_VERSION__}
            {me?.version && me.version !== __APP_VERSION__ && ` · server ${me.version}`}
          </Text>
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main>
        <Box maw={layout === 'centered' ? CENTERED_MAX_W : undefined} mx="auto">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/builds" element={<BuildsPage />} />
            <Route path="/builds/:id" element={<BuildDetailPage />} />
            <Route path="/machines" element={<MachinesPage />} />
            <Route path="/machines/:id" element={<MachineDetailPage />} />
            <Route path="/hotspots" element={<HotspotsPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<Empty>Page not found.</Empty>} />
          </Routes>
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
