import {
  pointerWithin,
  rectIntersection,
  type Announcements,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';

/** Mouse and touch drop where the pointer is; the keyboard has no pointer, so it falls back to overlap. */
export const detectColumn: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

/**
 * Keyboard dragging between columns. dnd-kit's default moves 25px per key press,
 * which does not reliably cross a column. Left and right jump to the neighbouring
 * column instead; up and down do nothing, because a column has no order.
 */
export const columnCoordinateGetter: KeyboardCoordinateGetter = (
  event,
  { context: { droppableRects, droppableContainers, collisionRect } },
) => {
  const dir = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
  if (dir === 0 || !collisionRect) return undefined;
  event.preventDefault();

  const columns = droppableContainers
    .getEnabled()
    .map((c) => droppableRects.get(c.id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .sort((a, b) => a.left - b.left);
  if (columns.length === 0) return undefined;

  const centre = collisionRect.left + collisionRect.width / 2;
  let current = columns.findIndex((c) => centre >= c.left && centre <= c.left + c.width);
  if (current === -1) current = dir === 1 ? -1 : columns.length;
  const target = columns[Math.min(columns.length - 1, Math.max(0, current + dir))];
  if (!target) return undefined;
  return {
    x: target.left + (target.width - collisionRect.width) / 2,
    y: target.top + 8,
  };
};

export const dragInstructions: ScreenReaderInstructions = {
  draggable:
    'To move this ticket with the keyboard, press space to pick it up, the left and right arrow keys to choose a column, and space to drop it. Escape cancels. Press enter to open it instead.',
};

export const dragAnnouncements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${active.id}.`,
  onDragOver: ({ active, over }) =>
    over ? `${active.id} is over ${over.id}.` : `${active.id} is not over a column.`,
  onDragEnd: ({ active, over }) =>
    over ? `Dropped ${active.id} in ${over.id}.` : `${active.id} was dropped outside a column.`,
  onDragCancel: ({ active }) => `Cancelled. ${active.id} did not move.`,
};
