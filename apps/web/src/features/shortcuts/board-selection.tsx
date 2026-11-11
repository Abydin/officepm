import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';

interface BoardSelection {
  /** The ticket the J/K shortcuts have highlighted on this page, if any. */
  selectedKey: string | null;
  select: (key: string | null) => void;
  /** The board publishes its cards in on-screen order, so J and K know what to walk. */
  keysRef: React.RefObject<string[]>;
}

const Context = createContext<BoardSelection | null>(null);

export function BoardSelectionProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // A highlight belongs to one page: remember where it was set, ignore it elsewhere.
  const [picked, setPicked] = useState<{ pathname: string; key: string | null }>({
    pathname: '',
    key: null,
  });
  const keysRef = useRef<string[]>([]);
  const value = useMemo<BoardSelection>(
    () => ({
      selectedKey: picked.pathname === pathname ? picked.key : null,
      select: (key) => setPicked({ pathname, key }),
      keysRef,
    }),
    [picked, pathname],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBoardSelection(): BoardSelection {
  const value = useContext(Context);
  if (!value) throw new Error('useBoardSelection must be used inside BoardSelectionProvider');
  return value;
}
