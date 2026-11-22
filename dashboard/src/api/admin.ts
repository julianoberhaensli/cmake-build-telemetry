import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet, toQuery } from './client';
import type { AdminMachine, AdminSession, StepCategory } from './types';
import { toApiParams, type FilterState } from '../state/filters';

/** State-changing admin call. The header is the server's CSRF guard (custom headers need CORS). */
export async function apiSend<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, params: Record<string, string | number | boolean | null | undefined> = {}): Promise<T | null> {
  const res = await fetch(`/api/v1${path}${toQuery(params)}`, {
    method,
    headers: {
      Accept: 'application/json',
      'X-BuildTelemetry-Admin': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.status === 401 ? 'Not signed in as admin' : res.statusText;
    try {
      const p = await res.json();
      // "rules[3].name" -> "Group 4: …" so the editor can say which row is wrong
      const fieldErrors = p.errors
        ? Object.entries(p.errors as Record<string, string[]>).flatMap(([k, msgs]) => {
            const row = /^rules\[(\d+)\]/.exec(k);
            return msgs.map((m) => (row ? `Group ${Number(row[1]) + 1}: ${m}` : m));
          })
        : [];
      detail = fieldErrors.length ? fieldErrors.join(' ') : (p.detail ?? p.title ?? detail);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? null : ((await res.json()) as T);
}

export const useAdminSession = () =>
  useQuery({ queryKey: ['admin-session'], queryFn: ({ signal }) => apiGet<AdminSession>('/admin/session', {}, signal), staleTime: 60_000 });

export const useIsAdmin = () => useAdminSession().data?.isAdmin === true;

export const useStepCategories = () =>
  useQuery({ queryKey: ['step-categories'], queryFn: ({ signal }) => apiGet<StepCategory[]>('/step-categories', {}, signal), staleTime: 5 * 60_000 });

export const useAdminMachines = (enabled: boolean) =>
  useQuery({ queryKey: ['admin-machines'], queryFn: ({ signal }) => apiGet<AdminMachine[]>('/admin/machines', {}, signal), enabled });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => apiSend('POST', '/admin/login', { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-session'] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend('POST', '/admin/logout'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-session'] }),
  });
}

/** After deleting, every cached list / statistic may be stale. */
function useInvalidateData() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => !['admin-session', 'step-categories', 'me', 'client-info'].includes(String(q.queryKey[0])) });
}

export function useDeleteBuilds() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: (ids: string[]) => apiSend<{ deleted: number }>('POST', '/admin/builds/delete', { ids }),
    onSuccess: invalidate,
  });
}

export function useDeleteMatchingBuilds() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ filters, extra }: { filters: FilterState; extra: Record<string, string | null> }) =>
      apiSend<{ deleted: number }>('POST', '/admin/builds/delete-matching', undefined, toApiParams(filters, extra)),
    onSuccess: invalidate,
  });
}

export function useDeleteMachine() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: (id: number) => apiSend<{ deleted: number }>('DELETE', `/admin/machines/${id}`),
    onSuccess: invalidate,
  });
}

export function useSaveCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rules: Omit<StepCategory, 'id' | 'position'>[]) => apiSend<StepCategory[]>('PUT', '/admin/step-categories', rules),
    onSuccess: (saved) => {
      qc.setQueryData(['step-categories'], saved);
      // categories are resolved server-side per step
      qc.invalidateQueries({ queryKey: ['steps'] });
    },
  });
}
