import type { ReactNode } from 'react';
import { useT, type Messages } from '../../i18n';
import { cx } from '../../lib/cx';
import { cents } from '../../lib/format';
import { odds, type OddsFormat, type SportsGame, type SportsOutcome } from '../../lib/sports';
import { LiveIndicator } from '../markets/MatchParts';
import styles from './SportsParts.module.css';

/** Times are UTC, as stored; e.g. "Oct 22, 19:00 UTC". */
export function utcTime(iso: string | null, locale: string, withDate = true): string {
  if (!iso) return '—';
  const text = new Date(iso).toLocaleString(locale, {
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  });
  return `${text} UTC`;
}

/** LIVE with period and clock, Ended, or the start time — the source's own status, not inferred. */
export function GameStatus({ game, t }: { game: SportsGame; t: Messages }) {
  if (game.live === true) {
    return (
      <LiveIndicator>
        {[t.markets.live, game.period, game.elapsed].filter((value) => value !== null && value !== '').join(' · ')}
      </LiveIndicator>
    );
  }
  if (game.ended === true) return <span className={styles.ended}>{t.markets.ended}</span>;
  return <span className={styles.starts}>{utcTime(game.startAt, t.locale, false)}</span>;
}

/** One outcome: its Polymarket label and odds; `withPrice` adds the buy price in ¢ beside it. */
export function OddsChip({
  label,
  outcome,
  format,
  withPrice = false,
  size = 'sm',
}: {
  label: ReactNode;
  outcome: SportsOutcome | null;
  format: OddsFormat;
  withPrice?: boolean;
  size?: 'sm' | 'md';
}) {
  const t = useT();
  const buy = outcome?.buy ?? null;
  return (
    <span className={cx(styles.chip, styles[size])}>
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipQuote}>
        <span className={styles.chipOdds}>{odds(buy, format)}</span>
        {withPrice && <span className={styles.chipPrice}>{buy === null ? '—' : t.sports.buy(cents(buy))}</span>}
      </span>
    </span>
  );
}

/** The two teams in source order, abbreviation uppercased; no home/away is implied. */
export function Teams({ game }: { game: SportsGame }) {
  return (
    <span className={styles.teams}>
      {game.teams.map((team, i) => (
        <span key={i} className={styles.team}>
          <span className={cx(styles.abbr, i === 0 ? styles.teamA : styles.teamB)}>
            {team.abbreviation?.toUpperCase() ?? '—'}
          </span>
          <span className={styles.teamName}>{team.name ?? '—'}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Three Yes/No moneylines in one row: team 1 / draw / team 2, labelled by the teams' abbreviations in
 * `teams` order (no home/away), each cell the market's Yes odds; "—" when the markets can't be placed.
 */
export function ThreeCells({
  game,
  cells,
  format,
  size = 'sm',
}: {
  game: Pick<SportsGame, 'teams'>;
  cells: (SportsOutcome | null)[];
  format: OddsFormat;
  size?: 'sm' | 'md';
}) {
  const t = useT();
  const labels = [game.teams[0], null, game.teams[1]].map((team) =>
    team ? (team.abbreviation?.toUpperCase() ?? team.name ?? '—') : t.sports.draw,
  );
  return (
    <span className={cx(styles.three, size === 'md' && styles.threeLarge)}>
      {cells.map((cell, i) => (
        <span key={i} className={styles.threeCell}>
          <span className={styles.threeLabel}>{labels[i]}</span>
          <span className={styles.threeOdds}>{odds(cell?.buy ?? null, format)}</span>
        </span>
      ))}
    </span>
  );
}
