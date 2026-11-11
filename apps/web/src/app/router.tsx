import { createHashRouter, createMemoryRouter, Navigate, type RouteObject } from 'react-router';
import { AdminPage } from '@/features/admin/admin-page';
import { LoginPage } from '@/features/auth/login-page';
import { MyTicketsPage } from '@/features/mine/my-tickets-page';
import { OverviewPage } from '@/features/overview/overview-page';
import { DocsPage } from '@/features/docs/docs-page';
import { EpicsPage } from '@/features/epics/epics-page';
import { BoardFrame } from '@/features/projects/board-frame';
import { BoardView } from '@/features/projects/board-view';
import { ProjectPage } from '@/features/projects/project-page';
import { ProjectsPage } from '@/features/projects/projects-page';
import { RetroDetailPage } from '@/features/retros/retro-detail-page';
import { RetrosPage } from '@/features/retros/retros-page';
import { StandupPage } from '@/features/standup/standup-page';
import { TimeboxView } from '@/features/sprints/timebox-view';
import { TicketRedirect } from '@/features/tickets/ticket-redirect';
import { RequireAuth } from './auth-gate';
import { AppShell } from './layout/app-shell';
import { RouteError } from './route-error';

/**
 * The route table. Hash routing (`#/overview`) because the v2 server serves the
 * client from `/` only: no history-API fallback exists for deep links. To add a
 * page, add a feature under src/features and one entry here.
 */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/overview" replace /> },
          { path: 'overview', element: <OverviewPage /> },
          { path: 'mine', element: <MyTicketsPage /> },
          { path: 't/:key', element: <TicketRedirect /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: 'projects/:slug', element: <ProjectPage /> },
          { path: 'projects/:slug/docs', element: <DocsPage /> },
          { path: 'admin', element: <AdminPage /> },
          {
            path: 'projects/:slug/boards/:board',
            element: <BoardFrame />,
            children: [
              { index: true, element: <BoardView /> },
              { path: 'backlog', element: <TimeboxView /> },
              { path: 'epics', element: <EpicsPage /> },
              { path: 'retros', element: <RetrosPage /> },
              { path: 'retros/:retroId', element: <RetroDetailPage /> },
              { path: 'standup', element: <StandupPage /> },
            ],
          },
          { path: '*', element: <RouteError /> },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createHashRouter(routes);
export const createTestRouter = (initialEntries: string[]) =>
  createMemoryRouter(routes, { initialEntries });
