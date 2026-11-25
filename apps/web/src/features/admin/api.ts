import {
  CreatedUserSchema,
  DeactivationResultSchema,
  DepartmentResultSchema,
  ImportResultSchema,
  InviteCreatedSchema,
  InviteListSchema,
  OkSchema,
  ProjectsConfigSchema,
  type ImportRequest,
  type InviteCreate,
  type PasswordReset,
  type UserCreate,
} from '@officepm/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/api';

/** projects.json as the server loaded it. Admin only on the server. */
export const projectsConfigQuery = queryOptions({
  queryKey: qk.projects.config,
  queryFn: ({ signal }) => api.get('/api/admin/projects', ProjectsConfigSchema, { signal }),
});

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UserCreate) => api.post('/api/users', CreatedUserSchema, input),
    // The same list feeds the assignee pickers, so refresh it wherever it is cached.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.users }),
  });
}

/** Admin only. Pass null to clear the department; the server answers 400 to a blank string. */
export function useSetDepartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, department }: { id: number; department: string | null }) =>
      api.patch(`/api/users/${id}/department`, DepartmentResultSchema, {
        department,
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.users });
      void queryClient.invalidateQueries({ queryKey: qk.people });
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, ...body }: PasswordReset & { id: number }) =>
      api.patch(`/api/users/${id}/password`, OkSchema, body),
  });
}

/** Admin only. Every invite, newest first, with its status. Tokens are never in it. */
export const invitesQuery = queryOptions({
  queryKey: qk.invites.list(),
  queryFn: ({ signal }) => api.get('/api/invites', InviteListSchema, { signal }),
});

/** The answer holds the invite link, the only copy of the token: show it once. */
export function useCreateInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteCreate) => api.post('/api/invites', InviteCreatedSchema, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.invites.list() }),
  });
}

export function useRevokeInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/invites/${encodeURIComponent(id)}`, OkSchema),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.invites.list() }),
  });
}

/** `dry_run: true` only checks; `false` makes the invites and returns their links. */
export function useImportStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportRequest) =>
      api.post('/api/invites/import', ImportResultSchema, input),
    onSuccess: (result) => {
      if (!result.dry_run) void queryClient.invalidateQueries({ queryKey: qk.invites.list() });
    },
  });
}

/** Deactivating ends the person's sessions and drops them from the assignee pickers. */
export function useSetActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      api.post(
        `/api/users/${id}/${active ? 'reactivate' : 'deactivate'}`,
        DeactivationResultSchema,
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.users });
      void queryClient.invalidateQueries({ queryKey: qk.people });
    },
  });
}
