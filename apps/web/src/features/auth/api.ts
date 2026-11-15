import { OkSchema, UserSchema, type LoginInput, type User } from '@officepm/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/api';

/**
 * `null` means signed out. This asks /api/session, which answers 200 with null for
 * nobody, because a 401 from /api/me prints a red error in the browser console on
 * every first visit even though it is the normal anonymous answer.
 */
export function fetchSession(signal?: AbortSignal): Promise<User | null> {
  return api.get('/api/session', UserSchema.nullable(), { signal });
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
