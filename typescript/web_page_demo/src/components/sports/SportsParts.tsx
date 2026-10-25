import type { ReactNode } from 'react';
import { useT, type Messages } from '../../i18n';
import { cx } from '../../lib/cx';
import { cents, roiPercent } from '../../lib/format';
import { odds, type OddsFormat, type SportsCell, type SportsGame, type SportsOutcome } from '../../lib/sports';
import { NO_MARKS, isPicked, oddsCell, type CellMarks } from '../../lib/sportsSignals';
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

/** A subscriber's signal on a cell: its ROI in green before the odds, e.g. "(+4.2%) 1.61". */
function Roi({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <>
      <span className={styles.roi}>({roiPercent(value)})</span>{' '}
    </>
  );
}

/**
 * One outcome: its Polymarket label and odds; `withPrice` adds the buy price in ¢ beside it. `marks` puts a
 * shown signal's ROI before the odds, and marks the cell of the card picked in the signals column.
 */
export function OddsChip({
  label,
  outcome,
  format,
  withPrice = false,
  size = 'sm',
  marketId,
  marks = NO_MARKS,
}: {
  label: ReactNode;
  outcome: SportsOutcome | null;
  format: OddsFormat;
  withPrice?: boolean;
  size?: 'sm' | 'md';
  marketId?: string;
  marks?: CellMarks;
}) {
  const t = useT();
  const buy = outcome?.buy ?? null;
  const cell = marketId && outcome ? oddsCell(marketId, outcome.index) : null;
  const picked = !!marketId && !!outcome && isPicked(marks, marketId, outcome.index);
  return (
    <span className={cx(styles.chip, styles[size], picked && styles.picked)}>
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipQuote}>
        <span className={styles.chipOdds}>
          <Roi value={cell === null ? undefined : marks.roi[cell]} />
          {odds(buy, format)}
        </span>
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
 * `marks` as on OddsChip.
 */
export function ThreeCells({
  game,
  cells,
  format,
  size = 'sm',
  marks = NO_MARKS,
}: {
  game: Pick<SportsGame, 'teams'>;
  cells: (SportsCell | null)[];
  format: OddsFormat;
  size?: 'sm' | 'md';
  marks?: CellMarks;
}) {
  const t = useT();
  const labels = [game.teams[0], null, game.teams[1]].map((team) =>
    team ? (team.abbreviation?.toUpperCase() ?? team.name ?? '—') : t.sports.draw,
  );
  return (
    <span className={cx(styles.three, size === 'md' && styles.threeLarge)}>
      {cells.map((cell, i) => {
        const key = cell && oddsCell(cell.market.id, cell.outcome.index);
        const picked = !!cell && isPicked(marks, cell.market.id, cell.outcome.index);
        return (
          <span key={i} className={cx(styles.threeCell, picked && styles.picked)}>
            <span className={styles.threeLabel}>{labels[i]}</span>
            <span className={styles.threeOdds}>
              <Roi value={key === null ? undefined : marks.roi[key]} />
              {odds(cell?.outcome.buy ?? null, format)}
            </span>
          </span>
        );
      })}
    </span>
  );
}
