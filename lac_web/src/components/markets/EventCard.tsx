import type { MarketEvent } from '../../data/catalog';
import { cx } from '../../lib/cx';
import { chance, cents, multiplier, plural } from '../../lib/format';
import { Icon } from '../ui/Icon';
import { EventBadge } from './EventBadge';
import { LiveIndicator, TeamAvatar } from './MatchParts';
import styles from './EventCard.module.css';

interface EventCardProps {
  event: MarketEvent;
  selected: boolean;
  /** Shows the LAC coverage path under the title (Signal page). */
  showPath: boolean;
  signalCount: number;
  onSelect: () => void;
}

const PREVIEW_OUTCOMES = 3;

export function EventCard({ event, selected, showPath, signalCount, onSelect }: EventCardProps) {
  return (
    <button type="button" aria-pressed={selected} className={cx(styles.card, selected && styles.selected)} onClick={onSelect}>
      <span className={styles.head}>
        <EventBadge event={event} />
        <span className={styles.heading}>
          <span className={styles.title}>{event.title}</span>
          {showPath && event.lac && <span className={styles.path}>{event.lac.path}</span>}
        </span>
        <span className={styles.ends}>
          <span>{event.endDate}</span>
          <span>{event.endTime}</span>
        </span>
      </span>

      {event.match ? <MatchPreview event={event} /> : <OutcomePreview event={event} />}

      {signalCount > 0 && (
        <span className={styles.signals}>
          <Icon name="signal" size={14} strokeWidth={2.2} />
          <span>{plural(signalCount, 'positive-EV signal', 'positive-EV signals')}</span>
        </span>
      )}
    </button>
  );
}

function OutcomePreview({ event }: { event: MarketEvent }) {
  const rows =
    event.kind === 'multi'
      ? [...event.rows]
          .sort((a, b) => b.yes - a.yes)
          .slice(0, PREVIEW_OUTCOMES)
          .map((r) => ({ label: r.label, p: r.yes }))
      : [
          { label: event.yesLabel ?? 'Yes', p: event.rows[0].yes },
          { label: event.noLabel ?? 'No', p: event.rows[0].no },
        ];
  const more = event.kind === 'multi' ? event.rows.length - PREVIEW_OUTCOMES : 0;

  return (
    <span className={styles.outcomes}>
      {rows.map((r) => (
        <span key={r.label} className={styles.outcome}>
          <span className={styles.outcomeFill} style={{ width: `${Math.max(1, Math.round(r.p * 100))}%` }} />
          <span className={styles.outcomeLabel}>{r.label}</span>
          <span className={styles.outcomeQuote}>
            <span className={styles.outcomeMult}>{multiplier(r.p)}</span>
            <span className={styles.outcomePrice}>{cents(r.p)}</span>
          </span>
        </span>
      ))}
      {more > 0 && <span className={styles.more}>+{more} more outcomes</span>}
    </span>
  );
}

function MatchPreview({ event }: { event: MarketEvent }) {
  const m = event.match!;
  const { yes, no } = event.rows[0];
  return (
    <span className={styles.match}>
      <span className={styles.team}>
        <TeamAvatar abbr={m.aAbbr} team="a" />
        <span className={styles.teamName}>{m.teamA}</span>
        <span className={styles.teamPct}>{chance(yes)}</span>
        <span className={styles.teamMult}>{multiplier(yes)}</span>
      </span>
      <span className={styles.team}>
        <LiveIndicator>LIVE</LiveIndicator>
        <span className={styles.score}>
          {m.scoreA} : {m.scoreB}
        </span>
        <span className={styles.teamMult}>{m.mapText}</span>
      </span>
      <span className={styles.team}>
        <TeamAvatar abbr={m.bAbbr} team="b" />
        <span className={styles.teamName}>{m.teamB}</span>
        <span className={styles.teamPct}>{chance(no)}</span>
        <span className={styles.teamMult}>{multiplier(no)}</span>
      </span>
    </span>
  );
}
