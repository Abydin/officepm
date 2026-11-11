import type { ActivityItem, Dashboard } from '@officepm/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Avatar } from '@/components/avatar';
import { PriorityMark } from '@/components/priority-mark';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorAlert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { dayDiff, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { dashboardQuery } from './api';
import { BurndownChart } from './burndown-chart';
import { VelocityBars } from './velocity-bars';

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'ok' | 'warn' }) {
  return (
    <Card className="px-4 py-3">
      <div
        className={cn(
          'text-[30px] leading-[1.1] font-bold tracking-[-0.02em]',
          tone === 'ok' && 'text-ok',
          tone === 'warn' && 'text-err',
        )}
      >
        {n}
      </div>
      <div className="mt-0.5 text-xs text-dim">{label}</div>
    </Card>
  );
}

function ActivityLine({ item }: { item: ActivityItem }) {
  if (item.kind === 'comment') {
    return (
      <span className="min-w-0 flex-1">
        <b>{item.system ? 'GitHub' : item.who}</b> {item.system ? 'posted on' : 'commented on'}{' '}
        <span className="font-mono">{item.key}</span>
        <span className="block truncate text-dim">{item.text}</span>
      </span>
    );
  }
  return (
    <span className="min-w-0 flex-1">
      <span className="font-mono">{item.key}</span> is now <b>{item.text}</b>
      <span className="block truncate text-dim">{item.title}</span>
    </span>
  );
}

function DashboardBody({ data }: { data: Dashboard }) {
  const { totals: t, sprint: sp } = data;
  const lastActual =
    sp?.burndown && !sp.burndown.insufficient_dates
      ? sp.burndown.points.filter((p) => p.actual !== null).pop()
      : undefined;
  const unit = sp?.velocity.uses_points ? 'pts' : 'tickets';
  const daysLeft = sp?.end_date ? Math.max(0, dayDiff(sp.end_date)) : 0;
  const empty = data.boards.every((b) => b.total === 0);
  const flagged = t.blocked + t.overdue;

  return (
    <>
      {empty && (
        <EmptyState title="Nothing here yet" className="mb-4">
          Create a ticket on any board to get started.
        </EmptyState>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat n={t.open} label="Open" />
        <Stat n={t.in_progress} label="In progress" />
        <Stat n={t.done_7d} label="Finished in the last 7 days" tone="ok" />
        <Stat
          n={flagged}
          label={`${t.blocked} blocked, ${t.overdue} overdue`}
          tone={flagged ? 'warn' : undefined}
        />
      </div>

      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card aria-label="Active sprint">
            <CardHeader>
              <CardTitle>{sp ? sp.name : 'Sprint burndown'}</CardTitle>
              {sp && (
                <Link
                  to={`/projects/${sp.project_slug}/boards/${sp.board_slug}/backlog`}
                  className="text-accent"
                >
                  {sp.project} · {sp.board}
                </Link>
              )}
            </CardHeader>
            {!sp ? (
              <EmptyState title="No active sprint">
                Activate a sprint from a Scrum board&apos;s Backlog to see its burndown here.
              </EmptyState>
            ) : lastActual && sp.burndown && lastActual.actual !== null ? (
              <>
                <div className="mb-2 flex flex-wrap gap-6">
                  <SprintFact value={`${lastActual.actual} ${unit}`} label="Remaining" />
                  <SprintFact
                    value={`${sp.burndown.total_scope - lastActual.actual} of ${sp.burndown.total_scope}`}
                    label="Done"
                  />
                  <SprintFact
                    value={`${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`}
                    label="Left"
                  />
                </div>
                <BurndownChart points={sp.burndown.points} totalScope={sp.burndown.total_scope} />
              </>
            ) : (
              <p className="text-dim">Set a start and end date on this sprint to see a burndown.</p>
            )}
          </Card>
          {sp && (
            <Card aria-label="Velocity">
              <CardHeader>
                <CardTitle>Velocity</CardTitle>
                <span className="text-xs text-dim">{sp.board}</span>
              </CardHeader>
              <VelocityBars velocity={sp.velocity} />
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card aria-label="Needs me">
            <CardHeader>
              <CardTitle>Needs me</CardTitle>
            </CardHeader>
            {data.needs_me.length === 0 ? (
              <EmptyState title="You are clear">Nothing open is assigned to you.</EmptyState>
            ) : (
              <ul className="m-0 list-none p-0">
                {data.needs_me.map((n) => (
                  <li key={n.key}>
                    <Link
                      to={`/projects/${n.project_slug}/boards/${n.board_slug}`}
                      className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2 text-fg no-underline hover:bg-hover"
                    >
                      <PriorityMark priority={n.priority} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-mono text-[11px] text-dim">{n.key}</span> {n.title}
                      </span>
                      {n.blocked && <Flag tone="red">Blocked</Flag>}
                      {n.overdue && <Flag tone="amber">Overdue</Flag>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card aria-label="Recent activity">
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            {data.activity.length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              <ul className="m-0 list-none p-0">
                {data.activity.map((a, i) => (
                  <li
                    key={`${a.key}-${a.at}-${i}`}
                    className="flex gap-2 border-b border-line py-2 text-[13px] last:border-b-0"
                  >
                    <Avatar who={a.system ? 'GitHub' : a.who} />
                    <ActivityLine item={a} />
                    <span className="text-[11px] whitespace-nowrap text-dim">{timeAgo(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <h2 className="mt-8 mb-3 text-[15px] font-semibold">Boards</h2>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3 p-0">
        {data.boards.map((b) => {
          const pct = (n: number) => (b.total ? (n / b.total) * 100 : 0);
          return (
            <li key={b.project_slug + b.board_slug}>
              <Link
                to={`/projects/${b.project_slug}/boards/${b.board_slug}`}
                className="block h-full rounded-lg border border-line bg-raised p-4 text-fg no-underline transition-[border-color,transform] hover:-translate-y-px hover:border-line-strong"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] tracking-[0.06em] text-dim uppercase">
                    {b.project}
                  </span>
                  <Badge>{b.flow}</Badge>
                </div>
                <strong className="mt-1 mb-2.5 block">{b.board}</strong>
                <div
                  role="img"
                  aria-label={`${b.done} of ${b.total} done`}
                  className="flex h-1.5 overflow-hidden rounded-[3px] bg-line"
                >
                  <div className="h-full bg-ok" style={{ width: `${pct(b.done)}%` }} />
                  <div className="h-full bg-info" style={{ width: `${pct(b.in_progress)}%` }} />
                </div>
                <div className="mt-2 flex gap-3 text-xs text-dim">
                  <span>
                    <b className="font-semibold text-fg">{b.open}</b> open
                  </span>
                  <span>
                    <b className="font-semibold text-fg">{b.in_progress}</b> active
                  </span>
                  <span>
                    <b className="font-semibold text-fg">{b.done}</b> done
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function SprintFact({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <b className="text-lg tracking-[-0.01em]">{value}</b>
      <span className="block text-[11px] tracking-[0.05em] text-dim uppercase">{label}</span>
    </div>
  );
}

function Flag({ tone, children }: { tone: 'red' | 'amber'; children: string }) {
  return (
    <span
      className={cn(
        'rounded-sm px-1.5 text-[11px] leading-[18px] font-semibold',
        tone === 'red' ? 'bg-err-soft text-err' : 'bg-warn-soft text-warn',
      )}
    >
      {children}
    </span>
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading the dashboard">
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[78px]" />
        ))}
      </div>
      <Skeleton className="h-[260px]" />
    </div>
  );
}

export function OverviewPage() {
  const dashboard = useQuery(dashboardQuery);
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <>
      <header className="mb-6">
        <div className="mb-0.5 text-xs tracking-[0.08em] text-dim uppercase">{today}</div>
        <h1 className="m-0 text-[22px] font-semibold">Overview</h1>
      </header>
      {dashboard.isPending && <DashboardSkeleton />}
      {dashboard.isError && (
        <ErrorAlert>Could not load the dashboard. {errorMessage(dashboard.error)}</ErrorAlert>
      )}
      {dashboard.data && <DashboardBody data={dashboard.data} />}
    </>
  );
}
