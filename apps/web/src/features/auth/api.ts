import { OkSchema, UserSchema, type LoginInput, type User } from '@officepm/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isApiError, qk } from '@/lib/api';

/** `null` means signed out. A 401 on /api/me is the normal anonymous answer, not a failure. */
export async function fetchSession(signal?: AbortSignal): Promise<User | null> {
  try {
    return await api.get('/api/me', UserSchema, { signal });
  } catch (error) {
    if (isApiError(error) && error.isUnauthorized) return null;
    throw error;
  }
}

export const sessionQuery = queryOptions({
  queryKey: qk.session,
  queryFn: ({ signal }) => fetchSession(signal),
  // The session only changes by logging in or out, or a 401 from any request.
  staleTime: Infinity,
  retry: false,
});

export function useSession() {
  return useQuery(sessionQuery);
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post('/api/login', UserSchema, input),
    onSuccess: (user) => {
      // Anything cached belonged to nobody or to someone else.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== qk.session[0] });
      queryClient.setQueryData(qk.session, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/logout', OkSchema),
    onSettled: () => {
      // Even if the request failed the person asked to leave: drop everything locally.
      queryClient.clear();
      queryClient.setQueryData(qk.session, null);
    },
  });
}
