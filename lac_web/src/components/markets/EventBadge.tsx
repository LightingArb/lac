import { CATEGORY_TONES, type MarketEvent } from '../../data/catalog';
import { cx } from '../../lib/cx';
import styles from './EventBadge.module.css';

interface EventBadgeProps {
  event: MarketEvent;
  size?: 'md' | 'lg';
}

/** Category-tinted square with the event's short code. */
export function EventBadge({ event, size = 'md' }: EventBadgeProps) {
  const tone = CATEGORY_TONES[event.cat];
  return (
    <span className={cx(styles.badge, styles[size])} style={{ background: tone.bg, color: tone.fg }}>
      {event.abbr}
    </span>
  );
}
