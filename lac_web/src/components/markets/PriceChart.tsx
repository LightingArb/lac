import { useState } from 'react';
import type { MarketEvent } from '../../data/catalog';
import { chance } from '../../lib/format';
import { priceSeries } from '../../lib/series';
import { useLive, type History } from '../../lib/live';
import { SegmentedControl } from '../ui/SegmentedControl';
import styles from './PriceChart.module.css';

type Range = '1H' | '6H' | '1D' | '1W' | '1M' | 'ALL';

const RANGES: { value: Range; label: string }[] = [
  { value: '1H', label: '1H' },
  { value: '6H', label: '6H' },
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: 'ALL', label: 'All' },
];

/** How many of the 96 history points each range shows. */
const RANGE_POINTS: Record<Range, number> = { '1H': 12, '6H': 24, '1D': 40, '1W': 64, '1M': 80, ALL: 96 };

const X_LABELS: Record<Exclude<Range, 'ALL'>, string[]> = {
  '1H': ['60m ago', '40m', '20m', 'Now'],
  '6H': ['6h ago', '4h', '2h', 'Now'],
  '1D': ['24h ago', '16h', '8h', 'Now'],
  '1W': ['7d ago', '5d', '2d', 'Now'],
  '1M': ['30d ago', '20d', '10d', 'Now'],
};

const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const GRID_LINES = [0, 50, 100, 150];
const Y_LABELS = ['100%', '75%', '50%', '25%', '0%'];

interface Line {
  label: string;
  points: number[];
  end: number | null;
  times?: number[];
  color: string;
}

function chartLines(event: MarketEvent): Line[] {
  if (event.kind === 'multi') {
    return [...event.rows]
      .sort((a, b) => (b.yes ?? -1) - (a.yes ?? -1))
      .slice(0, SERIES_COLORS.length)
      .map((r, i) => ({
        label: r.label,
        points: priceSeries(`${event.id}/${r.id}`, r.yes!),
        end: r.yes,
        color: SERIES_COLORS[i],
      }));
  }
  const row = event.rows[0];
  const yes = priceSeries(`${event.id}/${row.id}`, row.yes!);
  return [
    { label: event.yesLabel ?? 'Yes', points: yes, end: row.yes, color: SERIES_COLORS[0] },
    { label: event.noLabel ?? 'No', points: yes.map((v) => 1 - v), end: row.no, color: SERIES_COLORS[1] },
  ];
}

/** Polyline points in a 100×100 box: x is time, y is price (top = 100%). */
function toPolyline(points: number[]): string {
  const last = points.length - 1;
  return points.map((v, i) => `${((i / last) * 100).toFixed(2)},${((1 - v) * 100).toFixed(2)}`).join(' ');
}

export function PriceChart({ event }: { event: MarketEvent }) {
  const [range, setRange] = useState<Range>('ALL');
  const live = event.source === 'live';
  const series =
    event.kind === 'multi'
      ? event.rows.map((row) => ({ id: row.yesAsset, label: row.label, value: row.yes }))
      : [
          { id: event.rows[0]?.yesAsset, label: event.yesLabel ?? 'Yes', value: event.rows[0]?.yes ?? null },
          { id: event.rows[0]?.noAsset, label: event.noLabel ?? 'No', value: event.rows[0]?.no ?? null },
        ];
  const ids = series.flatMap((item) => (item.id ? [item.id] : []));
  const history = useLive<{ histories: Record<string, History> }>(
    live && ids.length ? `/api/live/history?ids=${ids.join(',')}` : null,
  );
  const windows = Object.values(history.data?.histories ?? {}).flatMap((item) =>
    item.coverage ? [item.coverage] : [],
  );
  const endAt = Math.max(0, ...windows.map((item) => Date.parse(item.requested_end)));
  const availableStart = Math.min(endAt, ...windows.map((item) => Date.parse(item.requested_start)));
  const durations = { '1H': 3600000, '6H': 21600000, '1D': 86400000, '1W': 604800000, '1M': 2592000000, ALL: Infinity };
  const startAt = Math.max(availableStart, endAt - durations[range]);
  const lines: Line[] = live
    ? series.map((item, i) => {
        const points = (item.id ? (history.data?.histories[item.id]?.points ?? []) : []).filter(
          (point) => Date.parse(point.minute_at) >= startAt,
        );
        return {
          label: item.label,
          end: item.value,
          color: i < SERIES_COLORS.length ? SERIES_COLORS[i] : `hsl(${(i * 137.508) % 360} 65% 40%)`,
          points: points.map((point) => Number(point.price)),
          times: points.map((point) => Date.parse(point.minute_at)),
        };
      })
    : chartLines(event);
  const n = RANGE_POINTS[range];
  const stamp = (ms: number) =>
    new Date(ms).toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const xLabels = live
    ? endAt
      ? [stamp(startAt), '', '', `${stamp(endAt)} UTC`]
      : ['—', '', '', '—']
    : range === 'ALL'
      ? [event.open, '', '', 'Now']
      : X_LABELS[range];

  return (
    <div className={styles.chart}>
      <div className={styles.toolbar}>
        <SegmentedControl label="Chart range" options={RANGES} value={range} onChange={setRange} size="sm" />
        <div className={styles.legend}>
          {lines.map((line, index) => (
            <span key={`${index}:${line.label}`} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: line.color }} />
              <span>{line.label}</span>
              <span className={styles.legendValue}>{chance(line.end)}</span>
            </span>
          ))}
        </div>
      </div>
      <div className={styles.body}>
        <div role="img" aria-label={`Price history for ${event.title}`} className={styles.plot}>
          {GRID_LINES.map((top) => (
            <span key={top} className={styles.gridLine} style={{ top }} />
          ))}
          <span className={`${styles.gridLine} ${styles.baseline}`} />
          {live && !lines.some((line) => line.points.length) && (
            <span className={styles.empty}>
              {history.error ??
                (history.data || !ids.length ? 'No historical data for this range' : 'Loading history…')}
            </span>
          )}
          {lines.map((line, index) => (
            <svg
              key={`${index}:${line.label}`}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              className={styles.line}
            >
              {live ? (
                <path
                  d={line.points
                    .map(
                      (point, i) =>
                        `${i === 0 || line.times![i] - line.times![i - 1] > 90000 ? 'M' : 'L'}${((line.times![i] - startAt) / Math.max(1, endAt - startAt)) * 100},${(1 - point) * 100}`,
                    )
                    .join(' ')}
                  fill="none"
                  style={{ stroke: line.color }}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <polyline
                  points={toPolyline(line.points.slice(-n))}
                  fill="none"
                  style={{ stroke: line.color }}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
          ))}
        </div>
        <div className={styles.yAxis} aria-hidden="true">
          {Y_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
      <div className={styles.xAxis} aria-hidden="true">
        {xLabels.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
      {live && endAt > 0 && (
        <span className={styles.note}>
          History snapshot · {stamp(availableStart)} – {stamp(endAt)} UTC · gaps are left empty.
        </span>
      )}
    </div>
  );
}
