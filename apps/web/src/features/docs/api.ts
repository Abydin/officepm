import {
  DocListSchema,
  DocSchema,
  OkSchema,
  ProjectFileListSchema,
  ProjectFileSchema,
  type DocCreate,
} from '@officepm/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/api';

const enc = encodeURIComponent;
const projectPath = (slug: string) => `/api/projects/${enc(slug)}`;

export const docsQuery = (slug: string) =>
  queryOptions({
    queryKey: qk.projects.docs(slug),
    queryFn: ({ signal }) => api.get(`${projectPath(slug)}/docs`, DocListSchema, { signal }),
  });

export const projectFilesQuery = (slug: string) =>
  queryOptions({
    queryKey: qk.projects.files(slug),
    queryFn: ({ signal }) =>
      api.get(`${projectPath(slug)}/files`, ProjectFileListSchema, { signal }),
  });

export function useAddDoc(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DocCreate) => api.post(`${projectPath(slug)}/docs`, DocSchema, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.projects.docs(slug) }),
  });
}

export function useDeleteDoc(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${projectPath(slug)}/docs/${enc(id)}`, OkSchema),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.projects.docs(slug) }),
  });
}

export function useUploadProjectFile(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post(`${projectPath(slug)}/files`, ProjectFileSchema, form);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.projects.files(slug) }),
  });
}

export function useDeleteProjectFile(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${projectPath(slug)}/files/${enc(id)}`, OkSchema),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.projects.files(slug) }),
  });
}

export const projectFileUrl = (slug: string, id: string) => `${projectPath(slug)}/files/${enc(id)}`;
