import { createHashRouter, createMemoryRouter, Navigate, type RouteObject } from 'react-router';
import { LoginPage } from '@/features/auth/login-page';
import { MyTicketsPage } from '@/features/mine/my-tickets-page';
import { OverviewPage } from '@/features/overview/overview-page';
import { BoardFrame } from '@/features/projects/board-frame';
import { BoardView } from '@/features/projects/board-view';
import { ProjectPage } from '@/features/projects/project-page';
import { ProjectsPage } from '@/features/projects/projects-page';
import { TicketRedirect } from '@/features/tickets/ticket-redirect';
import { RequireAuth } from './auth-gate';
import { AppShell } from './layout/app-shell';
import { RouteError } from './route-error';

/**
 * The route table. The secondary screens (admin, docs, epics, retros, standup,
 * backlog and the phase views) load on first visit with the router's `lazy`, as
 * separate files under /assets, so the first paint ships only what the landing
 * screens need. Hash routing (`#/overview`) because the v2 server has no
 * history-API fallback for deep links. To add a page, add a feature under
 * src/features and one entry here.
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
          {
            path: 'projects/:slug/docs',
            lazy: () =>
              import('@/features/docs/docs-page').then((m) => ({ Component: m.DocsPage })),
          },
          {
            path: 'admin',
            lazy: () =>
              import('@/features/admin/admin-page').then((m) => ({ Component: m.AdminPage })),
          },
          {
            path: 'projects/:slug/boards/:board',
            element: <BoardFrame />,
            children: [
              { index: true, element: <BoardView /> },
              {
                path: 'backlog',
                lazy: () =>
                  import('@/features/sprints/timebox-view').then((m) => ({
                    Component: m.TimeboxView,
                  })),
              },
              {
                path: 'epics',
                lazy: () =>
                  import('@/features/epics/epics-page').then((m) => ({ Component: m.EpicsPage })),
              },
              {
                path: 'retros',
                lazy: () =>
                  import('@/features/retros/retros-page').then((m) => ({
                    Component: m.RetrosPage,
                  })),
              },
              {
                path: 'retros/:retroId',
                lazy: () =>
                  import('@/features/retros/retro-detail-page').then((m) => ({
                    Component: m.RetroDetailPage,
                  })),
              },
              {
                path: 'standup',
                lazy: () =>
                  import('@/features/standup/standup-page').then((m) => ({
                    Component: m.StandupPage,
                  })),
              },
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
