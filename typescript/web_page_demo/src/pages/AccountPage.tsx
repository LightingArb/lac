import { Fragment, useMemo, useState } from 'react';
import { ClosePositionDialog } from '../components/account/ClosePositionDialog';
import { ActionButton, LockedButton, type AccountActions } from '../components/terminal/TradingTerminal';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';
import { Page, PageHeader } from '../components/ui/Page';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import type { Account } from '../data/terminal';
import { useT } from '../i18n';
import {
  PERIOD_KINDS,
  accountSummary,
  ledger,
  localDay,
  marketName,
  overview,
  periodRange,
  positionView,
  shortAddress,
  type Ledger,
  type Overview,
  type PeriodKind,
  type Position,
  type PositionStep,
  type PositionView,
} from '../lib/account';
import { cx } from '../lib/cx';
import { count, shareCents, signedPercent, usdc } from '../lib/format';
import type { DataMode } from '../lib/live';
import styles from './AccountPage.module.css';

type TabId = 'overview' | 'positions' | 'orders' | 'history' | 'funds';
const TABS: TabId[] = ['overview', 'positions', 'orders', 'history', 'funds'];

interface AccountPageProps extends AccountActions {
  dataMode: DataMode;
  account: Account;
  /** The Demo clock, ms: where "today" ends. */
  now: number;
  /** A position opens on Signal when it has LAC signals, else on Prediction. */
  onOpenPosition: (position: Position) => void;
}

const tone = (n: number | null | undefined) => (n && n > 0 ? styles.gain : n && n < 0 ? styles.loss : undefined);

/**
 * The account, after MT5's desktop account view: the wallet and its four numbers, then Overview, Positions, Orders,
 * History and Funds, all worked out from the account's records (lib/account.ts). The Signal terminal is this made small.
 */
export function AccountPage({ dataMode, account, now, onOpenPosition, ...actions }: AccountPageProps) {
  const t = useT();
  const a = t.account;
  const [tab, setTab] = useState<TabId>('overview');
  const [period, setPeriod] = useState<PeriodKind>('today');
  const [custom, setCustom] = useState({ from: localDay(now - 6 * 86_400_000), to: localDay(now) });
  const book = useMemo(() => ledger(account), [account]);

  if (dataMode === 'live') {
    return (
      <Page label={a.title}>
        <PageHeader title={a.title} />
        <p className={styles.live}>{a.live}</p>
      </Page>
    );
  }

  const summary = accountSummary(account);
  const figures = [
    { label: a.balance, value: usdc(summary.balance) },
    { label: a.equity, value: usdc(summary.equity) },
    { label: a.available, value: usdc(summary.available) },
    { label: a.unrealized, value: usdc(summary.unrealized, true), tone: tone(summary.unrealized) },
  ];
  const counts: Partial<Record<TabId, number>> = {
    positions: book.open.length,
    orders: account.orders.length,
    history: book.closed.length,
    funds: book.funds.length,
  };

  return (
    <Page label={a.title}>
      <div className={styles.head}>
        <PageHeader title={a.title} />
        <span className={styles.wallet} aria-label={a.wallet}>
          <span className={styles.walletDot} />
          <span className={styles.address} title={account.address}>
            {shortAddress(account.address)}
          </span>
          <Badge tone="info">{t.common.demo}</Badge>
        </span>
      </div>

      <dl className={styles.figures}>
        {figures.map((f) => (
          <div key={f.label} className={styles.figure}>
            <dt>{f.label}</dt>
            <dd className={f.tone}>{f.value}</dd>
          </div>
        ))}
      </dl>

      <div role="tablist" aria-label={a.tabGroup} className={styles.tabs}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cx(styles.tab, tab === id && styles.tabActive)}
            onClick={() => setTab(id)}
          >
            {a.tabs[id]}
            {counts[id] !== undefined && <span className={styles.tabCount}>{counts[id]}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={a.tabs[tab]} className={styles.panel}>
        {tab === 'overview' && (
          <OverviewTab
            book={book}
            now={now}
            period={period}
            onPeriod={setPeriod}
            custom={custom}
            onCustom={setCustom}
          />
        )}
        {tab === 'positions' && <PositionsTab book={book} onOpenPosition={onOpenPosition} {...actions} />}
        {tab === 'orders' && <OrdersTab account={account} onCancelOrder={actions.onCancelOrder} />}
        {tab === 'history' && <HistoryTab book={book} />}
        {tab === 'funds' && <FundsTab book={book} />}
      </div>

      <p className={styles.note}>{a.demoNote}</p>
    </Page>
  );
}

function OverviewTab({
  book,
  now,
  period,
  onPeriod,
  custom,
  onCustom,
}: {
  book: Ledger;
  now: number;
  period: PeriodKind;
  onPeriod: (kind: PeriodKind) => void;
  custom: { from: string; to: string };
  onCustom: (custom: { from: string; to: string }) => void;
}) {
  const t = useT();
  const a = t.account;
  const range = periodRange(period, now, custom);
  const stats = overview(book, range);
  return (
    <div className={styles.overview}>
      <div className={styles.periodRow}>
        <SegmentedControl
          label={a.period}
          size="sm"
          value={period}
          onChange={onPeriod}
          options={PERIOD_KINDS.map((kind) => ({ value: kind, label: a.periods[kind] }))}
        />
        {period === 'custom' && (
          <span className={styles.dates}>
            <label>
              <span>{a.from}</span>
              <input
                type="date"
                value={custom.from}
                onChange={(e) => e.target.value && onCustom({ ...custom, from: e.target.value })}
              />
            </label>
            <label>
              <span>{a.to}</span>
              <input
                type="date"
                value={custom.to}
                onChange={(e) => e.target.value && onCustom({ ...custom, to: e.target.value })}
              />
            </label>
          </span>
        )}
      </div>
      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>{a.realized}</dt>
          <dd className={tone(stats.realized)}>{usdc(stats.realized, true)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>{a.closedCount}</dt>
          <dd>
            {stats.closed}
            <span className={styles.statSub}>{a.winLoss(stats.wins, stats.losses)}</span>
          </dd>
        </div>
        <div className={styles.stat}>
          <dt>{a.volume}</dt>
          <dd>{usdc(stats.volume)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>{a.fees}</dt>
          <dd>{usdc(stats.fees)}</dd>
        </div>
      </dl>
      <Curve stats={stats} />
    </div>
  );
}

/** Realized P/L added up over the period: a step for each sale, lost resolution or redemption. */
function Curve({ stats }: { stats: Overview }) {
  const t = useT();
  const a = t.account;
  const { curve } = stats;
  const [W, H, PAD] = [600, 160, 10];
  const values = curve.map((p) => p.value);
  const [low, high] = [Math.min(0, ...values), Math.max(0, ...values)];
  const [start, end] = [curve[0].at, curve[curve.length - 1].at];
  const x = (ms: number) => ((ms - start) / (end - start || 1)) * W;
  const y = (v: number) => PAD + (1 - (v - low) / (high - low || 1)) * (H - 2 * PAD);
  const path = curve
    .slice(1)
    .reduce((d, p) => `${d} H${x(p.at).toFixed(1)} V${y(p.value).toFixed(1)}`, `M0 ${y(0).toFixed(1)}`);
  return (
    <figure className={styles.curve}>
      <figcaption className={styles.curveHead}>
        <span>{a.curve}</span>
        <span className={cx(styles.curveValue, tone(stats.realized))}>{usdc(stats.realized, true)}</span>
      </figcaption>
      <div className={styles.plot}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={a.curve}>
          <line x1={0} x2={W} y1={y(0)} y2={y(0)} className={styles.zero} vectorEffect="non-scaling-stroke" />
          <path d={path} className={cx(styles.line, tone(stats.realized))} vectorEffect="non-scaling-stroke" />
        </svg>
        {high > 0 && <span className={cx(styles.tick, styles.tickTop)}>{usdc(high, true)}</span>}
        {low < 0 && <span className={cx(styles.tick, styles.tickBottom)}>{usdc(low, true)}</span>}
        {curve.length === 2 && <span className={styles.flat}>{a.noRealized}</span>}
      </div>
      <div className={styles.axis}>
        <span>{t.dateTime(start)}</span>
        <span>{t.dateTime(end)}</span>
      </div>
    </figure>
  );
}

function MarketCell({ title, outcome }: { title: string; outcome: string }) {
  return (
    <>
      <span className={styles.marketTitle}>{title}</span>
      <span className={styles.sub}>{outcome}</span>
    </>
  );
}

function SideBadge({ yes, label }: { yes: boolean; label: string }) {
  const t = useT();
  return <span className={cx(styles.side, yes ? styles.sideYes : styles.sideNo)}>{t.side(label)}</span>;
}

function Empty({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr className={styles.emptyRow}>
      <td colSpan={colSpan}>{text}</td>
    </tr>
  );
}

function PositionsTab({
  book,
  onOpenPosition,
  onClosePosition,
  onRedeem,
}: { book: Ledger; onOpenPosition: (position: Position) => void } & AccountActions) {
  const t = useT();
  const a = t.account;
  const [closing, setClosing] = useState<PositionView | null>(null);
  return (
    <>
      <table className={cx(styles.table, styles.positions)}>
        <thead>
          <tr>
            <th>{a.market}</th>
            <th>{a.outcome}</th>
            <th className={styles.num}>{a.shares}</th>
            <th className={styles.num}>{a.avgCost}</th>
            <th className={styles.num}>{a.price}</th>
            <th className={styles.num}>{a.pnl}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {book.open.map((p) => {
            const view = positionView(p);
            const { market, pnl } = view;
            return (
              <tr key={p.id}>
                <td className={styles.marketCell}>
                  <button
                    type="button"
                    className={styles.marketButton}
                    aria-label={t.terminal.open(`${market.title} · ${market.outcome}`)}
                    onClick={() => onOpenPosition(p)}
                  >
                    <MarketCell title={market.title} outcome={market.outcome} />
                  </button>
                </td>
                <td data-label={a.outcome}>
                  <SideBadge yes={p.side === 'yes'} label={market.side} />
                  {p.redeemable && <Badge tone="success">{a.redeemable}</Badge>}
                </td>
                <td data-label={a.shares} className={styles.num}>
                  {count(p.shares)}
                </td>
                <td data-label={a.avgCost} className={styles.num}>
                  {shareCents(view.avgCost)}
                </td>
                <td data-label={a.price} className={styles.num}>
                  {shareCents(view.price)}
                </td>
                <td data-label={a.pnl} className={cx(styles.num, tone(pnl?.amount))}>
                  {pnl ? usdc(pnl.amount, true) : '—'}
                  {pnl && <span className={styles.sub}>{signedPercent(pnl.percent)}</span>}
                </td>
                <td className={styles.actions} aria-label={a.actionsFor(market.title)}>
                  {p.redeemable ? (
                    <ActionButton label={a.redeem} onClick={() => onRedeem(p.id)} />
                  ) : (
                    <>
                      <ActionButton label={a.close} onClick={() => setClosing(view)} />
                      <LockedButton label={a.tpsl} note={a.paid} />
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {book.open.length === 0 && <Empty colSpan={7} text={a.empty.positions} />}
        </tbody>
      </table>
      {closing && (
        <ClosePositionDialog
          view={closing}
          onClose={() => setClosing(null)}
          onConfirm={() => {
            onClosePosition(closing.position.id);
            setClosing(null);
          }}
        />
      )}
    </>
  );
}

function OrdersTab({ account, onCancelOrder }: { account: Account; onCancelOrder: (orderId: string) => void }) {
  const t = useT();
  const a = t.account;
  return (
    <table className={cx(styles.table, styles.orders)}>
      <thead>
        <tr>
          <th>{a.market}</th>
          <th>{a.buySell}</th>
          <th>{a.outcome}</th>
          <th className={styles.num}>{a.limit}</th>
          <th className={styles.num}>{a.quantity}</th>
          <th className={styles.num}>{a.filled}</th>
          <th className={styles.num}>{a.reserved}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {account.orders.map((o) => {
          const market = marketName(o.eventId, o.outcomeId, o.side);
          return (
            <tr key={o.id}>
              <td className={styles.marketCell}>
                <MarketCell title={market.title} outcome={market.outcome} />
              </td>
              <td data-label={a.buySell} className={cx(styles.action, o.action === 'buy' ? styles.gain : styles.loss)}>
                {t.terminal.actions[o.action]}
              </td>
              <td data-label={a.outcome}>
                <SideBadge yes={o.side === 'yes'} label={market.side} />
              </td>
              <td data-label={a.limit} className={styles.num}>
                {shareCents(o.price)}
              </td>
              <td data-label={a.quantity} className={styles.num}>
                {count(o.shares)}
              </td>
              <td data-label={a.filled} className={styles.num}>
                {count(o.filled)}
              </td>
              <td data-label={a.reserved} className={styles.num}>
                {o.action === 'buy' ? usdc(o.price * (o.shares - o.filled)) : '—'}
              </td>
              <td className={styles.actions} aria-label={a.actionsFor(market.title)}>
                <ActionButton label={a.delete} onClick={() => onCancelOrder(o.id)} />
              </td>
            </tr>
          );
        })}
        {account.orders.length === 0 && <Empty colSpan={8} text={a.empty.orders} />}
      </tbody>
    </table>
  );
}

function HistoryTab({ book }: { book: Ledger }) {
  const t = useT();
  const a = t.account;
  const [shown, setShown] = useState<string | null>(null);
  return (
    <table className={cx(styles.table, styles.history)}>
      <thead>
        <tr>
          <th>{a.market}</th>
          <th>{a.outcome}</th>
          <th>{a.openClose}</th>
          <th className={styles.num}>{a.shares}</th>
          <th>{a.closedBy}</th>
          <th className={styles.num}>{a.realizedCol}</th>
        </tr>
      </thead>
      <tbody>
        {book.closed.map((p) => {
          const market = marketName(p.eventId, p.outcomeId, p.side);
          const open = shown === p.id;
          return (
            <Fragment key={p.id}>
              <tr className={cx(styles.historyRow, open && styles.historyOpen)}>
                <td className={styles.marketCell}>
                  <button
                    type="button"
                    className={styles.marketButton}
                    aria-expanded={open}
                    aria-label={a.records(`${market.title} · ${market.outcome}`)}
                    onClick={() => setShown(open ? null : p.id)}
                  >
                    <Icon name="chevronRight" size={14} strokeWidth={2} className={styles.chevron} />
                    <MarketCell title={market.title} outcome={market.outcome} />
                  </button>
                </td>
                <td data-label={a.outcome}>
                  <SideBadge yes={p.side === 'yes'} label={market.side} />
                </td>
                <td data-label={a.openClose}>
                  {t.monthDay(p.openedAt)} → {t.monthDay(p.closedAt!)}
                </td>
                <td data-label={a.shares} className={styles.num}>
                  {count(p.bought)}
                </td>
                <td data-label={a.closedBy}>{p.methods.map((m) => a.methods[m]).join(a.methodJoin)}</td>
                <td data-label={a.realizedCol} className={cx(styles.num, tone(p.realized))}>
                  {usdc(p.realized, true)}
                </td>
              </tr>
              {open && (
                <tr className={styles.stepsRow}>
                  <td colSpan={6}>
                    <Steps steps={p.steps} label={a.records(`${market.title} · ${market.outcome}`)} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
        {book.closed.length === 0 && <Empty colSpan={6} text={a.empty.history} />}
      </tbody>
    </table>
  );
}

/** The records a closed position is made of, oldest first. */
function Steps({ steps, label }: { steps: PositionStep[]; label: string }) {
  const t = useT();
  const a = t.account;
  return (
    <table className={cx(styles.table, styles.steps)} aria-label={label}>
      <thead>
        <tr>
          <th>{a.date}</th>
          <th>{a.kind}</th>
          <th className={styles.num}>{a.limit}</th>
          <th className={styles.num}>{a.shares}</th>
          <th className={styles.num}>{a.realizedCol}</th>
        </tr>
      </thead>
      <tbody>
        {steps.map(({ record, realized }) => {
          const kind =
            record.kind === 'resolve'
              ? `${a.kinds.resolve} · ${a.won(t.side(marketName(record.eventId, record.outcomeId, record.winner).side))}`
              : a.kinds[record.kind];
          return (
            <tr key={record.id}>
              <td data-label={a.date}>{t.dateTime(Date.parse(record.at))}</td>
              <td data-label={a.kind}>{kind}</td>
              <td data-label={a.limit} className={styles.num}>
                {record.kind === 'redeem' ? shareCents(1) : record.kind === 'resolve' ? '—' : shareCents(record.price)}
              </td>
              <td data-label={a.shares} className={styles.num}>
                {record.kind === 'resolve' ? '—' : count(record.shares)}
              </td>
              <td data-label={a.realizedCol} className={cx(styles.num, tone(realized))}>
                {realized === null ? '—' : usdc(realized, true)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FundsTab({ book }: { book: Ledger }) {
  const t = useT();
  const a = t.account;
  return (
    <table className={cx(styles.table, styles.funds)}>
      <thead>
        <tr>
          <th>{a.time}</th>
          <th>{a.kind}</th>
          <th className={styles.num}>{a.amount}</th>
          <th className={styles.num}>{a.balanceAfter}</th>
        </tr>
      </thead>
      <tbody>
        {book.funds.map(({ record, amount, balance }) => (
          <tr key={record.id}>
            <td data-label={a.time}>{t.dateTime(Date.parse(record.at))}</td>
            <td data-label={a.kind}>{record.kind === 'redeem' ? a.redeemPaid : a.kinds[record.kind]}</td>
            <td data-label={a.amount} className={cx(styles.num, tone(amount))}>
              {usdc(amount, true)}
            </td>
            <td data-label={a.balanceAfter} className={styles.num}>
              {usdc(balance)}
            </td>
          </tr>
        ))}
        {book.funds.length === 0 && <Empty colSpan={4} text={a.empty.funds} />}
      </tbody>
    </table>
  );
}
