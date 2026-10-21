import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import styles from './MatchParts.module.css';

interface TeamAvatarProps {
  abbr: string;
  /** Home team is green, away team is yellow. */
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
