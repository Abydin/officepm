import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { UserProvider } from '@/features/auth/user-context';
import { makeTicket } from '@/test/fixtures';
import { demoUser, stubApi } from '@/test/helpers';
import { usePeople } from './people';

const users = [
  { id: 1, email: demoUser.email, name: 'Maya Okafor', is_admin: 1, created_at: '' },
  { id: 2, email: 'sam@officepm.demo', name: 'Sam Adeyemi', is_admin: 0, created_at: '' },
  {
    id: 3,
    email: 'gone@officepm.demo',
    name: 'Gone Person',
    is_admin: 0,
    created_at: '',
    deactivated_at: '2026-11-01 10:00:00',
  },
  {
    id: 4,
    email: 'gone-too@officepm.demo',
    name: 'Gone Too',
    is_admin: 0,
    created_at: '',
    deactivated_at: '2026-11-01 10:00:00',
  },
];

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient({ queries: { retry: false } })}>
      <UserProvider user={demoUser}>{children}</UserProvider>
    </QueryClientProvider>
  );
}

describe('usePeople and deactivated users', () => {
  it('does not offer a deactivated person, unless a ticket in hand is already theirs', async () => {
    stubApi({ 'GET /api/users': users });
    const tickets = [makeTicket({ assignee: 'gone@officepm.demo' })];
    const { result } = renderHook(() => usePeople(tickets), { wrapper });
    await waitFor(() => expect(result.current.map((p) => p.value)).toContain('sam@officepm.demo'));
    const byValue = Object.fromEntries(result.current.map((p) => [p.value, p.label]));
    expect(byValue['gone@officepm.demo']).toBe('Gone Person (deactivated)');
    expect(byValue).not.toHaveProperty('gone-too@officepm.demo');
    expect(byValue['sam@officepm.demo']).toBe('Sam Adeyemi');
  });
});
