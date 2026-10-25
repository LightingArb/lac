import { useMemo, type Ref } from 'react';
import { CONGRESS_MEMBERS } from '../../data/congress';
import type { Theme } from '../../data/preferences';
import { CURRENCY, type Holding, type Stock } from '../../data/stocks';
import { useT } from '../../i18n';
import { cx } from '../../lib/cx';
import {
  INDICATORS,
  chanceText,
  dailyCandles,
  fairOf,
  formatPrice,
  stockName,
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

/** Right column: the stock's price, fair price and chance for the holding period, then its daily chart. */
export function StockDetail({ ref, stock, pick, holding, indicators, onIndicators, theme }: StockDetailProps) {
  const t = useT();
  const st = t.stocks;
  const candles = useMemo(() => dailyCandles(stock), [stock]);
  const fair = fairOf(stock, holding);
  const fairText = formatPrice(stock.market, fair.price);
  const member = pick.trade && CONGRESS_MEMBERS.find((m) => m.id === pick.trade!.memberId);
  const marks = useMemo(() => (member ? tradeMarks(member.id, stock.code) : []), [member, stock.code]);
  const toggle = (name: StockIndicator) =>
    onIndicators(indicators.includes(name) ? indicators.filter((n) => n !== name) : [...indicators, name]);

  return (
    <section ref={ref} aria-label={st.detail} className={styles.detail}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.code}>{stock.code}</span>
          <h1 className={styles.name}>{stockName(t, stock)}</h1>
          <Badge>{st.currency[CURRENCY[stock.market]]}</Badge>
        </div>
        <dl className={styles.figures}>
          <div>
            <dt>{st.price}</dt>
            <dd className={styles.price}>{formatPrice(stock.market, stock.price)}</dd>
          </div>
          <div>
            <dt>{st.columns.fair(holding)}</dt>
            <dd className={styles.fair}>{fairText}</dd>
          </div>
          <div>
            <dt>{st.columns.chance}</dt>
            <dd className={styles.chance}>{chanceText(t, stock, holding)}</dd>
          </div>
        </dl>
      </div>

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
        <span className={styles.daily}>{st.daily}</span>
      </div>

      {member && (
        <p className={styles.marks}>
          {st.congress.marking(member.name, marks.length)}{' '}
          <span className={styles.buy}>{st.congress.markLetter.buy}</span> {st.congress.side.buy} ·{' '}
          <span className={styles.sell}>{st.congress.markLetter.sell}</span> {st.congress.side.sell}
        </p>
      )}

      <StockChart
        code={stock.code}
        market={stock.market}
        candles={candles}
        fair={{ price: fair.price, label: st.fairLine(holding, fairText) }}
        indicators={indicators}
        marks={marks}
        focus={pick.trade?.timestamp ?? null}
        theme={theme}
      />
    </section>
  );
}
