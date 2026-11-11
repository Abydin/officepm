import { createHashRouter, createMemoryRouter, Navigate, type RouteObject } from 'react-router';
import { LoginPage } from '@/features/auth/login-page';
import { MyTicketsPage } from '@/features/mine/my-tickets-page';
import { OverviewPage } from '@/features/overview/overview-page';
import { BoardFrame } from '@/features/projects/board-frame';
import { BoardView } from '@/features/projects/board-view';
import { ViewPlaceholder } from '@/features/projects/board-views';
import { ProjectPage } from '@/features/projects/project-page';
import { ProjectsPage } from '@/features/projects/projects-page';
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
          {
            path: 'projects/:slug/boards/:board',
            element: <BoardFrame />,
            children: [
              { index: true, element: <BoardView /> },
              { path: 'backlog', element: <ViewPlaceholder view="backlog" /> },
              { path: 'epics', element: <ViewPlaceholder view="epics" /> },
              { path: 'retros', element: <ViewPlaceholder view="retros" /> },
              { path: 'standup', element: <ViewPlaceholder view="standup" /> },
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
