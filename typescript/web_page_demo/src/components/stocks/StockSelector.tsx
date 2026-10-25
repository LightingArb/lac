import { useState } from 'react';
import { CONGRESS_MEMBERS, type CongressTrade } from '../../data/congress';
import { DEMO_FUNDS } from '../../data/funds';
import type { Holding, StockMarket } from '../../data/stocks';
import { useT } from '../../i18n';
import { cx } from '../../lib/cx';
import {
  amountText,
  chanceText,
  congressMembers,
  dayStart,
  fairOf,
  fundHoldings,
  fundName,
  fundsHolding,
  formatPrice,
  memberTrades,
  searchFunds,
  searchStocks,
  stockByCode,
  stockName,
  tabsFor,
  type StockTab,
} from '../../lib/stocks';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Icon } from '../ui/Icon';
import styles from './StockSelector.module.css';

/** A pick from the list; a congress trade also names its member and day, so the chart marks that member's trades. */
export interface StockPick {
  code: string;
  trade: { memberId: string; timestamp: number } | null;
}

interface StockSelectorProps {
  market: StockMarket;
  onMarket: (market: StockMarket) => void;
  tab: StockTab;
  onTab: (tab: StockTab) => void;
  holding: Holding;
  selectedCode: string;
  onPick: (pick: StockPick) => void;
}

/** Middle column: Taiwan or US, then stock analysis, congress trades (US only) or fund holdings. */
export function StockSelector({ market, onMarket, tab, onTab, holding, selectedCode, onPick }: StockSelectorProps) {
  const t = useT();
  const st = t.stocks;
  return (
    <section aria-label={st.selector} className={styles.selector}>
      <SegmentedControl
        label={st.marketGroup}
        value={market}
        onChange={onMarket}
        options={[
          { value: 'tw', label: st.markets.tw },
          { value: 'us', label: st.markets.us },
        ]}
      />
      <div role="tablist" aria-label={st.tabGroup} className={styles.tabs}>
        {tabsFor(market).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cx(styles.tab, tab === id && styles.tabActive)}
            onClick={() => onTab(id)}
          >
            {st.tabs[id]}
          </button>
        ))}
      </div>
      {tab === 'analysis' && <Analysis market={market} holding={holding} selectedCode={selectedCode} onPick={onPick} />}
      {tab === 'congress' && <Congress selectedCode={selectedCode} onPick={onPick} />}
      {tab === 'funds' && <Funds market={market} selectedCode={selectedCode} onPick={onPick} />}
    </section>
  );
}

function Search({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <label className={styles.search}>
      <Icon name="search" size={16} strokeWidth={2} />
      <input
        type="search"
        value={value}
        placeholder={label}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Analysis({
  market,
  holding,
  selectedCode,
  onPick,
}: Pick<StockSelectorProps, 'market' | 'holding' | 'selectedCode' | 'onPick'>) {
  const t = useT();
  const st = t.stocks;
  const [query, setQuery] = useState('');
  const stocks = searchStocks(market, query);
  return (
    <>
      <Search value={query} onChange={setQuery} label={st.search} />
      <div className={styles.table}>
        <div className={cx(styles.stockRow, styles.head)} aria-hidden="true">
          <span>{st.columns.code}</span>
          <span>{st.columns.name}</span>
          <span className={styles.num}>{st.columns.price}</span>
          <span className={styles.num}>{st.columns.fair(holding)}</span>
          <span>{st.columns.chance}</span>
        </div>
        {stocks.length === 0 && <p className={styles.empty}>{st.noMatch}</p>}
        {stocks.map((stock) => (
          <button
            key={stock.code}
            type="button"
            aria-pressed={stock.code === selectedCode}
            className={cx(styles.stockRow, styles.row, stock.code === selectedCode && styles.rowActive)}
            onClick={() => onPick({ code: stock.code, trade: null })}
          >
            <span className={styles.code}>{stock.code}</span>
            <span className={styles.name}>{stockName(t, stock)}</span>
            <span className={styles.num}>{formatPrice(market, stock.price)}</span>
            <span className={cx(styles.num, styles.fair)}>{formatPrice(market, fairOf(stock, holding).price)}</span>
            <span className={styles.chance}>{chanceText(t, stock, holding)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function Congress({ selectedCode, onPick }: Pick<StockSelectorProps, 'selectedCode' | 'onPick'>) {
  const t = useT();
  const ct = t.stocks.congress;
  const [memberId, setMemberId] = useState<string | null>(null);
  const [tradeId, setTradeId] = useState<string | null>(null);
  const member = CONGRESS_MEMBERS.find((m) => m.id === memberId);

  if (!member) {
    return (
      <>
        <p className={styles.note}>{ct.fictional}</p>
        <div className={styles.table}>
          <div className={cx(styles.memberRow, styles.head)} aria-hidden="true">
            <span>{ct.member}</span>
            <span className={styles.num}>{ct.trades}</span>
            <span>{ct.lastFiled}</span>
          </div>
          {congressMembers().map((row) => (
            <button
              key={row.member.id}
              type="button"
              className={cx(styles.memberRow, styles.row)}
              onClick={() => setMemberId(row.member.id)}
            >
              <span className={styles.memberName}>
                <strong>{row.member.name}</strong>
                <span className={styles.sub}>
                  {ct.chamber[row.member.chamber]} · {ct.party[row.member.party]}
                </span>
              </span>
              <span className={styles.num}>{row.trades}</span>
              <span>{t.day(row.lastFiled)}</span>
            </button>
          ))}
        </div>
      </>
    );
  }

  const pick = (trade: CongressTrade) => {
    setTradeId(trade.id);
    onPick({ code: trade.code, trade: { memberId: trade.memberId, timestamp: dayStart(trade.tradedOn) } });
  };
  return (
    <>
      <button
        type="button"
        className={styles.back}
        onClick={() => {
          setMemberId(null);
          setTradeId(null);
        }}
      >
        <Icon name="chevronLeft" size={16} strokeWidth={2} />
        {ct.back}
      </button>
      <div className={styles.memberHead}>
        <strong>{member.name}</strong>
        <span className={styles.sub}>
          {ct.chamber[member.chamber]} · {ct.party[member.party]}
        </span>
      </div>
      <div className={styles.table}>
        <div className={cx(styles.tradeRow, styles.head)} aria-hidden="true">
          <span>{ct.traded}</span>
          <span>{ct.filed}</span>
          <span>{ct.sideLabel}</span>
          <span>{ct.stock}</span>
          <span>{ct.amount}</span>
        </div>
        {memberTrades(member.id).map((trade) => {
          const active = trade.id === tradeId && trade.code === selectedCode;
          return (
            <button
              key={trade.id}
              type="button"
              aria-pressed={active}
              className={cx(styles.tradeRow, styles.row, active && styles.rowActive)}
              onClick={() => pick(trade)}
            >
              <span>{t.day(trade.tradedOn)}</span>
              <span className={styles.sub}>{t.day(trade.filedOn)}</span>
              <span className={trade.side === 'buy' ? styles.buy : styles.sell}>{ct.side[trade.side]}</span>
              <span className={styles.code}>{trade.code}</span>
              <span className={styles.amount}>{amountText(trade.amount)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Funds({ market, selectedCode, onPick }: Pick<StockSelectorProps, 'market' | 'selectedCode' | 'onPick'>) {
  const t = useT();
  const ft = t.stocks.funds;
  const [mode, setMode] = useState<'fund' | 'stock'>('fund');
  const [query, setQuery] = useState('');
  const [fundCode, setFundCode] = useState(DEMO_FUNDS.find((f) => f.market === market)!.code);
  const [stockCode, setStockCode] = useState(selectedCode);
  const fund = DEMO_FUNDS.find((f) => f.code === fundCode)!;
  const stock = stockByCode(stockCode)!;

  const switchMode = (next: 'fund' | 'stock') => {
    setMode(next);
    setQuery('');
  };
  const choices =
    mode === 'fund'
      ? searchFunds(market, query).map((f) => ({ code: f.code, label: fundName(t, f) }))
      : searchStocks(market, query).map((s) => ({ code: s.code, label: stockName(t, s) }));
  const chosen = mode === 'fund' ? fundCode : stockCode;

  return (
    <>
      <SegmentedControl
        label={ft.modeGroup}
        size="sm"
        value={mode}
        onChange={switchMode}
        options={[
          { value: 'fund', label: ft.byFund },
          { value: 'stock', label: ft.byStock },
        ]}
      />
      <Search value={query} onChange={setQuery} label={mode === 'fund' ? ft.searchFund : t.stocks.search} />
      <div role="group" aria-label={mode === 'fund' ? ft.pickFund : ft.pickStock} className={styles.chips}>
        {choices.length === 0 && <span className={styles.empty}>{t.stocks.noMatch}</span>}
        {choices.map((choice) => (
          <button
            key={choice.code}
            type="button"
            aria-pressed={choice.code === chosen}
            className={cx(styles.chip, choice.code === chosen && styles.chipActive)}
            onClick={() => (mode === 'fund' ? setFundCode(choice.code) : setStockCode(choice.code))}
          >
            <strong>{choice.code}</strong> {choice.label}
          </button>
        ))}
      </div>

      {mode === 'fund' ? (
        <div className={styles.table}>
          <div className={styles.resultHead}>
            <strong>
              {fund.code} {fundName(t, fund)}
            </strong>
            <span className={styles.sub}>{ft.asOf(t.day(fund.asOf))}</span>
          </div>
          <div className={cx(styles.holdingRow, styles.head)} aria-hidden="true">
            <span>{t.stocks.columns.code}</span>
            <span>{t.stocks.columns.name}</span>
            <span className={styles.num}>{ft.weight}</span>
          </div>
          {fundHoldings(fund).map((row) =>
            row.stock ? (
              <button
                key={row.stock.code}
                type="button"
                aria-pressed={row.stock.code === selectedCode}
                className={cx(styles.holdingRow, styles.row, row.stock.code === selectedCode && styles.rowActive)}
                onClick={() => onPick({ code: row.stock!.code, trade: null })}
              >
                <span className={styles.code}>{row.stock.code}</span>
                <span className={styles.name}>{stockName(t, row.stock)}</span>
                <span className={styles.num}>{row.weight.toFixed(1)}%</span>
              </button>
            ) : (
              <div key="others" className={cx(styles.holdingRow, styles.row, styles.others)}>
                <span>—</span>
                <span className={styles.name}>{ft.others}</span>
                <span className={styles.num}>{row.weight.toFixed(1)}%</span>
              </div>
            ),
          )}
        </div>
      ) : (
        <div className={styles.table}>
          <div className={styles.resultHead}>
            <strong>
              {stock.code} {stockName(t, stock)}
            </strong>
            <span className={styles.sub}>{ft.heldBy}</span>
          </div>
          <div className={cx(styles.holdingRow, styles.head)} aria-hidden="true">
            <span>{ft.fund}</span>
            <span>{t.stocks.columns.name}</span>
            <span className={styles.num}>{ft.weight}</span>
          </div>
          {fundsHolding(stock.code).length === 0 && <p className={styles.empty}>{ft.none}</p>}
          {fundsHolding(stock.code).map(({ fund: f, weight }) => (
            <button
              key={f.code}
              type="button"
              className={cx(styles.holdingRow, styles.row)}
              onClick={() => {
                setFundCode(f.code);
                switchMode('fund');
              }}
            >
              <span className={styles.code}>{f.code}</span>
              <span className={styles.name}>{fundName(t, f)}</span>
              <span className={styles.num}>{weight.toFixed(1)}%</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
