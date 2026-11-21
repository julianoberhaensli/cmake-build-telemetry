// Response shapes of the BuildTelemetry API (/api/v1). Mirrors server/Analytics/Dtos.cs.

export interface Overview {
  builds: number;
  failed: number;
  successRate: number | null;
  machines: number;
  projects: number;
  developers: number;
  p50WallMs: number | null;
  p90WallMs: number | null;
  avgWallMs: number | null;
  totalWallMs: number;
  compileUnits: number;
  avgCompileMs: number | null;
  avgParallelism: number | null;
  fullBuilds: number;
  fullP50WallMs: number | null;
  ciBuilds: number;
  previous: Overview | null;
}

export interface TrendPoint {
  bucket: string;
  builds: number;
  failed: number;
  p50WallMs: number | null;
  p90WallMs: number | null;
  avgWallMs: number | null;
  fullP50WallMs: number | null;
  compileUnits: number;
}

export interface BuildListItem {
  id: string;
  project: string;
  machineId: number;
  hostname: string | null;
  cpuModel: string | null;
  logicalCores: number | null;
  osPretty: string | null;
  startedAt: string;
  wallMs: number;
  success: boolean;
  kind: string;
  compileCount: number;
  compileMs: number;
  linkCount: number;
  failedCount: number;
  parallelism: number | null;
  branch: string | null;
  commitSha: string | null;
  buildType: string | null;
  isCi: boolean;
  ciProvider: string | null;
  cxxCompilerId: string | null;
  cxxCompilerVersion: string | null;
  userHash: string | null;
  maxRssKb: number | null;
  hook: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Machine {
  id: number;
  machineKey: string;
  hostname: string | null;
  osName: string | null;
  osRelease: string | null;
  osPretty: string | null;
  cpuModel: string | null;
  cpuVendor: string | null;
  logicalCores: number | null;
  physicalCores: number | null;
  cpuMhz: number | null;
  memoryMb: number | null;
  isCi: boolean;
  firstSeen: string;
  lastSeen: string;
  builds: number;
  failed: number;
  p50WallMs: number | null;
  p50FullWallMs: number | null;
  avgCompileMs: number | null;
  avgParallelism: number | null;
  maxRssKb: number | null;
  speedIndex: number | null;
  speedSamples: number;
}

export interface HardwareProfile {
  key: string;
  cpuModel: string | null;
  logicalCores: number | null;
  memoryGb: number | null;
  osName: string | null;
  machines: number;
  builds: number;
  p50WallMs: number | null;
  p50FullWallMs: number | null;
  avgCompileMs: number | null;
  avgParallelism: number | null;
  speedIndex: number | null;
  speedSamples: number;
}

export interface TargetAgg {
  target: string;
  targetType: string | null;
  compiles: number;
  compileMs: number;
  linkMs: number;
  customMs: number;
  firstStartMs: number;
  lastEndMs: number;
}

export interface RoleAgg {
  role: string;
  count: number;
  durationMs: number;
  failed: number;
}

export interface BuildDetail extends Omit<BuildListItem, 'hostname' | 'cpuModel' | 'logicalCores' | 'osPretty'> {
  receivedAt: string;
  finishedAt: string;
  configureMs: number;
  generateMs: number;
  linkMs: number;
  customCount: number;
  customMs: number;
  totalStepMs: number;
  outputBytes: number | null;
  generator: string | null;
  buildTool: string | null;
  cmakeVersion: string | null;
  cCompilerId: string | null;
  cCompilerVersion: string | null;
  compilerLauncher: string | null;
  linkerType: string | null;
  ciUrl: string | null;
  ciJob: string | null;
  detail: string | null;
  clientVersion: string | null;
  dataVersion: string | null;
  ingestKey: string | null;
  sourceDir: string | null;
  buildDir: string | null;
  tags: Record<string, string> | null;
  roleStats: Record<string, { count: number; durationMs: number; failed: number }> | null;
  systemInfo: Record<string, unknown> | null;
  machine: Machine | null;
  targets: TargetAgg[];
  roles: RoleAgg[];
  projectMedianFullWallMs: number | null;
}

export interface Step {
  seq: number;
  role: string;
  target: string | null;
  targetType: string | null;
  source: string | null;
  output: string | null;
  language: string | null;
  startMs: number;
  durationMs: number;
  result: number | null;
  maxRssKb: number | null;
  outputBytes: number | null;
  hasCommand: boolean;
  lane: number;
}

export interface StepDetail {
  seq: number;
  role: string;
  target: string | null;
  source: string | null;
  output: string | null;
  config: string | null;
  startMs: number;
  durationMs: number;
  result: number | null;
  maxRssKb: number | null;
  userTimeUs: number | null;
  systemTimeUs: number | null;
  command: string | null;
}

export interface FileHotspot {
  source: string;
  target: string | null;
  compiles: number;
  builds: number;
  machines: number;
  avgMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  maxMs: number;
  totalMs: number;
  avgRssKb: number | null;
  maxRssKb: number | null;
  failures: number;
}

export interface TargetHotspot {
  target: string;
  targetType: string | null;
  compiles: number;
  builds: number;
  compileMs: number;
  avgCompileMs: number | null;
  avgLinkMs: number | null;
  totalMs: number;
}

export interface CompareFile {
  source: string;
  target: string | null;
  aMs: number | null;
  bMs: number | null;
  deltaMs: number;
}

export interface CompareResult {
  a: BuildListItem;
  b: BuildListItem;
  files: CompareFile[];
  rolesA: RoleAgg[];
  rolesB: RoleAgg[];
}

export interface Filters {
  projects: { name: string; count: number }[];
  branches: string[];
  buildTypes: string[];
  compilers: string[];
  machines: { id: number; hostname: string | null; cpuModel: string | null; isCi: boolean }[];
  ciProviders: string[];
  tagKeys: string[];
}

export interface ClientInfo {
  publicUrl: string;
  ingestRequiresKey: boolean;
  clientVersion: string | null;
  authMode: string;
}

export interface Me {
  authenticated: boolean;
  name: string | null;
  authMode: string;
}
