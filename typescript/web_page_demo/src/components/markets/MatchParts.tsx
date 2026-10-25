import type { ReactNode } from 'react';
import type { MarketEvent } from '../../data/catalog';
import { useT } from '../../i18n';
import { chance, multiplier } from '../../lib/format';
import { cx } from '../../lib/cx';
import styles from './MatchParts.module.css';

interface TeamAvatarProps {
  abbr: string;
  /** Source array order: first team is green, second is yellow. */
  team: 'a' | 'b';
  size?: 'md' | 'sm';
}

export function TeamAvatar({ abbr, team, size = 'md' }: TeamAvatarProps) {
  return <span className={cx(styles.avatar, styles[size], team === 'a' ? styles.teamA : styles.teamB)}>{abbr}</span>;
}

export function LiveIndicator({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx(styles.live, className)}>
      <span className={styles.dot} />
      {children}
    </span>
  );
}

export function LiveMatchBoard({ match }: { match: NonNullable<MarketEvent['liveMatch']> }) {
  const t = useT();
  return (
    <span className={styles.board}>
      <span className={styles.status}>
        {match.live === true ? (
          <LiveIndicator>{[t.markets.live, match.period, match.elapsed].filter((value) => value !== null && value !== '').join(' · ')}</LiveIndicator>
        ) : match.ended === true ? t.markets.ended : t.markets.gameStarts(match.starts)}
      </span>
      <span className={styles.teams}>
        {match.teams.map((team, i) => (
          <span className={styles.team} key={i}>
            <TeamAvatar abbr={team.abbreviation?.toUpperCase() ?? '—'} team={i === 0 ? 'a' : 'b'} />
            <span>{team.name ?? '—'}</span>
            {match.probabilities && <span>{chance(match.probabilities[i])} · {multiplier(match.probabilities[i])}</span>}
          </span>
        ))}
      </span>
      <span className={styles.score}>{match.score ?? '—'}</span>
    </span>
  );
}
