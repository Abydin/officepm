import {
  BoardSettingsSchema,
  BoardVelocitySchema,
  BurndownSchema,
  SprintSchema,
  TicketSchema,
  type SprintCreate,
  type SprintPatch,
} from '@officepm/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/api';

const enc = encodeURIComponent;
const boardPath = (slug: string, board: string) =>
  `/api/projects/${enc(slug)}/boards/${enc(board)}`;

export const burndownQuery = (sprintId: string) =>
  queryOptions({
    queryKey: qk.sprints.burndown(sprintId),
    queryFn: ({ signal }) =>
      api.get(`/api/sprints/${enc(sprintId)}/burndown`, BurndownSchema, { signal }),
  });

export const velocityQuery = (slug: string, board: string) =>
  queryOptions({
    queryKey: qk.sprints.velocity(slug, board),
    queryFn: ({ signal }) =>
      api.get(`${boardPath(slug, board)}/velocity`, BoardVelocitySchema, { signal }),
  });

/** Carries the board's Definition of Ready, which gates activating a sprint. */
export const boardSettingsQuery = (slug: string, board: string) =>
  queryOptions({
    queryKey: qk.projects.settings(slug, board),
    queryFn: ({ signal }) =>
      api.get(`${boardPath(slug, board)}/settings`, BoardSettingsSchema, { signal }),
  });

export function useCreateSprint(slug: string, board: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SprintCreate) =>
      api.post(`${boardPath(slug, board)}/sprints`, SprintSchema, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.sprints.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

/** Activate or complete a sprint, or change its name and dates. */
export function useUpdateSprint(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SprintPatch) => api.patch(`/api/sprints/${enc(id)}`, SprintSchema, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.sprints.all });
      // Completing a sprint makes the server create its retro.
      void queryClient.invalidateQueries({ queryKey: qk.retros.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

/** Puts a ticket into a sprint, or back in the backlog with `null`. */
export function useSetTicketSprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, sprintId }: { key: string; sprintId: string | null }) =>
      api.patch(`/api/tickets/${enc(key)}`, TicketSchema, { sprint_id: sprintId }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.tickets.all });
      void queryClient.invalidateQueries({ queryKey: qk.sprints.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}
