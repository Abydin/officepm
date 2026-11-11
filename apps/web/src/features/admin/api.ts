import {
  CreatedUserSchema,
  DepartmentResultSchema,
  OkSchema,
  ProjectsConfigSchema,
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

/** Admin only. A blank department clears it. */
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
