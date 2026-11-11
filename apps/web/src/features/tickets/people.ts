import type { Ticket } from '@officepm/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ComboOption } from '@/components/ui/combobox';
import { useUser } from '@/features/auth/user-context';
import { personName } from '@/lib/format';
import { usersQuery } from './api';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** For the assignee pickers: accepts a typed email that is not in the list yet. */
export function parseEmail(text: string): ComboOption | null {
  const value = text.trim();
  return EMAIL.test(value) ? { value, label: value } : null;
}

/**
 * The people a ticket can be given to. The server's user list is admin-only, so
 * for everyone else this is: the signed-in person, plus whoever already appears
 * as an assignee or QA owner on the tickets in hand. An admin also gets every
 * user. A teammate who is on none of those can still be added by typing their email.
 */
export function usePeople(tickets: readonly Ticket[] | undefined): ComboOption[] {
  const me = useUser();
  const admin = useQuery({ ...usersQuery, enabled: me.isAdmin });

  return useMemo(() => {
    const byEmail = new Map<string, ComboOption>();
    const add = (value: string | null | undefined, label?: string) => {
      if (!value || byEmail.has(value)) return;
      byEmail.set(value, { value, label: label || personName(value), hint: value });
    };
    add(me.email, me.name);
    for (const u of admin.data ?? []) add(u.email, u.name);
    for (const t of tickets ?? []) {
      add(t.assignee);
      add(t.qa_owner);
    }
    return [...byEmail.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [me.email, me.name, admin.data, tickets]);
}
