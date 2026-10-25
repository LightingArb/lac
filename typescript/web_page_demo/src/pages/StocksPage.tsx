import { useRef, useState } from 'react';
import { StockDetail } from '../components/stocks/StockDetail';
import { StockSelector, type StockPick } from '../components/stocks/StockSelector';
import type { Theme } from '../data/preferences';
import type { Holding, StockMarket } from '../data/stocks';
import { useT } from '../i18n';
import { cx } from '../lib/cx';
import type { DataMode } from '../lib/live';
import {
  DEFAULT_INDICATORS,
  searchStocks,
  stockByCode,
  tabsFor,
  type StockIndicator,
  type StockTab,
} from '../lib/stocks';
import layout from './MarketsPage.module.css';
import styles from './StocksPage.module.css';

interface StocksPageProps {
  dataMode: DataMode;
  /** Holding period, picked in the top bar and shared by the whole page. */
  holding: Holding;
  theme: Theme;
}

/**
 * Stocks: the selector (Taiwan or US; stock analysis, congress trades, fund holdings) beside the picked stock's
 * daily chart; stacked when the content area is narrow, like Prediction. Live has no stock data yet.
 */
export function StocksPage({ dataMode, holding, theme }: StocksPageProps) {
  const t = useT();
  const layoutRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const [market, setMarket] = useState<StockMarket>('tw');
  const [tab, setTab] = useState<StockTab>('analysis');
  const [pick, setPick] = useState<StockPick | null>(null);
  const [indicators, setIndicators] = useState<StockIndicator[]>(DEFAULT_INDICATORS);

  if (dataMode === 'live') {
    return (
      <div className={cx(layout.workspace, styles.page)} data-theme={theme}>
        <section aria-label={t.stocks.selector} className={styles.live}>
          {t.stocks.live}
        </section>
        <section aria-label={t.stocks.detail} className={cx(styles.live, styles.liveDetail)}>
          {t.stocks.live}
        </section>
      </div>
    );
  }

  // Until something is picked, the first stock of the market's list.
  const current = pick ?? { code: searchStocks(market, '')[0].code, trade: null };
  const stock = stockByCode(current.code)!;

  const changeMarket = (next: StockMarket) => {
    setMarket(next);
    setPick(null);
    if (!tabsFor(next).includes(tab)) setTab('analysis');
  };

  return (
    <div ref={layoutRef} className={cx(layout.workspace, styles.page)} data-theme={theme}>
      <StockSelector
        key={market}
        market={market}
        onMarket={changeMarket}
        tab={tab}
        onTab={setTab}
        holding={holding}
        selectedCode={stock.code}
        onPick={(next) => {
          setPick(next);
          const box = layoutRef.current;
          if (box && getComputedStyle(box).flexDirection === 'column') {
            detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }}
      />
      <StockDetail
        ref={detailRef}
        stock={stock}
        pick={current}
        holding={holding}
        indicators={indicators}
        onIndicators={setIndicators}
        theme={theme}
      />
    </div>
  );
}
