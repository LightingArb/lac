import type { WithdrawalStatus } from '../data/withdrawals';
import { useT } from '../i18n';
import { Badge, type BadgeTone } from './ui/Badge';

const TONE: Record<WithdrawalStatus, BadgeTone> = {
  pending: 'warning',
  approved: 'info',
  paid: 'success',
  rejected: 'danger',
};

export function WithdrawalStatusBadge({ status }: { status: WithdrawalStatus }) {
  const t = useT();
  return <Badge tone={TONE[status]}>{t.withdrawal.status[status]}</Badge>;
}
