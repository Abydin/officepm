import { StatusDot } from './status-dot';

export function StatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <StatusDot status={status} />
      {status}
    </span>
  );
}
