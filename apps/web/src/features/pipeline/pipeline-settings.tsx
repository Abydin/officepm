import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import {
  MAX_PIPELINE_PHASES,
  PHASE_NAME_MAX,
  type PipelineConfig,
  type Project,
} from '@officepm/shared';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { projectsQuery } from '@/features/projects/api';
import { errorMessage } from '@/lib/api';
import { projectPipelineQuery, usePutPipeline } from './api';

interface Row {
  /** Stable for the life of the editor, so a rename keeps its input focused. */
  id: number;
  name: string;
  department: string;
  /** The phase this row was called when it was loaded: how the server keeps tickets on a rename. */
  was: string | null;
}

let nextId = 1;

function Editor({
  slug,
  name,
  initial,
  saved,
  onSaved,
}: {
  slug: string;
  name: string;
  initial: PipelineConfig;
  saved: boolean;
  onSaved: (saved: boolean) => void;
}) {
  const save = usePutPipeline(slug);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.phases.map((p) => ({
      id: nextId++,
      name: p.name,
      department: p.department ?? '',
      was: p.name,
    })),
  );
  const deptList = useId();
  const data = initial;
  const setSaved = onSaved;

  const edit = (id: number, patch: Partial<Row>) => {
    setSaved(false);
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const move = (index: number, by: -1 | 1) => {
    setSaved(false);
    setRows((current) => {
      const next = [...current];
      const target = index + by;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };
  const remove = (id: number) => {
    setSaved(false);
    setRows((current) => current.filter((r) => r.id !== id));
  };
  const add = () => {
    setSaved(false);
    setRows((current) => [...current, { id: nextId++, name: '', department: '', was: null }]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(
      {
        phases: rows.map((r) => ({
          name: r.name,
          department: r.department.trim() || null,
          ...(r.was !== null ? { was: r.was } : {}),
        })),
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <form onSubmit={submit} aria-label={`Pipeline phases for ${name}`}>
      <p className="mt-0 mb-3 text-dim">
        {data.configured
          ? 'Features in this project move through these phases, in this order.'
          : 'This project uses the default phases until you save a list. Saving makes new features start at the first phase.'}
      </p>
      <datalist id={deptList}>
        {[...new Set(rows.map((r) => r.department).filter(Boolean))].map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <ol className="m-0 list-none space-y-2 p-0">
        {rows.map((row, i) => (
          <li key={row.id} className="flex flex-wrap items-end gap-2">
            <span className="w-6 pb-2 text-right font-mono text-xs text-dim">{i + 1}</span>
            <div className="min-w-40 flex-[2]">
              <label htmlFor={`phase-name-${row.id}`} className="mb-1 block text-xs text-dim">
                Phase {i + 1} name
              </label>
              <Input
                id={`phase-name-${row.id}`}
                maxLength={PHASE_NAME_MAX}
                autoComplete="off"
                value={row.name}
                onChange={(e) => edit(row.id, { name: e.target.value })}
              />
            </div>
            <div className="min-w-36 flex-1">
              <label htmlFor={`phase-dept-${row.id}`} className="mb-1 block text-xs text-dim">
                Phase {i + 1} department
              </label>
              <Input
                id={`phase-dept-${row.id}`}
                maxLength={40}
                autoComplete="off"
                list={deptList}
                placeholder="None"
                value={row.department}
                onChange={(e) => edit(row.id, { department: e.target.value })}
              />
            </div>
            <Button
              size="icon"
              aria-label={`Move ${row.name || `phase ${i + 1}`} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </Button>
            <Button
              size="icon"
              aria-label={`Move ${row.name || `phase ${i + 1}`} down`}
              disabled={i === rows.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown className="size-4" aria-hidden="true" />
            </Button>
            <Button
              size="icon"
              aria-label={`Remove ${row.name || `phase ${i + 1}`}`}
              onClick={() => remove(row.id)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={add} disabled={rows.length >= MAX_PIPELINE_PHASES}>
          <Plus className="size-4" aria-hidden="true" />
          Add phase
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={save.isPending || rows.length === 0 || rows.some((r) => !r.name.trim())}
        >
          Save phases
        </Button>
        <span role="status" className="text-ok empty:hidden">
          {saved ? 'Saved.' : ''}
        </span>
      </div>
      {save.isError && <ErrorAlert className="mt-3">{errorMessage(save.error)}</ErrorAlert>}
    </form>
  );
}

/** Loads one project's list, and restarts the editor whenever the stored list changes. */
function ProjectEditor({ project }: { project: Project }) {
  const pipeline = useQuery(projectPipelineQuery(project.slug));
  const [saved, setSaved] = useState(false);
  if (pipeline.isError) return <ErrorAlert>{errorMessage(pipeline.error)}</ErrorAlert>;
  if (!pipeline.data) return <Skeleton className="h-24" />;
  return (
    <Editor
      key={JSON.stringify(pipeline.data)}
      slug={project.slug}
      name={project.name}
      initial={pipeline.data}
      saved={saved}
      onSaved={setSaved}
    />
  );
}

/**
 * Admin only (the server refuses everyone else): the ordered phases a project's features move
 * through. Renaming keeps tickets on the phase; removing a phase that anything uses is refused.
 */
export function PipelineSettings() {
  const projects = useQuery(projectsQuery);
  const [slug, setSlug] = useState('');
  const selectId = useId();
  const list = projects.data ?? [];
  const project = list.find((p) => p.slug === slug) ?? list[0];

  return (
    <section aria-labelledby="admin-pipelines" className="mt-6">
      <h2 id="admin-pipelines" className="m-0 mb-1 text-[15px] font-semibold">
        Feature pipelines
      </h2>
      {projects.isError && <ErrorAlert>{errorMessage(projects.error)}</ErrorAlert>}
      {projects.isPending && <Skeleton className="h-24" />}
      {project && (
        <>
          <div className="mb-3 max-w-xs">
            <label htmlFor={selectId} className="mb-1 block text-xs text-dim">
              Project
            </label>
            <Select id={selectId} value={project.slug} onChange={(e) => setSlug(e.target.value)}>
              {list.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <ProjectEditor key={project.slug} project={project} />
        </>
      )}
    </section>
  );
}
