import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

interface DrawerState {
  /** True when this history entry was pushed by opening the drawer, so closing can step back. */
  drawer?: boolean;
  /** Opened with the E shortcut: put the caret in the title. */
  focusTitle?: boolean;
}

/**
 * The ticket drawer lives in the URL as `?t=KEY` on whatever page is showing, so
 * a ticket can be linked to and survives a reload while the page behind it stays
 * mounted. (`#/t/KEY` is the short form: it redirects to the ticket's board.)
 * Opening pushes a history entry, so Back closes the drawer; opening another
 * ticket while one is open replaces it instead of stacking.
 */
export function useTicketDrawer() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? {}) as DrawerState;
  const openKey = new URLSearchParams(location.search).get('t');

  const open = useCallback(
    (key: string, options: { focusTitle?: boolean } = {}) => {
      const search = new URLSearchParams(location.search);
      const wasOpen = search.has('t');
      search.set('t', key);
      void navigate(
        { search: search.toString() },
        {
          replace: wasOpen,
          state: {
            drawer: wasOpen ? (location.state as DrawerState | null)?.drawer : true,
            focusTitle: options.focusTitle ?? false,
          } satisfies DrawerState,
        },
      );
    },
    [location.search, location.state, navigate],
  );

  const close = useCallback(() => {
    if (state.drawer) {
      void navigate(-1);
      return;
    }
    const search = new URLSearchParams(location.search);
    search.delete('t');
    void navigate({ search: search.toString() }, { replace: true });
  }, [location.search, navigate, state.drawer]);

  return { openKey, focusTitle: state.focusTitle === true, open, close };
}
