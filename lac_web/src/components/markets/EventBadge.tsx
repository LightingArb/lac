import { CATEGORY_TONES, type MarketEvent } from '../../data/catalog';
import { cx } from '../../lib/cx';
import styles from './EventBadge.module.css';

interface EventBadgeProps {
  event: MarketEvent;
  size?: 'md' | 'lg';
}

/** Category-tinted square with the event's short code. */
export function EventBadge({ event, size = 'md' }: EventBadgeProps) {
  const tone = event.cat ? CATEGORY_TONES[event.cat] : { bg: '#E2E8F0', fg: '#334155' };
  return (
    <span className={cx(styles.badge, styles[size])} style={{ background: tone.bg, color: tone.fg }}>
      {event.imageUrl ? (
        <img
          src={event.imageUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
        />
      ) : (
        event.abbr
      )}
    </span>
  );
}
