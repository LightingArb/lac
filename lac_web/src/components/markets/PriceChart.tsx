import { useState } from 'react';
import type { MarketEvent } from '../../data/catalog';
import { chance } from '../../lib/format';
import { priceSeries } from '../../lib/series';
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
  end: number;
  color: string;
}

function chartLines(event: MarketEvent): Line[] {
  if (event.kind === 'multi') {
    return [...event.rows]
      .sort((a, b) => b.yes - a.yes)
      .slice(0, SERIES_COLORS.length)
      .map((r, i) => ({ label: r.label, points: priceSeries(`${event.id}/${r.id}`, r.yes), end: r.yes, color: SERIES_COLORS[i] }));
  }
  const row = event.rows[0];
  const yes = priceSeries(`${event.id}/${row.id}`, row.yes);
  return [
    { label: event.yesLabel ?? 'Yes', points: yes, end: row.yes, color: SERIES_COLORS[0] },
    { label: event.noLabel ?? 'No', points: yes.map((v) => 1 - v), end: 1 - row.yes, color: SERIES_COLORS[1] },
  ];
}

/** Polyline points in a 100×100 box: x is time, y is price (top = 100%). */
function toPolyline(points: number[]): string {
  const last = points.length - 1;
  return points.map((v, i) => `${((i / last) * 100).toFixed(2)},${((1 - v) * 100).toFixed(2)}`).join(' ');
}

export function PriceChart({ event }: { event: MarketEvent }) {
  const [range, setRange] = useState<Range>('ALL');
  const lines = chartLines(event);
  const n = RANGE_POINTS[range];
  const xLabels = range === 'ALL' ? [event.open, '', '', 'Now'] : X_LABELS[range];

  return (
    <div className={styles.chart}>
      <div className={styles.toolbar}>
        <SegmentedControl label="Chart range" options={RANGES} value={range} onChange={setRange} size="sm" />
        <div className={styles.legend}>
          {lines.map((line) => (
            <span key={line.label} className={styles.legendItem}>
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
          {lines.map((line) => (
            <svg key={line.label} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className={styles.line}>
              <polyline
                points={toPolyline(line.points.slice(-n))}
                fill="none"
                style={{ stroke: line.color }}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
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
    </div>
  );
}
