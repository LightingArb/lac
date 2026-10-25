import type { Ref } from 'react';
import { useT } from '../../i18n';
import {
  groupMarkets,
  otherByEvent,
  threeWay,
  type MarketGroups,
  type OddsFormat,
  type SportsGame,
  type SportsMarket,
} from '../../lib/sports';
import { Badge } from '../ui/Badge';
import { GameStatus, OddsChip, ThreeCells, utcTime } from './SportsParts';
import styles from './SportsDetail.module.css';

interface SportsDetailProps {
  ref?: Ref<HTMLElement>;
  game: SportsGame | null;
  format: OddsFormat;
  emptyText: string;
}

const GROUPS: Exclude<keyof MarketGroups, 'other'>[] = ['moneyline', 'spreads', 'totals'];

/**
 * Right-middle column: every open market of every event in the game, grouped; "other" markets under one
 * heading per event (Total Corners, Player Props…). Each line as Polymarket names it.
 */
export function SportsDetail({ ref, game, format, emptyText }: SportsDetailProps) {
  const t = useT();
  if (!game) {
    return (
      <section ref={ref} aria-label={t.sports.detail} className={styles.detail}>
        <p className={styles.empty}>{emptyText}</p>
      </section>
    );
  }
  const groups = groupMarkets(game.markets);
  const other = otherByEvent(game);
  const cells = threeWay(game);
  return (
    <section ref={ref} aria-label={t.sports.detail} className={styles.detail}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <Badge>{game.league.name ?? t.sports.unknownLeague}</Badge>
          <h1 className={styles.title}>{game.title}</h1>
          <span className={styles.meta}>
            {t.sports.start} {utcTime(game.startAt, t.locale)} · {t.sports.marketCount(game.marketCount)} ·{' '}
            {t.sports.eventCount(game.events.length)}
          </span>
        </div>

        <div className={styles.board}>
          <span className={styles.boardStatus}>
            <GameStatus game={game} t={t} />
          </span>
          <span className={styles.boardTeams}>
            {game.teams.map((team, i) => (
              <span key={i} className={styles.boardTeam}>
                <span className={i === 0 ? styles.avatarA : styles.avatarB}>
                  {team.abbreviation?.toUpperCase() ?? '—'}
                </span>
                <span>{team.name ?? '—'}</span>
              </span>
            ))}
          </span>
          <span className={styles.boardScore}>{game.score ?? '—'}</span>
        </div>

        {GROUPS.map((key) =>
          groups[key].length ? (
            <div key={key} className={styles.group}>
              <h2 className={styles.groupTitle}>
                {t.sports.groups[key]} <span className={styles.groupCount}>{groups[key].length}</span>
              </h2>
              {key === 'moneyline' && cells && <ThreeCells game={game} cells={cells} format={format} size="md" />}
              <Lines markets={groups[key]} format={format} />
            </div>
          ) : null,
        )}
        {other.length > 0 && (
          <div className={styles.group}>
            <h2 className={styles.groupTitle}>
              {t.sports.groups.other} <span className={styles.groupCount}>{groups.other.length}</span>
            </h2>
            {other.map((part) => (
              <div key={part.eventId} className={styles.subGroup}>
                <h3 className={styles.subTitle}>{part.heading}</h3>
                <Lines markets={part.markets} format={format} />
              </div>
            ))}
          </div>
        )}
        {!game.markets.length && <p className={styles.empty}>—</p>}
        <p className={styles.note}>{t.sports.oddsNote}</p>
      </div>
    </section>
  );
}

function Lines({ markets, format }: { markets: SportsMarket[]; format: OddsFormat }) {
  return (
    <div className={styles.lines}>
      {markets.map((market) => (
        <div key={market.id} id={`line-${market.id}`} className={styles.line}>
          <span className={styles.lineTitle}>{market.title}</span>
          <span className={styles.outcomes}>
            {market.outcomes.map((o) => (
              <OddsChip key={o.index} label={o.label} outcome={o} format={format} withPrice size="md" />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
