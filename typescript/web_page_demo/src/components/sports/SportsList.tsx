import { useEffect, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { cx } from '../../lib/cx';
import { mainLine, moneylines, threeWay, type OddsFormat, type SportsGame, type SportsMarket } from '../../lib/sports';
import { GameStatus, OddsChip, Teams, ThreeCells, utcTime } from './SportsParts';
import styles from './SportsList.module.css';

interface SportsListProps {
  title: string;
  games: SportsGame[];
  emptyText: string;
  selectedId: string | null;
  format: OddsFormat;
  onSelect: (game: SportsGame) => void;
  footer?: ReactNode;
}

/** Left-middle column: one row per game (all its events merged) with its moneyline, main spread and main total. */
export function SportsList({ title, games, emptyText, selectedId, format, onSelect, footer }: SportsListProps) {
  const t = useT();
  useEffect(() => {
    if (selectedId) document.getElementById(`game-${selectedId}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  return (
    <section aria-label={t.sports.games} className={styles.list}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <span className={styles.count}>{t.sports.gameCount(games.length)}</span>
      </div>
      {games.length > 0 && (
        <div className={styles.columns} aria-hidden="true">
          <span>{t.sports.columns.time}</span>
          <span>{t.sports.columns.teams}</span>
          <span>{t.sports.columns.status}</span>
          <span>{t.sports.columns.moneyline}</span>
          <span>{t.sports.columns.spreads}</span>
          <span>{t.sports.columns.totals}</span>
        </div>
      )}
      {games.length === 0 && <p className={styles.empty}>{emptyText}</p>}
      {games.map((game) => (
        <button
          key={game.id}
          id={`game-${game.id}`}
          type="button"
          aria-pressed={game.id === selectedId}
          className={cx(styles.row, game.id === selectedId && styles.selected)}
          onClick={() => onSelect(game)}
        >
          <span className={styles.time}>
            <span>{utcTime(game.startAt, t.locale)}</span>
            <span className={styles.league}>{game.league.name ?? t.sports.unknownLeague}</span>
          </span>
          <span className={styles.game}>
            <Teams game={game} />
            <span className={styles.gameTitle} title={game.title}>
              {game.title}
              {game.events.length > 1 && ` · ${t.sports.eventCount(game.events.length)}`}
            </span>
          </span>
          <span className={styles.status}>
            <GameStatus game={game} t={t} />
            {(game.live === true || game.ended === true) && game.score !== null && (
              <span className={styles.score}>{game.score}</span>
            )}
          </span>
          <Cell label={t.sports.columns.moneyline}>
            <Moneyline game={game} format={format} />
          </Cell>
          <Cell label={t.sports.columns.spreads}>
            <Line market={mainLine(game.markets, 'spreads')} format={format} />
          </Cell>
          <Cell label={t.sports.columns.totals}>
            <Line market={mainLine(game.markets, 'totals')} format={format} />
          </Cell>
        </button>
      ))}
      {footer}
    </section>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className={styles.cell}>
      <span className={styles.cellLabel}>{label}</span>
      {children}
    </span>
  );
}

/**
 * Three Yes/No moneylines: one row of three cells, team 1 / draw / team 2 (all "—" when they can't be placed).
 * One market with team outcomes: both outcomes. Any other number of markets: each market's Yes.
 */
function Moneyline({ game, format }: { game: SportsGame; format: OddsFormat }) {
  const cells = threeWay(game);
  if (cells) return <ThreeCells game={game} cells={cells} format={format} />;
  const markets = moneylines(game.markets);
  if (!markets.length) return <span className={styles.none}>—</span>;
  if (markets.length === 1) {
    return (
      <>
        {markets[0].outcomes.map((o) => (
          <OddsChip key={o.index} label={o.label} outcome={o} format={format} />
        ))}
      </>
    );
  }
  return (
    <>
      {markets.slice(0, 3).map((m) => (
        <OddsChip
          key={m.id}
          label={m.title}
          outcome={m.outcomes.find((o) => o.label === 'Yes') ?? m.outcomes[0] ?? null}
          format={format}
        />
      ))}
    </>
  );
}

function Line({ market, format }: { market: SportsMarket | null; format: OddsFormat }) {
  if (!market) return <span className={styles.none}>—</span>;
  return (
    <>
      <span className={styles.lineTitle} title={market.title}>
        {market.title}
      </span>
      {market.outcomes.map((o) => (
        <OddsChip key={o.index} label={o.label} outcome={o} format={format} />
      ))}
    </>
  );
}
