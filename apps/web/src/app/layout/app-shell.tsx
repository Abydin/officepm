import { useState } from 'react';
import { Outlet } from 'react-router';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useEventStream } from '@/features/events/use-event-stream';
import { SidebarNav } from './sidebar-nav';
import { Topbar } from './topbar';

/** Signed-in layout: top bar, project sidebar (a slide-in sheet on phones), and the routed page. */
export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  useEventStream();

  return (
    <div className="flex h-full flex-col">
      <a
        href="#main"
        onClick={(e) => {
          // The app uses hash routes, so a plain "#main" link would navigate the router.
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-1.5 focus:text-accent-ink"
      >
        Skip to content
      </a>
      <Topbar onOpenNav={() => setNavOpen(true)} />
      <div className="relative flex min-h-0 flex-1">
        <aside className="hidden w-54 shrink-0 overflow-y-auto border-r border-line bg-raised md:block">
          <SidebarNav />
        </aside>
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent aria-describedby="nav-desc">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription id="nav-desc" className="sr-only">
              Projects and boards
            </SheetDescription>
            <SidebarNav onNavigate={() => setNavOpen(false)} />
          </SheetContent>
        </Sheet>
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 overflow-y-auto p-4 focus:outline-none md:p-6"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
