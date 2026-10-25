import { useT } from '../../i18n';
import { closeQuote, type PositionView } from '../../lib/account';
import { cx } from '../../lib/cx';
import { count, shareCents, usdc } from '../../lib/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import styles from './ClosePositionDialog.module.css';

interface ClosePositionDialogProps {
  view: PositionView;
  onConfirm: () => void;
  onClose: () => void;
}

/** Asked before a close (the Account page and the Signal terminal): every share, at the price it sells for now. */
export function ClosePositionDialog({ view, onConfirm, onClose }: ClosePositionDialogProps) {
  const t = useT();
  const a = t.account;
  const quote = closeQuote(view);
  if (!quote) return null;
  const rows: [string, string, string?][] = [
    [a.market, `${view.market.title} · ${view.market.outcome}`],
    [a.outcome, t.side(view.market.side)],
    [a.shares, count(view.position.shares)],
    [a.estPrice, shareCents(quote.price)],
    [a.estProceeds, usdc(quote.proceeds)],
    [a.estPnl, usdc(quote.pnl, true), quote.pnl > 0 ? styles.gain : quote.pnl < 0 ? styles.loss : undefined],
  ];
  return (
    <Dialog title={a.closeTitle} onClose={onClose}>
      <dl className={styles.figures}>
        {rows.map(([label, value, tone]) => (
          <div key={label} className={styles.row}>
            <dt>{label}</dt>
            <dd className={cx(tone)}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.buttons}>
        <Button variant="secondary" onClick={onClose}>
          {a.cancel}
        </Button>
        <Button onClick={onConfirm}>{a.confirmClose}</Button>
      </div>
    </Dialog>
  );
}
