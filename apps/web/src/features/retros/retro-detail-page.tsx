import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { RETRO_COLUMNS, type RetroCard } from '@officepm/shared';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoardFrame } from '@/features/projects/board-frame-context';
import { errorMessage } from '@/lib/api';
import { retroQuery, useAddRetroCard } from './api';

const COLUMN_TITLE: Record<(typeof RETRO_COLUMNS)[number], string> = {
  well: 'Went well',
  didnt: "Didn't go well",
  actions: 'Action items',
};

function RetroColumn({
  retroId,
  column,
  cards,
}: {
  retroId: string;
  column: (typeof RETRO_COLUMNS)[number];
  cards: RetroCard[];
}) {
  const add = useAddRetroCard(retroId);
  const [body, setBody] = useState('');
  const title = COLUMN_TITLE[column];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || add.isPending) return;
    add.mutate({ column, body: text }, { onSuccess: () => setBody('') });
  };

  return (
    <Card aria-label={title}>
      <h2 className="m-0 mb-3 text-[15px] font-semibold">{title}</h2>
      <ul className="m-0 mb-3 list-none space-y-2 p-0">
        {cards.map((card) => (
          <li key={card.id} className="rounded-md border border-line bg-bg p-2.5">
            <div className="break-words whitespace-pre-wrap">{card.body}</div>
            <div className="mt-1 text-xs text-dim">{card.author}</div>
          </li>
        ))}
        {cards.length === 0 && <li className="text-dim">No cards yet</li>}
      </ul>
      <form onSubmit={submit} className="flex gap-2">
        <Input
          aria-label={`Add a card to ${title}`}
          placeholder="Add a card..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={!body.trim() || add.isPending}>
          Add card
        </Button>
      </form>
      {add.isError && <ErrorAlert className="mt-2">{errorMessage(add.error)}</ErrorAlert>}
    </Card>
  );
}

/** One retro: went well, did not, and action items, with a box to add a card to each. */
export function RetroDetailPage() {
  const { retroId = '' } = useParams();
  const { projectSlug, board } = useBoardFrame();
  const retro = useQuery(retroQuery(retroId));

  const back = (
    <Link to={`/projects/${projectSlug}/boards/${board.slug}/retros`} className="text-accent">
      All retros
    </Link>
  );

  if (retro.isError) {
    return (
      <>
        <ErrorAlert className="mb-3">{errorMessage(retro.error)}</ErrorAlert>
        {back}
      </>
    );
  }
  if (!retro.data) {
    return (
      <div role="status" aria-label="Loading retro" className="space-y-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <>
      <p className="mt-0 mb-2">{back}</p>
      <h2 className="m-0 mb-4 text-lg font-semibold">{retro.data.name}</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {RETRO_COLUMNS.map((column) => (
          <RetroColumn
            key={column}
            retroId={retroId}
            column={column}
            cards={retro.data.cards.filter((c) => c.column_name === column)}
          />
        ))}
      </div>
    </>
  );
}
