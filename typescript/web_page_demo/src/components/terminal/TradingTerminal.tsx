import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Account, AccountRecord, Order } from '../../data/terminal';
import { useT } from '../../i18n';
import {
  accountSummary,
  ledger,
  marketName,
  positionView,
  shortAddress,
  type Position,
  type PositionView,
} from '../../lib/account';
import { cx } from '../../lib/cx';
import { count, shareCents, signedPercent, usdc } from '../../lib/format';
import { ClosePositionDialog } from '../account/ClosePositionDialog';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import styles from './TradingTerminal.module.css';

type TabId = 'positions' | 'orders' | 'trades';

/** The account's three Demo actions; the Account page has the same ones. */
export interface AccountActions {
  onClosePosition: (positionId: string) => void;
  onRedeem: (positionId: string) => void;
  onCancelOrder: (orderId: string) => void;
}

interface TradingTerminalProps extends AccountActions {
  /** `drawer`: never collapses, fills the drawer, and its toggle closes the drawer. */
  variant?: 'aside' | 'drawer';
  open: boolean;
  onToggle: () => void;
  account: Account;
  /** Highlighted position (same id as the yellow cell in the event detail). */
  activeId: string | null;
  onSelect: (position: Position) => void;
}

/**
 * Signal page, fifth column: the Account page made small, after the MT5 phone app — summary lines with dotted
 * leaders, then Positions / Orders / Trades. Same numbers and buttons as the Account page; TP/SL stays locked.
 */
export function TradingTerminal({
  variant = 'aside',
  open,
  onToggle,
  account,
  activeId,
  onSelect,
  onClosePosition,
  onRedeem,
  onCancelOrder,
}: TradingTerminalProps) {
  const t = useT();
  const a = t.account;
  const [tab, setTab] = useState<TabId>('positions');
  const [closing, setClosing] = useState<PositionView | null>(null);
  const book = useMemo(() => ledger(account), [account]);
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
    positions: book.open.length,
    orders: account.orders.length,
    trades: book.records.length,
  };

  return (
    <aside aria-label={t.terminal.panel} className={cx(styles.panel, inDrawer && styles.inDrawer)}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <Icon name="wallet" strokeWidth={2} className={styles.titleIcon} />
          <h2 className={styles.title}>{t.terminal.title}</h2>
          <Link to="/account" className={styles.fullAccount}>
            {t.terminal.fullAccount}
            <Icon name="arrowRight" size={14} strokeWidth={2} />
          </Link>
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
          <Leader label={a.balance} value={`${usdc(summary.balance)} USDC`} />
          <Leader label={a.equity} value={usdc(summary.equity)} />
          <Leader label={a.available} value={usdc(summary.available)} />
          <Leader
            label={a.unrealized}
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
          (book.open.length ? (
            book.open.map((p) => (
              <PositionCard
                key={p.id}
                view={positionView(p)}
                active={p.id === activeId}
                onSelect={() => onSelect(p)}
                onClose={setClosing}
                onRedeem={() => onRedeem(p.id)}
              />
            ))
          ) : (
            <Empty text={t.terminal.empty.positions} />
          ))}
        {tab === 'orders' &&
          (account.orders.length ? (
            account.orders.map((o) => <OrderCard key={o.id} order={o} onDelete={() => onCancelOrder(o.id)} />)
          ) : (
            <Empty text={t.terminal.empty.orders} />
          ))}
        {tab === 'trades' &&
          (book.records.length ? (
            book.records.map((record) => <TradeRow key={record.id} record={record} />)
          ) : (
            <Empty text={t.terminal.empty.trades} />
          ))}
      </div>

      <p className={styles.footer}>{t.terminal.demoNote}</p>
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
export function LockedButton({ label, note }: { label: string; note?: string }) {
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

/** A small working button next to the locked ones (close, redeem, delete). */
export function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.actionButton} onClick={onClick}>
      {label}
    </button>
  );
}

function SideBadge({ yes, label }: { yes: boolean; label: string }) {
  const t = useT();
  return <span className={cx(styles.side, yes ? styles.sideYes : styles.sideNo)}>{t.side(label)}</span>;
}

function PositionCard({
  view,
  active,
  onSelect,
  onClose,
  onRedeem,
}: {
  view: PositionView;
  active: boolean;
  onSelect: () => void;
  onClose: (view: PositionView) => void;
  onRedeem: () => void;
}) {
  const t = useT();
  const a = t.account;
  const { position, market, pnl } = view;
  const tone = pnl && pnl.amount > 0 ? 'gain' : pnl && pnl.amount < 0 ? 'loss' : undefined;
  return (
    <div className={cx(styles.card, active && styles.cardActive)}>
      <button
        type="button"
        aria-pressed={active}
        aria-label={t.terminal.open(`${market.title} · ${market.outcome}`)}
        className={styles.cardMain}
        onClick={onSelect}
      >
        <span className={styles.cardTitle}>
          {market.title} <span className={styles.option}>· {market.outcome}</span>
        </span>
        <span className={styles.cardMeta}>
          <SideBadge yes={position.side === 'yes'} label={market.side} />
          <span>
            {count(position.shares)} {t.terminal.shares}
          </span>
          {position.redeemable && <Badge tone="success">{a.redeemable}</Badge>}
        </span>
        <span className={styles.figures}>
          <Leader label={a.avgCost} value={shareCents(view.avgCost)} />
          <Leader label={a.price} value={shareCents(view.price)} />
          <Leader label={t.terminal.value} value={usdc(view.value)} />
          <Leader
            label={t.terminal.pnl}
            value={pnl ? `${usdc(pnl.amount, true)} (${signedPercent(pnl.percent)})` : '—'}
            tone={tone}
          />
        </span>
      </button>
      <div className={styles.cardActions}>
        {position.redeemable ? (
          <ActionButton label={a.redeem} onClick={onRedeem} />
        ) : (
          <>
            <ActionButton label={a.close} onClick={() => onClose(view)} />
            <LockedButton label={a.tpsl} note={a.paid} />
          </>
        )}
      </div>
    </div>
  );
}

function OrderCard({ order, onDelete }: { order: Order; onDelete: () => void }) {
  const t = useT();
  const market = marketName(order.eventId, order.outcomeId, order.side);
  return (
    <div className={styles.card}>
      <div className={styles.cardStatic}>
        <span className={styles.cardTitle}>
          {market.title} <span className={styles.option}>· {market.outcome}</span>
        </span>
        <span className={styles.cardMeta}>
          <span className={cx(styles.action, order.action === 'buy' ? styles.gain : styles.loss)}>
            {t.terminal.actions[order.action]}
          </span>
          <SideBadge yes={order.side === 'yes'} label={market.side} />
        </span>
        <span className={styles.figures}>
          <Leader label={t.terminal.limit} value={shareCents(order.price)} />
          <Leader label={t.terminal.shares} value={count(order.shares)} />
          <Leader label={t.account.filled} value={count(order.filled)} />
          <Leader label={t.terminal.placed} value={t.dateTime(Date.parse(order.placedAt))} />
        </span>
      </div>
      <div className={styles.cardActions}>
        <ActionButton label={t.account.delete} onClick={onDelete} />
      </div>
    </div>
  );
}

/** Cash a record moved; a resolution moves none. */
function cashMove(record: AccountRecord): number | null {
  switch (record.kind) {
    case 'buy':
      return -(record.price * record.shares + record.fee);
    case 'sell':
      return record.price * record.shares - record.fee;
    case 'redeem':
      return record.shares;
    case 'resolve':
      return null;
    case 'withdraw':
      return -record.amount;
    default:
      return record.amount;
  }
}

function TradeRow({ record }: { record: AccountRecord }) {
  const t = useT();
  const a = t.account;
  const moved = cashMove(record);
  const market =
    'eventId' in record
      ? marketName(record.eventId, record.outcomeId, 'side' in record ? record.side : record.winner)
      : null;
  const numbers =
    record.kind === 'buy' || record.kind === 'sell'
      ? `${shareCents(record.price)} × ${count(record.shares)}`
      : record.kind === 'redeem'
        ? `100¢ × ${count(record.shares)}`
        : record.kind === 'resolve' && market
          ? a.won(t.side(market.side))
          : '—';
  return (
    <div className={styles.trade}>
      <span className={styles.tradeHead}>
        <span className={styles.kind}>{a.kinds[record.kind]}</span>
        <span className={styles.time}>{t.dateTime(Date.parse(record.at))}</span>
      </span>
      {market && 'side' in record && (
        <span className={styles.tradeMarket}>
          <span className={styles.tradeTitle}>
            {market.title} <span className={styles.option}>· {market.outcome}</span>
          </span>
          <SideBadge yes={record.side === 'yes'} label={market.side} />
        </span>
      )}
      {market && record.kind === 'resolve' && (
        <span className={styles.tradeMarket}>
          <span className={styles.tradeTitle}>
            {market.title} <span className={styles.option}>· {market.outcome}</span>
          </span>
        </span>
      )}
      <span className={styles.tradeNumbers}>
        <span>{numbers}</span>
        {moved !== null && (
          <span className={cx(styles.amount, moved > 0 ? styles.gain : styles.loss)}>{usdc(moved, true)}</span>
        )}
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
