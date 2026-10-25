import { useMemo, type Ref } from 'react';
import type { Theme } from '../../data/preferences';
import { CURRENCY, type Holding, type Stock } from '../../data/stocks';
import { useT } from '../../i18n';
import { cx } from '../../lib/cx';
import {
  INDICATORS,
  formatPrice,
  latestRange,
  openingView,
  rangeBoxes,
  stockName,
  stockSeries,
  tradeMarks,
  type StockIndicator,
} from '../../lib/stocks';
import { Badge } from '../ui/Badge';
import { StockChart } from './StockChart';
import type { StockPick } from './StockSelector';
import styles from './StockDetail.module.css';

interface StockDetailProps {
  ref?: Ref<HTMLElement>;
  stock: Stock;
  /** How the stock was opened: a congress trade marks that member's trades on the chart. */
  pick: StockPick;
  holding: Holding;
  indicators: StockIndicator[];
  onIndicators: (indicators: StockIndicator[]) => void;
  theme: Theme;
}

/** Right column: price, fair price and range of the latest report for the holding period, then the daily chart. */
export function StockDetail({ ref, stock, pick, holding, indicators, onIndicators, theme }: StockDetailProps) {
  const t = useT();
  const st = t.stocks;
  const { candles, reports } = stockSeries(stock);
  const boxes = useMemo(() => rangeBoxes(reports, candles, holding), [reports, candles, holding]);
  const view = useMemo(() => openingView(candles, reports), [candles, reports]);
  const latest = latestRange(stock, holding);
  const price = (value: number) => formatPrice(stock.market, value);
  const memberId = pick.trade?.memberId ?? null;
  const marks = useMemo(() => (memberId ? tradeMarks(memberId, stock.code) : []), [memberId, stock.code]);
  const toggle = (name: StockIndicator) =>
    onIndicators(indicators.includes(name) ? indicators.filter((n) => n !== name) : [...indicators, name]);

  return (
    <section ref={ref} aria-label={st.detail} className={styles.detail}>
      <div className={styles.titleRow}>
        <span className={styles.code}>{stock.code}</span>
        <h1 className={styles.name}>{stockName(t, stock)}</h1>
        <Badge>{st.currency[CURRENCY[stock.market]]}</Badge>
      </div>
      <dl className={styles.figures}>
        <div>
          <dt>{st.price}</dt>
          <dd>{price(stock.price)}</dd>
        </div>
        <div>
          <dt>{st.columns.fair}</dt>
          <dd className={styles.fair}>{price(latest.fair)}</dd>
        </div>
        <div>
          <dt>{st.range}</dt>
          <dd>{st.rangeText(price(latest.lower), price(latest.upper))}</dd>
        </div>
      </dl>

      <div role="group" aria-label={st.indicators} className={styles.indicators}>
        {INDICATORS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={indicators.includes(name)}
            className={cx(styles.indicator, indicators.includes(name) && styles.indicatorOn)}
            onClick={() => toggle(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <StockChart
        code={stock.code}
        market={stock.market}
        candles={candles}
        holding={holding}
        boxes={boxes}
        view={view}
        indicators={indicators}
        marks={marks}
        focus={pick.trade?.timestamp ?? null}
        theme={theme}
      />
    </section>
  );
}
