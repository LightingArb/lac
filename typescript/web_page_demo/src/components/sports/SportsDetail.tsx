import type { Ref } from 'react';
import { useT } from '../../i18n';
import { groupMarkets, type MarketGroups, type OddsFormat, type SportsGame } from '../../lib/sports';
import { Badge } from '../ui/Badge';
import { GameStatus, OddsChip, utcTime } from './SportsParts';
import styles from './SportsDetail.module.css';

interface SportsDetailProps {
  ref?: Ref<HTMLElement>;
  game: SportsGame | null;
  format: OddsFormat;
  emptyText: string;
}

const GROUPS: (keyof MarketGroups)[] = ['moneyline', 'spreads', 'totals', 'other'];

/** Right-middle column: every open market of the game, grouped, each line as Polymarket names it. */
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
  return (
    <section ref={ref} aria-label={t.sports.detail} className={styles.detail}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <Badge>{game.league.name ?? t.sports.unknownLeague}</Badge>
          <h1 className={styles.title}>{game.title}</h1>
          <span className={styles.meta}>
            {t.sports.start} {utcTime(game.startAt, t.locale)} · {t.sports.marketCount(game.marketCount)}
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
              <div className={styles.lines}>
                {groups[key].map((market) => (
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
            </div>
          ) : null,
        )}
        {!game.markets.length && <p className={styles.empty}>—</p>}
        <p className={styles.note}>{t.sports.oddsNote}</p>
      </div>
    </section>
  );
}
