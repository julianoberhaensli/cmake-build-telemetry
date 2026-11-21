import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiGet } from './client';
import type {
  BuildDetail,
  BuildListItem,
  ClientInfo,
  CompareResult,
  FileHotspot,
  Filters,
  HardwareProfile,
  Machine,
  Me,
  Overview,
  Paged,
  Step,
  StepDetail,
  TargetHotspot,
  TrendPoint,
} from './types';
import { filterKey, toApiParams, type FilterState } from '../state/filters';

type Extra = Record<string, string | number | boolean | null | undefined>;

// Refetch keeps the previous frame (no skeleton flash when filters change).
const keep = { placeholderData: keepPreviousData } as const;

export const useFilterOptions = () =>
  useQuery({ queryKey: ['filters'], queryFn: ({ signal }) => apiGet<Filters>('/filters', {}, signal), staleTime: 5 * 60_000 });

export const useOverview = (f: FilterState, extra: Extra = {}) =>
  useQuery({
    queryKey: ['overview', filterKey(f), extra],
    queryFn: ({ signal }) => apiGet<Overview>('/overview', toApiParams(f, extra), signal),
    ...keep,
  });

export const useTrend = (f: FilterState, extra: Extra = {}) =>
  useQuery({
    queryKey: ['trend', filterKey(f), extra],
    queryFn: ({ signal }) => apiGet<TrendPoint[]>('/trend', toApiParams(f, extra), signal),
    ...keep,
  });

export const useBuilds = (f: FilterState, extra: Extra) =>
  useQuery({
    queryKey: ['builds', filterKey(f), extra],
    queryFn: ({ signal }) => apiGet<Paged<BuildListItem>>('/builds', toApiParams(f, extra), signal),
    ...keep,
  });

export const useBuild = (id: string | undefined) =>
  useQuery({
    queryKey: ['build', id],
    queryFn: ({ signal }) => apiGet<BuildDetail>(`/builds/${id}`, {}, signal),
    enabled: !!id,
    staleTime: Infinity,
  });

export const useSteps = (id: string | undefined) =>
  useQuery({
    queryKey: ['steps', id],
    queryFn: ({ signal }) => apiGet<Step[]>(`/builds/${id}/steps`, {}, signal),
    enabled: !!id,
    staleTime: Infinity,
  });

export const useStep = (id: string | undefined, seq: number | null) =>
  useQuery({
    queryKey: ['step', id, seq],
    queryFn: ({ signal }) => apiGet<StepDetail>(`/builds/${id}/steps/${seq}`, {}, signal),
    enabled: !!id && seq !== null,
    staleTime: Infinity,
  });

export const useMachines = (f: FilterState) =>
  useQuery({
    queryKey: ['machines', filterKey(f)],
    queryFn: ({ signal }) => apiGet<Machine[]>('/machines', toApiParams(f), signal),
    ...keep,
  });

export const useMachine = (id: number, f: FilterState) =>
  useQuery({
    queryKey: ['machine', id, filterKey(f)],
    queryFn: ({ signal }) => apiGet<Machine>(`/machines/${id}`, toApiParams(f), signal),
    ...keep,
  });

export const useHardware = (f: FilterState) =>
  useQuery({
    queryKey: ['hardware', filterKey(f)],
    queryFn: ({ signal }) => apiGet<HardwareProfile[]>('/hardware', toApiParams(f), signal),
    ...keep,
  });

export const useFileHotspots = (f: FilterState, extra: Extra) =>
  useQuery({
    queryKey: ['hot-files', filterKey(f), extra],
    queryFn: ({ signal }) => apiGet<FileHotspot[]>('/hotspots/files', toApiParams(f, extra), signal),
    ...keep,
  });

export const useTargetHotspots = (f: FilterState, extra: Extra = {}) =>
  useQuery({
    queryKey: ['hot-targets', filterKey(f), extra],
    queryFn: ({ signal }) => apiGet<TargetHotspot[]>('/hotspots/targets', toApiParams(f, extra), signal),
    ...keep,
  });

export const useCompare = (a: string | null, b: string | null) =>
  useQuery({
    queryKey: ['compare', a, b],
    queryFn: ({ signal }) => apiGet<CompareResult>('/compare', { a, b }, signal),
    enabled: !!a && !!b,
    staleTime: Infinity,
  });

export const useClientInfo = () =>
  useQuery({
    queryKey: ['client-info'],
    queryFn: ({ signal }) => apiGet<ClientInfo>('/client/info', {}, signal),
    staleTime: Infinity,
  });

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: ({ signal }) => apiGet<Me>('/me', {}, signal), staleTime: 5 * 60_000 });
