import type { Burndown } from '@officepm/shared';
import { shortDate } from '@/lib/format';

const W = 520;
const H = 190;
const L = 30;
const R = 12;
const T = 12;
const B = 24;

/** Inline SVG burndown (PRD 6.9), ported from v1. Scales to its container. */
export function BurndownChart({
  points,
  totalScope,
}: Pick<Burndown, 'points'> & { totalScope: number }) {
  if (points.length < 2) return <p className="text-dim">Not enough data for a burndown yet.</p>;

  const maxY = Math.max(totalScope, 1);
  const xFor = (i: number) => L + (i / (points.length - 1)) * (W - L - R);
  const yFor = (v: number) => T + (1 - v / maxY) * (H - T - B);
  const path = (key: 'ideal' | 'actual') =>
    points
      .map((p, i) => {
        const v = p[key];
        if (v === null) return '';
        const prev = points[i - 1]?.[key];
        return (
          (i === 0 || prev === null || prev === undefined ? 'M' : 'L') +
          xFor(i).toFixed(1) +
          ',' +
          yFor(v).toFixed(1)
        );
      })
      .join(' ');

  const actualIdx = points.flatMap((p, i) => (p.actual !== null ? [i] : []));
  const lastIdx = actualIdx[actualIdx.length - 1];
  const firstIdx = actualIdx[0];
  const last = lastIdx === undefined ? undefined : points[lastIdx];
  const area =
    lastIdx !== undefined && firstIdx !== undefined && actualIdx.length > 1
      ? `${path('actual')} L${xFor(lastIdx).toFixed(1)},${yFor(0)} L${xFor(firstIdx).toFixed(1)},${yFor(0)} Z`
      : '';
  const ticks = [0, 0.5, 1].map((f) => Math.round(maxY * f));
  const first = points[0];
  const end = points[points.length - 1];

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={
          last && last.actual !== null
            ? `Sprint burndown: ${last.actual} of ${totalScope} remaining`
            : 'Sprint burndown'
        }
        className="block h-auto w-full [&_text]:fill-dim [&_text]:text-[10px]"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line className="stroke-line" x1={L} x2={W - R} y1={yFor(v)} y2={yFor(v)} />
            <text x={L - 6} y={yFor(v) + 3} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {area && <path className="fill-accent-soft" d={area} />}
        <path
          className="fill-none stroke-gray stroke-[1.5] [stroke-dasharray:4_4]"
          d={path('ideal')}
        />
        <path
          className="fill-none stroke-accent stroke-[2.25] [stroke-linejoin:round]"
          d={path('actual')}
        />
        {lastIdx !== undefined && last && last.actual !== null && (
          <>
            <line
              className="stroke-dim [stroke-dasharray:2_3]"
              x1={xFor(lastIdx)}
              x2={xFor(lastIdx)}
              y1={T}
              y2={H - B}
            />
            <circle
              cx={xFor(lastIdx)}
              cy={yFor(last.actual)}
              r="4"
              className="fill-accent stroke-raised stroke-2"
            />
          </>
        )}
        {first && (
          <text x={L} y={H - 6}>
            {shortDate(first.date)}
          </text>
        )}
        {end && (
          <text x={W - R} y={H - 6} textAnchor="end">
            {shortDate(end.date)}
          </text>
        )}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-dim">
        <span>
          <i className="mr-1.5 inline-block w-3.5 border-t-2 border-dashed border-gray align-middle" />
          Ideal
        </span>
        <span>
          <i className="mr-1.5 inline-block w-3.5 border-t-2 border-accent align-middle" />
          Actual, taken from each ticket&apos;s last update
        </span>
      </div>
    </>
  );
}
