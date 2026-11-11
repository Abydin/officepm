import { statusColor } from '@/lib/format';

export function StatusDot({ status }: { status: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ background: statusColor(status) }}
    />
  );
}
