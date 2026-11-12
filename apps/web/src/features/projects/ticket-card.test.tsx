import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { designBoard, makeTicket } from '@/test/fixtures';
import { CardFace } from './ticket-card';

const person = (id: number, name: string, role: string | null = null) => ({
  id,
  name,
  department: null,
  role,
});

describe('CardFace participants', () => {
  it('shows no stack when nobody else is on the ticket', () => {
    render(<CardFace ticket={makeTicket()} board={designBoard} />);
    expect(screen.queryByTestId('participants')).toBeNull();
  });

  it('shows their initials, named for assistive technology', () => {
    const ticket = makeTicket({
      participants: [person(1, 'Maya Okafor', 'PM'), person(2, 'Sam Adeyemi')],
    });
    render(<CardFace ticket={ticket} board={designBoard} />);
    const stack = within(screen.getByTestId('participants'));
    expect(stack.getByRole('img', { name: 'Maya Okafor' })).toHaveTextContent('MO');
    expect(stack.getByRole('img', { name: 'Sam Adeyemi' })).toHaveTextContent('SA');
    expect(stack.queryByText(/^\+/)).toBeNull();
  });

  it('caps the stack at three and counts the rest', () => {
    const ticket = makeTicket({
      participants: ['Ann One', 'Bo Two', 'Cy Three', 'Di Four', 'Ed Five'].map((n, i) =>
        person(i + 1, n),
      ),
    });
    render(<CardFace ticket={ticket} board={designBoard} />);
    const stack = within(screen.getByTestId('participants'));
    expect(stack.getAllByRole('img')).toHaveLength(4);
    expect(stack.getByRole('img', { name: 'and 2 more' })).toHaveTextContent('+2');
    expect(stack.queryByRole('img', { name: 'Di Four' })).toBeNull();
  });
});

describe('CardFace sub-tickets', () => {
  it('shows done over total on a parent, and nothing when there are no sub-tickets', () => {
    const { rerender } = render(
      <CardFace ticket={makeTicket({ progress: { done: 3, total: 5 } })} board={designBoard} />,
    );
    expect(screen.getByTitle('Sub-tickets done')).toHaveTextContent('Sub-tickets done 3/5');
    rerender(
      <CardFace ticket={makeTicket({ progress: { done: 0, total: 0 } })} board={designBoard} />,
    );
    expect(screen.queryByTitle('Sub-tickets done')).toBeNull();
  });

  it('marks a sub-ticket with its parent key, as plain text so the card holds no nested control', () => {
    render(<CardFace ticket={makeTicket({ subticket_of: 'FOOD-DES-9' })} board={designBoard} />);
    expect(screen.getByText(/sub of/)).toHaveTextContent('sub of FOOD-DES-9');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
