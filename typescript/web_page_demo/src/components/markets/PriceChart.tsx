import { useState } from 'react';
import type { MarketEvent } from '../../data/catalog';
import { useT, type Messages } from '../../i18n';
import { chance } from '../../lib/format';
import { priceSeries } from '../../lib/series';
import { historyPath } from '../../lib/history';
import { useLive, type HistoryResponse } from '../../lib/live';
import { SegmentedControl } from '../ui/SegmentedControl';
import styles from './PriceChart.module.css';

type Range = '1H' | '6H' | '1D' | '1W' | '1M' | 'ALL';

const RANGE_IDS: Range[] = ['1H', '6H', '1D', '1W', '1M', 'ALL'];

/** How many of the 96 history points each range shows. */
const RANGE_POINTS: Record<Range, number> = { '1H': 12, '6H': 24, '1D': 40, '1W': 64, '1M': 80, ALL: 96 };

const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const GRID_LINES = [0, 50, 100, 150];
const Y_LABELS = ['100%', '75%', '50%', '25%', '0%'];

interface Line {
  label: string;
  points: (number | null)[];
  end: number | null;
  times?: number[];
  color: string;
}

function chartLines(event: MarketEvent, t: Messages): Line[] {
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
    { label: t.side(event.yesLabel ?? 'Yes'), points: yes, end: row.yes, color: SERIES_COLORS[0] },
    { label: t.side(event.noLabel ?? 'No'), points: yes.map((v) => 1 - v), end: row.no, color: SERIES_COLORS[1] },
  ];
}

/** Polyline points in a 100×100 box: x is time, y is price (top = 100%). */
function toPolyline(points: number[]): string {
  const last = points.length - 1;
  return points.map((v, i) => `${((i / last) * 100).toFixed(2)},${((1 - v) * 100).toFixed(2)}`).join(' ');
}

export function PriceChart({ event }: { event: MarketEvent }) {
  const t = useT();
  const [range, setRange] = useState<Range>('ALL');
  const ranges = RANGE_IDS.map((value) => ({ value, label: value === 'ALL' ? t.chart.all : value }));
  const live = event.source === 'live';
  const series =
    event.kind === 'multi'
      ? event.rows.map((row) => ({ id: row.id, index: row.yesIndex, label: row.label }))
      : [
          { id: event.rows[0]?.id, index: event.rows[0]?.yesIndex, label: t.side(event.yesLabel ?? 'Yes') },
          { id: event.rows[0]?.id, index: event.rows[0]?.noIndex, label: t.side(event.noLabel ?? 'No') },
        ];
  const ids = [...new Set(series.flatMap((item) => item.id ? [item.id] : []))];
  const history = useLive<HistoryResponse>(
    live && ids.length ? `/api/live/history?ids=${ids.join(',')}&range=${range}` : null,
  );
  const endAt = history.data?.endAt ? Date.parse(history.data.endAt) : 0;
  const startAt = history.data?.startAt ? Date.parse(history.data.startAt) : 0;
  const lines: Line[] = live
    ? series.map((item, i) => {
        const source = item.id ? history.data?.histories[item.id]?.points ?? [] : [];
        const points = source.map((point) => {
          const value = item.index === 0 ? point.price : item.index === 1 ? point.second_price : null;
          return value === null ? null : Number(value);
        });
        return {
          label: item.label,
          end: [...points].reverse().find((point) => point !== null) ?? null,
          color: i < SERIES_COLORS.length ? SERIES_COLORS[i] : `hsl(${(i * 137.508) % 360} 65% 40%)`,
          points,
          times: source.map((point) => Date.parse(point.minute_at)),
        };
      })
    : chartLines(event, t);
  const n = RANGE_POINTS[range];
  const stamp = (ms: number) =>
    new Date(ms).toLocaleString(t.locale, {
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
      ? [t.date(event.open), '', '', t.chart.now]
      : [...t.chart.axis[range], t.chart.now];

  return (
    <div className={styles.chart}>
      <div className={styles.toolbar}>
        <SegmentedControl label={t.chart.range} options={ranges} value={range} onChange={setRange} size="sm" />
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
        <div role="img" aria-label={t.chart.priceHistory(event.title)} className={styles.plot}>
          {GRID_LINES.map((top) => (
            <span key={top} className={styles.gridLine} style={{ top }} />
          ))}
          <span className={`${styles.gridLine} ${styles.baseline}`} />
          {live && !lines.some((line) => line.points.some((point) => point !== null)) && (
            <span className={styles.empty}>
              {history.error ?? (history.data || !ids.length ? t.chart.noHistory : t.chart.loadingHistory)}
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
                  d={historyPath(line.points, line.times!, startAt, endAt)}
                  strokeLinecap="round"
                  fill="none"
                  style={{ stroke: line.color }}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <polyline
                  points={toPolyline(line.points.slice(-n) as number[])}
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
          {t.chart.historyNote(stamp(startAt), stamp(endAt))}
        </span>
      )}
    </div>
  );
}
