import { useState } from 'react';
import { dollars } from '../data/referral';
import {
  MIN_WITHDRAWAL_CENTS,
  NETWORKS,
  network,
  parseAmount,
  validateDraft,
  type DraftErrors,
  type Network,
  type WithdrawalDraft,
} from '../data/withdrawals';
import { useT } from '../i18n';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { SegmentedControl } from './ui/SegmentedControl';
import { TextField } from './ui/TextField';
import styles from './WithdrawDialog.module.css';

interface WithdrawDialogProps {
  availableCents: number;
  onSubmit: (draft: WithdrawalDraft) => void;
  onClose: () => void;
}

/** Referral-earnings payout request. LAC reviews it and pays by hand. */
export function WithdrawDialog({ availableCents, onSubmit, onClose }: WithdrawDialogProps) {
  const t = useT();
  const [amount, setAmount] = useState('');
  const [net, setNet] = useState<Network>('usdt-trc20');
  const [address, setAddress] = useState('');
  const [errors, setErrors] = useState<DraftErrors>({});
  const [sent, setSent] = useState<WithdrawalDraft | null>(null);

  if (sent)
    return (
      <Dialog title={t.withdraw.sentTitle} onClose={onClose}>
        <p className={styles.done}>{t.withdraw.sentBody(dollars(sent.amountCents), network(sent.network).label)}</p>
        <Button onClick={onClose}>{t.withdraw.done}</Button>
      </Dialog>
    );

  const e = t.withdraw.errors;
  const amountError = errors.amount && { empty: e.amountEmpty, min: e.amountMin, max: e.amountMax }[errors.amount];
  const addressError =
    errors.address && (errors.address === 'empty' ? e.addressEmpty : e.addressInvalid(network(net).label));

  const submit = () => {
    const draft = { amountCents: parseAmount(amount), network: net, address };
    const found = validateDraft(draft, availableCents);
    setErrors(found);
    if (found.amount || found.address) return;
    onSubmit(draft);
    setSent(draft);
  };

  return (
    <Dialog title={t.withdraw.title} subtitle={t.withdraw.available(dollars(availableCents))} onClose={onClose}>
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className={styles.amountRow}>
          <TextField
            label={t.withdraw.amount}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className={styles.grow}
            value={amount}
            error={amountError}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
          />
          <Button variant="secondary" className={styles.max} onClick={() => setAmount((availableCents / 100).toFixed(2))}>
            {t.withdraw.max}
          </Button>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>{t.withdraw.receiveAs}</span>
          <SegmentedControl label={t.withdraw.network} options={NETWORKS} value={net} onChange={setNet} />
        </div>

        <TextField
          label={t.withdraw.address}
          autoComplete="off"
          spellCheck={false}
          placeholder={network(net).placeholder}
          inputClassName={styles.mono}
          value={address}
          error={addressError}
          onChange={(event) => setAddress(event.target.value)}
        />

        <ul className={styles.rules}>
          <li>{t.withdraw.ruleMin(dollars(MIN_WITHDRAWAL_CENTS))}</li>
          <li>{t.withdraw.ruleNetwork}</li>
        </ul>

        <Button type="submit" block>
          {t.withdraw.submit}
        </Button>
      </form>
    </Dialog>
  );
}
