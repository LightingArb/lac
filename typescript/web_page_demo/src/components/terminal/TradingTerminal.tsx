import { useEffect, useState, type ReactNode } from 'react';
import type { Account, Order, Position, Trade } from '../../data/terminal';
import { useT } from '../../i18n';
import { cx } from '../../lib/cx';
import { cents, signedPercent, usdc } from '../../lib/format';
import { EVENTS_BY_ID, findOutcome, sideLabel } from '../../lib/markets';
import { accountSummary, positionRow, shortAddress, type PositionRow } from '../../lib/terminal';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import styles from './TradingTerminal.module.css';

type TabId = 'positions' | 'orders' | 'trades';

interface TradingTerminalProps {
  /** `drawer`: never collapses, fills the drawer, and its toggle closes the drawer. */
  variant?: 'aside' | 'drawer';
  open: boolean;
  onToggle: () => void;
  account: Account;
  /** Highlighted position (same id as the yellow cell in the event detail). */
  activeId: string | null;
  onSelect: (position: Position) => void;
}

/** A share's price in ¢; a resolved share is exactly 0¢ or 100¢. */
const shareCents = (p: number | null) => (p === 1 ? '100¢' : p === 0 ? '0¢' : cents(p));

/**
 * Signal page, fifth column: the customer's account, after the MT5 phone app — summary lines
 * with dotted leaders, then Positions / Orders / Trades. Demo data only; every action is locked.
 */
export function TradingTerminal({
  variant = 'aside',
  open,
  onToggle,
  account,
  activeId,
  onSelect,
}: TradingTerminalProps) {
  const t = useT();
  const [tab, setTab] = useState<TabId>('positions');
  const inDrawer = variant === 'drawer';

  if (!open && !inDrawer) {
    return (
      <aside aria-label={t.terminal.panel} className={styles.collapsed}>
        <IconButton label={t.terminal.expand} icon="panelRight" onClick={onToggle} />
        <span className={styles.verticalLabel}>{t.terminal.vertical}</span>
      </aside>
    );
  }

  const summary = accountSummary(account);
  const counts: Record<TabId, number> = {
    positions: account.positions.length,
    orders: account.orders.length,
    trades: account.trades.length,
  };

  return (
    <aside aria-label={t.terminal.panel} className={cx(styles.panel, inDrawer && styles.inDrawer)}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <Icon name="wallet" strokeWidth={2} className={styles.titleIcon} />
          <h2 className={styles.title}>{t.terminal.title}</h2>
          {inDrawer ? (
            <IconButton label={t.terminal.close} icon="close" strokeWidth={2} onClick={onToggle} />
          ) : (
            <IconButton label={t.terminal.collapse} icon="panelRight" onClick={onToggle} />
          )}
        </div>
        <div className={styles.wallet} aria-label={t.terminal.wallet}>
          <span className={styles.walletDot} />
          <span className={styles.address} title={account.address}>
            {shortAddress(account.address)}
          </span>
          <Badge tone="info">{t.common.demo}</Badge>
          <LockedButton label={t.terminal.disconnect} />
        </div>
        <div className={styles.summary} role="group" aria-label={t.terminal.summary}>
          <Leader label={t.terminal.balance} value={`${usdc(summary.balance)} USDC`} />
          <Leader label={t.terminal.equity} value={usdc(summary.equity)} />
          <Leader label={t.terminal.available} value={usdc(summary.available)} />
          <Leader
            label={t.terminal.unrealized}
            value={usdc(summary.unrealized, true)}
            tone={summary.unrealized > 0 ? 'gain' : summary.unrealized < 0 ? 'loss' : undefined}
          />
        </div>
        <div role="tablist" aria-label={t.terminal.tabGroup} className={styles.tabs}>
          {(['positions', 'orders', 'trades'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cx(styles.tab, tab === id && styles.tabActive)}
              onClick={() => setTab(id)}
            >
              {t.terminal.tabs[id]}
              <span className={styles.tabCount}>{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" aria-label={t.terminal.tabs[tab]} className={styles.list}>
        {tab === 'positions' &&
          (account.positions.length ? (
            account.positions.map((p) => (
              <PositionCard key={p.id} row={positionRow(p)} active={p.id === activeId} onSelect={() => onSelect(p)} />
            ))
          ) : (
            <Empty text={t.terminal.empty.positions} />
          ))}
        {tab === 'orders' &&
          (account.orders.length ? (
            account.orders.map((o) => <OrderCard key={o.id} order={o} />)
          ) : (
            <Empty text={t.terminal.empty.orders} />
          ))}
        {tab === 'trades' &&
          (account.trades.length ? (
            account.trades.map((trade) => <TradeRow key={trade.id} trade={trade} />)
          ) : (
            <Empty text={t.terminal.empty.trades} />
          ))}
      </div>

      <p className={styles.footer}>{t.terminal.demoNote}</p>
    </aside>
  );
}

/** "Name ······ value": name on the left, number on the right, dotted line between. */
function Leader({ label, value, tone }: { label: string; value: ReactNode; tone?: 'gain' | 'loss' }) {
  return (
    <span className={styles.leader}>
      <span>{label}</span>
      <span className={styles.dots} aria-hidden="true" />
      <span className={cx(styles.leaderValue, tone && styles[tone])}>{value}</span>
    </span>
  );
}

/** Visible but not usable yet: hovering or clicking says it opens later. */
function LockedButton({ label, note }: { label: string; note?: string }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(false), 1600);
    return () => window.clearTimeout(timer);
  }, [shown]);
  return (
    <span className={styles.lockWrap}>
      <button
        type="button"
        aria-disabled="true"
        title={t.terminal.later}
        className={styles.locked}
        onClick={(e) => {
          e.stopPropagation();
          setShown(true);
        }}
      >
        <Icon name="lock" size={13} strokeWidth={2} />
        {label}
        {note && <span className={styles.lockNote}>{note}</span>}
      </button>
      <span role="status" className={cx(styles.tip, shown && styles.tipShown)}>
        {shown ? t.terminal.later : ''}
      </span>
      <span aria-hidden="true" className={styles.hoverTip}>
        {t.terminal.later}
      </span>
    </span>
  );
}

function SideBadge({ yes, label }: { yes: boolean; label: string }) {
  const t = useT();
  return <span className={cx(styles.side, yes ? styles.sideYes : styles.sideNo)}>{t.side(label)}</span>;
}

function PositionCard({ row, active, onSelect }: { row: PositionRow; active: boolean; onSelect: () => void }) {
  const t = useT();
  const { position, event, outcome, pnl } = row;
  const tone = pnl && pnl.amount > 0 ? 'gain' : pnl && pnl.amount < 0 ? 'loss' : undefined;
  return (
    <div className={cx(styles.card, active && styles.cardActive)}>
      <button
        type="button"
        aria-pressed={active}
        aria-label={t.terminal.open(`${event.title} · ${outcome.label}`)}
        className={styles.cardMain}
        onClick={onSelect}
      >
        <span className={styles.cardTitle}>
          {event.title} <span className={styles.option}>· {outcome.label}</span>
        </span>
        <span className={styles.cardMeta}>
          <SideBadge yes={position.side === 'yes'} label={row.sideLabel} />
          <span>
            {position.shares.toLocaleString('en-US')} {t.terminal.shares}
          </span>
          {row.redeemable && <Badge tone="success">{t.terminal.redeemable}</Badge>}
          {position.settledPrice !== undefined && !row.redeemable && <Badge>{t.terminal.settled}</Badge>}
        </span>
        <span className={styles.figures}>
          <Leader label={t.terminal.avgCost} value={shareCents(position.avgCost)} />
          <Leader
            label={position.settledPrice !== undefined ? t.terminal.settled : t.terminal.price}
            value={shareCents(row.price)}
          />
          <Leader label={t.terminal.value} value={usdc(row.value)} />
          <Leader
            label={t.terminal.pnl}
            value={pnl ? `${usdc(pnl.amount, true)} (${signedPercent(pnl.percent)})` : '—'}
            tone={tone}
          />
        </span>
      </button>
      <div className={styles.cardActions}>
        {row.redeemable && <LockedButton label={t.terminal.redeem} />}
        <LockedButton label={t.terminal.closePosition} />
        <LockedButton label={t.terminal.tpsl} note={t.terminal.paidPlan} />
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const t = useT();
  const event = EVENTS_BY_ID[order.eventId];
  const outcome = findOutcome(event, order.outcomeId);
  return (
    <div className={styles.card}>
      <div className={styles.cardStatic}>
        <span className={styles.cardTitle}>
          {event.title} <span className={styles.option}>· {outcome.label}</span>
        </span>
        <span className={styles.cardMeta}>
          <span className={cx(styles.action, order.action === 'buy' ? styles.gain : styles.loss)}>
            {t.terminal.actions[order.action]}
          </span>
          <SideBadge yes={order.side === 'yes'} label={sideLabel(event, order.side)} />
        </span>
        <span className={styles.figures}>
          <Leader label={t.terminal.limit} value={shareCents(order.price)} />
          <Leader label={t.terminal.shares} value={order.shares.toLocaleString('en-US')} />
          <Leader label={t.terminal.filled} value={order.filled.toLocaleString('en-US')} />
          <Leader label={t.terminal.placed} value={t.date(order.placedAt)} />
        </span>
      </div>
      <div className={styles.cardActions}>
        <LockedButton label={t.terminal.cancel} />
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const t = useT();
  const event = trade.eventId ? EVENTS_BY_ID[trade.eventId] : null;
  const outcome = event && trade.outcomeId ? findOutcome(event, trade.outcomeId) : null;
  return (
    <div className={styles.trade}>
      <span className={styles.tradeHead}>
        <span className={styles.kind}>{t.terminal.kinds[trade.kind]}</span>
        <span className={styles.time}>{t.date(trade.at)}</span>
      </span>
      {event && outcome && trade.side && (
        <span className={styles.tradeMarket}>
          <span className={styles.tradeTitle}>
            {event.title} <span className={styles.option}>· {outcome.label}</span>
          </span>
          <SideBadge yes={trade.side === 'yes'} label={sideLabel(event, trade.side)} />
        </span>
      )}
      <span className={styles.tradeNumbers}>
        <span>
          {trade.price !== undefined && trade.shares !== undefined
            ? `${shareCents(trade.price)} × ${trade.shares.toLocaleString('en-US')}`
            : '—'}
        </span>
        <span className={cx(styles.amount, trade.amount > 0 ? styles.gain : styles.loss)}>
          {usdc(trade.amount, true)}
        </span>
      </span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className={styles.empty}>
      <Icon name="box" size={40} strokeWidth={1.4} />
      <span>{text}</span>
    </div>
  );
}
