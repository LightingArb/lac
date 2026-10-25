import type { SportId } from '../lib/sports';

// Sample LAC sport signals for the Sports page in Demo mode, shaped like the m_api /signals rows (README §6)
// and pointing at the Demo games in data/sports.ts. entry is that cell's buy price; fair, ev and roi are
// given as the upstream (sport m_ev) gives them: Web does not recompute them. Not real quotes.

/** Demo clock: valid_until and "updated" are judged against it, so the sample means the same whenever it is opened. */
export const SPORTS_DEMO_NOW = '2026-10-21T21:00:00Z';

export interface SportsSignal {
  id: string;
  /** `active`, or another state (stale, blocked…) with its reason. */
  status: string;
  reason: string | null;
  /** classification_path codes: sport → league. The sport is what the customer must hold. */
  sport: SportId;
  league: string;
  /** Polymarket event (a sub-event joins its game) and market. */
  eventId: string;
  marketId: string;
  /** YES is the market's first outcome, NO the second. */
  side: 'YES' | 'NO';
  entry: number;
  fair: number;
  /** fair − entry. */
  ev: number;
  /** fair ÷ entry − 1: the expected return of 1 staked at entry. */
  roi: number;
  avgCost: number;
  depth: number;
  evaluatedAt: string;
  validUntil: string;
}

const signal = (
  id: string,
  [sport, league]: [SportId, string],
  [eventId, marketId, side]: [string, string, 'YES' | 'NO'],
  [entry, fair, ev, roi]: [number, number, number, number],
  [avgCost, depth]: [number, number],
  [evaluatedAt, validUntil]: [string, string],
  [status, reason]: [string, string | null] = ['active', null],
): SportsSignal => ({
  id,
  status,
  reason,
  sport,
  league,
  eventId,
  marketId,
  side,
  entry,
  fair,
  ev,
  roi,
  avgCost,
  depth,
  evaluatedAt,
  validUntil,
});

const EPL: [SportId, string] = ['soccer', 'epl'];
const NBA: [SportId, string] = ['basketball', 'nba'];
const NHL: [SportId, string] = ['hockey', 'nhl'];

export const DEMO_SPORTS_SIGNALS: SportsSignal[] = [
  // Soccer: the 1X2 Yes, a total in "More Markets", corners in the Total Corners sub-event, an in-play total.
  signal(
    'sg-1',
    EPL,
    ['sp-epl-1', 'sp-epl-1-ml1', 'YES'],
    [0.55, 0.6, 0.05, 0.0909],
    [0.565, 5200],
    ['2026-10-21T20:59:15Z', '2026-10-22T19:00:00Z'],
  ),
  signal(
    'sg-2',
    EPL,
    ['sp-epl-1-mm', 'sp-epl-1-t1', 'YES'],
    [0.54, 0.58, 0.04, 0.0741],
    [0.555, 3100],
    ['2026-10-21T20:58:40Z', '2026-10-22T19:00:00Z'],
  ),
  signal(
    'sg-3',
    EPL,
    ['sp-epl-1-tc', 'sp-epl-1-c1', 'YES'],
    [0.52, 0.55, 0.03, 0.0577],
    [0.53, 1400],
    ['2026-10-21T20:57:30Z', '2026-10-22T19:00:00Z'],
  ),
  signal(
    'sg-4',
    EPL,
    ['sp-epl-2', 'sp-epl-2-t1', 'NO'],
    [0.39, 0.42, 0.03, 0.0769],
    [0.4, 2600],
    ['2026-10-21T20:59:50Z', '2026-10-21T21:05:00Z'],
  ),
  // Never shown: EV of 0, and one past valid_until.
  signal(
    'sg-5',
    EPL,
    ['sp-epl-1', 'sp-epl-1-ml3', 'YES'],
    [0.23, 0.23, 0, 0],
    [0.235, 900],
    ['2026-10-21T20:59:15Z', '2026-10-22T19:00:00Z'],
  ),
  signal(
    'sg-6',
    EPL,
    ['sp-epl-2', 'sp-epl-2-ml1', 'YES'],
    [0.93, 0.95, 0.02, 0.0215],
    [0.935, 4100],
    ['2026-10-21T20:40:00Z', '2026-10-21T20:50:00Z'],
  ),
  // Basketball: the README example (62¢, fair 64.6% → +4.2%, 1.61 / −163) and a NO side.
  signal(
    'sg-7',
    NBA,
    ['sp-nba-1', 'sp-nba-1-ml', 'YES'],
    [0.62, 0.646, 0.026, 0.0419],
    [0.63, 4800],
    ['2026-10-21T20:58:00Z', '2026-10-21T21:10:00Z'],
  ),
  signal(
    'sg-8',
    NBA,
    ['sp-nba-2', 'sp-nba-2-ml', 'NO'],
    [0.58, 0.63, 0.05, 0.0862],
    [0.595, 3400],
    ['2026-10-21T20:58:00Z', '2026-10-22T02:00:00Z'],
  ),
  // Never shown: not active.
  signal(
    'sg-9',
    NBA,
    ['sp-nba-1', 'sp-nba-1-s1', 'NO'],
    [0.49, 0.53, 0.04, 0.0816],
    [0.5, 1200],
    ['2026-10-21T20:50:00Z', '2026-10-21T21:10:00Z'],
    ['stale', 'Quote older than the model allows'],
  ),
  // Another sport: ice hockey.
  signal(
    'sg-10',
    NHL,
    ['sp-nhl-2', 'sp-nhl-2-t2', 'NO'],
    [0.53, 0.57, 0.04, 0.0755],
    [0.54, 1900],
    ['2026-10-21T20:55:00Z', '2026-10-22T23:00:00Z'],
  ),
];
