import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useMatch, useNavigate } from 'react-router';
import type { ProjectList } from '@officepm/shared';
import { useUser } from '@/features/auth/user-context';
import { boardTabs, type BoardTabId } from '@/features/projects/board-tabs';
import { useAssignTicket } from '@/features/tickets/api';
import { useTicketDrawer } from '@/features/tickets/use-ticket-drawer';
import { qk } from '@/lib/api';
import { useBoardSelection } from './board-selection';

/** How long after G a second key still counts as a chord. */
const CHORD_MS = 900;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

interface ShortcutActions {
  openPalette: (page?: 'root' | 'create') => void;
  openHelp: () => void;
  paletteOpen: boolean;
}

/**
 * v1's keyboard shortcuts, in one document-level handler: Ctrl/Cmd+K and /
 * (palette), ? (help), C, the G chords, and J/K/Enter/E/A over the board's
 * cards. Single-letter keys do nothing while typing or while any dialog is open.
 */
export function useShortcuts({ openPalette, openHelp, paletteOpen }: ShortcutActions) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useUser();
  const drawer = useTicketDrawer();
  const selection = useBoardSelection();
  const assign = useAssignTicket();
  const match = useMatch('/projects/:slug/boards/:board/*');
  const gPressedAt = useRef(0);

  // The handler is installed once; it reads the latest values through this ref.
  const latest = useRef({
    drawer,
    selection,
    match,
    me,
    assign,
    openPalette,
    openHelp,
    paletteOpen,
  });
  useEffect(() => {
    latest.current = { drawer, selection, match, me, assign, openPalette, openHelp, paletteOpen };
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = latest.current;
      if (e.defaultPrevented) return;

      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!s.paletteOpen) s.openPalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || document.querySelector('[role="dialog"]')) return;

      const key = e.key.toLowerCase();

      if (e.key === '?') {
        e.preventDefault();
        s.openHelp();
        return;
      }
      if (e.shiftKey) return;
      if (e.key === '/') {
        e.preventDefault();
        s.openPalette();
        return;
      }

      const chordOpen = Date.now() - gPressedAt.current < CHORD_MS;
      if (key === 'g') {
        gPressedAt.current = Date.now();
        return;
      }
      if (chordOpen) {
        gPressedAt.current = 0;
        const board = s.match?.params;
        if (!board?.slug || !board.board) return;
        const base = `/projects/${board.slug}/boards/${board.board}`;
        if (key === 'b') void navigate(base);
        const tab: BoardTabId | null = key === 's' ? 'backlog' : key === 'r' ? 'retros' : null;
        if (tab) {
          const projects = queryClient.getQueryData<ProjectList>(qk.projects.list());
          const found = projects
            ?.find((p) => p.slug === board.slug)
            ?.boards.find((b) => b.slug === board.board);
          const target = found && boardTabs(found).find((t) => t.id === tab);
          if (target) void navigate(`${base}/${target.path}`);
        }
        return;
      }

      if (key === 'c') {
        if (s.match) {
          document.getElementById('quick-add')?.focus();
          e.preventDefault();
        } else {
          s.openPalette('create');
        }
        return;
      }

      const keys = s.selection.keysRef.current;
      const index = s.selection.selectedKey ? keys.indexOf(s.selection.selectedKey) : -1;
      if (key === 'j' || key === 'k') {
        if (keys.length === 0) return;
        e.preventDefault();
        const next = key === 'j' ? Math.min(index + 1, keys.length - 1) : Math.max(index - 1, 0);
        s.selection.select(keys[next] ?? null);
        return;
      }

      const target = s.drawer.openKey ?? s.selection.selectedKey;
      if (!target) return;
      // Enter on a focused button or link belongs to that control, not to this shortcut.
      if (e.key === 'Enter' && e.target === document.body) {
        e.preventDefault();
        s.drawer.open(target);
      } else if (key === 'e') {
        e.preventDefault();
        s.drawer.open(target, { focusTitle: true });
      } else if (key === 'a') {
        e.preventDefault();
        s.assign.mutate({ key: target, assignee: s.me.email });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigate, queryClient]);
}
