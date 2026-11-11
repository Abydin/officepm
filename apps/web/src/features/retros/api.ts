import {
  RetroCardSchema,
  RetroListSchema,
  RetroWithCardsSchema,
  type RetroCardCreate,
} from '@officepm/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/api';

const enc = encodeURIComponent;

export const retrosQuery = (slug: string, board: string) =>
  queryOptions({
    queryKey: qk.retros.list(slug, board),
    queryFn: ({ signal }) =>
      api.get(`/api/projects/${enc(slug)}/boards/${enc(board)}/retros`, RetroListSchema, {
        signal,
      }),
  });

export const retroQuery = (id: string) =>
  queryOptions({
    queryKey: qk.retros.detail(id),
    queryFn: ({ signal }) => api.get(`/api/retros/${enc(id)}`, RetroWithCardsSchema, { signal }),
  });

export function useAddRetroCard(retroId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RetroCardCreate) =>
      api.post(`/api/retros/${enc(retroId)}/cards`, RetroCardSchema, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.retros.detail(retroId) }),
  });
}
