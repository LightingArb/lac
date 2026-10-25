import type { SportsEvent, SportsMarket } from '../lib/sports';

// Sample events for the Sports page in Demo mode, shaped like the Live reader's rows: some games are
// split into a main event and sub-events ("… - More Markets", "… - Total Corners"), merged into one
// game by lib/sports.ts mergeGames. Prices are buy prices (0–1) per outcome; they are not real quotes.

/** One market with two outcomes, in Polymarket's own wording; event and sort_order are filled by `event`. */
function market(
  id: string,
  type: string | null,
  title: string,
  liquidity: number | null,
  [a, aBuy]: [string, number | null],
  [b, bBuy]: [string, number | null],
  line: number | null = null,
): SportsMarket {
  return {
    id,
    eventId: '',
    type,
    sortOrder: 0,
    title,
    line,
    liquidity,
    outcomes: [
      { index: 0, label: a, buy: aBuy },
      { index: 1, label: b, buy: bBuy },
    ],
  };
}

const yesNo = (id: string, type: string, title: string, liquidity: number, yes: number, no: number) =>
  market(id, type, title, liquidity, ['Yes', yes], ['No', no]);

type State = Partial<Pick<SportsEvent, 'score' | 'live' | 'ended' | 'period' | 'elapsed'>>;

function event(
  id: string,
  gameId: string | null,
  title: string,
  league: [string, string],
  teams: [string, string][],
  state: State,
  startAt: string,
  markets: SportsMarket[],
): SportsEvent {
  return {
    id,
    gameId,
    title,
    league: { code: league[0], name: league[1] },
    teams: teams.map(([name, abbreviation]) => ({ name, abbreviation })),
    score: state.score ?? null,
    live: state.live ?? null,
    ended: state.ended ?? null,
    period: state.period ?? null,
    elapsed: state.elapsed ?? null,
    startAt,
    markets: markets.map((item, sortOrder) => ({ ...item, eventId: id, sortOrder })),
  };
}

const NBA: [string, string] = ['nba', 'NBA'];
const NHL: [string, string] = ['nhl', 'NHL'];
const EPL: [string, string] = ['epl', 'Premier League'];
const CFB: [string, string] = ['cfb', 'College Football'];
const ATP: [string, string] = ['atp', 'ATP Tour'];
const CS2: [string, string] = ['cs2', 'CS2'];
const TOP14: [string, string] = ['rutopft', 'Top 14'];

const HEAT: [string, string][] = [
  ['Heat', 'mia'],
  ['Hornets', 'cha'],
];
const ARSENAL: [string, string][] = [
  ['Arsenal FC', 'ars'],
  ['Chelsea FC', 'che'],
];
const LIVERPOOL: [string, string][] = [
  ['Liverpool FC', 'liv'],
  ['Everton FC', 'eve'],
];
const HEAT_LIVE: State = { live: true, ended: false, score: '78-71', period: 'Q3', elapsed: '05:12' };
const LIVERPOOL_LIVE: State = { live: true, ended: false, score: '2-0', period: '2H', elapsed: "67'" };

export const DEMO_EVENTS: SportsEvent[] = [
  // Heat vs. Hornets: main event + "Exact Margin" sub-event, same game_id.
  event('sp-nba-1', 'g-nba-1', 'Heat vs. Hornets', NBA, HEAT, HEAT_LIVE, '2026-10-21T23:30:00Z', [
    market('sp-nba-1-ml', 'moneyline', 'Heat vs. Hornets', 412000, ['Heat', 0.62], ['Hornets', 0.39]),
    market('sp-nba-1-s1', 'spreads', 'Spread: Heat (-4.5)', 210000, ['Heat', 0.52], ['Hornets', 0.49], -4.5),
    market('sp-nba-1-s2', 'spreads', 'Spread: Heat (-6.5)', 88000, ['Heat', 0.41], ['Hornets', 0.6], -6.5),
    market('sp-nba-1-t1', 'totals', 'O/U 221.5', 150000, ['Over', 0.5], ['Under', 0.51], 221.5),
    market('sp-nba-1-t2', 'totals', 'O/U 224.5', 60000, ['Over', 0.38], ['Under', 0.63], 224.5),
  ]),
  event('sp-nba-1-em', 'g-nba-1', 'Heat vs. Hornets - Exact Margin', NBA, HEAT, HEAT_LIVE, '2026-10-21T23:30:00Z', [
    yesNo('sp-nba-1-em1', 'exact_margin', 'Heat by 1-5', 21000, 0.24, 0.77),
    yesNo('sp-nba-1-em2', 'exact_margin', 'Heat by 6-10', 18000, 0.21, 0.8),
    market('sp-nba-1-h1', 'first_half_totals', '1H O/U 110.5', 24000, ['Over', 0.47], ['Under', 0.54], 110.5),
  ]),
  event(
    'sp-nba-2',
    'g-nba-2',
    'Lakers vs. Celtics',
    NBA,
    [
      ['Lakers', 'lal'],
      ['Celtics', 'bos'],
    ],
    {},
    '2026-10-22T02:00:00Z',
    [
      market('sp-nba-2-ml', 'moneyline', 'Lakers vs. Celtics', 302500, ['Lakers', 0.43], ['Celtics', 0.58]),
      market('sp-nba-2-s1', 'spreads', 'Spread: Celtics (-3.5)', 120000, ['Celtics', 0.51], ['Lakers', 0.5], -3.5),
      market('sp-nba-2-t1', 'totals', 'O/U 228.5', 98000, ['Over', 0.49], ['Under', 0.52], 228.5),
    ],
  ),
  event(
    'sp-nhl-1',
    'g-nhl-1',
    'Golden Knights vs. Blue Jackets',
    NHL,
    [
      ['Golden Knights', 'vgk'],
      ['Blue Jackets', 'cbj'],
    ],
    { live: false, ended: true, score: '4-2', period: 'F' },
    '2026-10-21T19:00:00Z',
    [
      market(
        'sp-nhl-1-ml',
        'moneyline',
        'Golden Knights vs. Blue Jackets',
        5200,
        ['Golden Knights', 0.99],
        ['Blue Jackets', 0.02],
      ),
    ],
  ),
  event(
    'sp-nhl-2',
    'g-nhl-2',
    'Maple Leafs vs. Canadiens',
    NHL,
    [
      ['Maple Leafs', 'tor'],
      ['Canadiens', 'mtl'],
    ],
    {},
    '2026-10-22T23:00:00Z',
    [
      market(
        'sp-nhl-2-ml',
        'moneyline',
        'Maple Leafs vs. Canadiens',
        186000,
        ['Maple Leafs', 0.55],
        ['Canadiens', 0.46],
      ),
      market(
        'sp-nhl-2-s1',
        'spreads',
        'Spread: Maple Leafs (-1.5)',
        64000,
        ['Maple Leafs', 0.33],
        ['Canadiens', 0.68],
        -1.5,
      ),
      market('sp-nhl-2-t1', 'totals', 'O/U 5.5', 31000, ['Over', 0.64], ['Under', 0.37], 5.5),
      market('sp-nhl-2-t2', 'totals', 'O/U 6.5', 72000, ['Over', 0.48], ['Under', 0.53], 6.5),
    ],
  ),
  event(
    'sp-nhl-3',
    'g-nhl-3',
    'Oilers vs. Flames',
    NHL,
    [
      ['Oilers', 'edm'],
      ['Flames', 'cgy'],
    ],
    { live: true, ended: false, score: '1-1', period: 'P2', elapsed: '08:40' },
    '2026-10-21T20:00:00Z',
    [
      market('sp-nhl-3-ml', 'moneyline', 'Oilers vs. Flames', 143000, ['Oilers', 0.58], ['Flames', 0.43]),
      market('sp-nhl-3-t1', 'totals', 'O/U 5.5', 52000, ['Over', 0.45], ['Under', 0.56], 5.5),
    ],
  ),
  // Arsenal vs. Chelsea: main event (1X2), "More Markets" (same game_id) and "Total Corners"
  // (no game_id; joins by league, team names and start time).
  event('sp-epl-1', 'g-epl-1', 'Arsenal FC vs. Chelsea FC', EPL, ARSENAL, {}, '2026-10-22T19:00:00Z', [
    yesNo('sp-epl-1-ml1', 'moneyline', 'Arsenal FC', 475000, 0.55, 0.46),
    yesNo('sp-epl-1-ml2', 'moneyline', 'Draw (Arsenal FC vs. Chelsea FC)', 200000, 0.24, 0.77),
    yesNo('sp-epl-1-ml3', 'moneyline', 'Chelsea FC', 195000, 0.23, 0.78),
  ]),
  event(
    'sp-epl-1-mm',
    'g-epl-1',
    'Arsenal FC vs. Chelsea FC - More Markets',
    EPL,
    ARSENAL,
    {},
    '2026-10-22T19:00:00Z',
    [
      market('sp-epl-1-s1', 'spreads', 'Arsenal FC (-1.5)', 91000, ['Arsenal FC', 0.31], ['Chelsea FC', 0.7], -1.5),
      market('sp-epl-1-s2', 'spreads', 'Chelsea FC (-1.5)', 12000, ['Chelsea FC', 0.09], ['Arsenal FC', 0.92], -1.5),
      market('sp-epl-1-t1', 'totals', 'O/U 2.5', 233000, ['Over', 0.54], ['Under', 0.47], 2.5),
      market('sp-epl-1-t2', 'totals', 'O/U 3.5', 41000, ['Over', 0.3], ['Under', 0.71], 3.5),
      yesNo('sp-epl-1-btts', 'both_teams_to_score', 'Both Teams to Score', 38000, 0.57, 0.44),
    ],
  ),
  event('sp-epl-1-tc', null, 'Arsenal FC vs. Chelsea FC - Total Corners', EPL, ARSENAL, {}, '2026-10-22T19:00:00Z', [
    market('sp-epl-1-c1', 'total_corners', 'O/U 9.5', 26000, ['Over', 0.52], ['Under', 0.49], 9.5),
    market('sp-epl-1-c2', 'total_corners', 'O/U 10.5', 14000, ['Over', 0.39], ['Under', 0.62], 10.5),
  ]),
  // Liverpool vs. Everton: main event + "Halftime Result" sub-event, same game_id.
  event('sp-epl-2', 'g-epl-2', 'Liverpool FC vs. Everton FC', EPL, LIVERPOOL, LIVERPOOL_LIVE, '2026-10-21T19:30:00Z', [
    yesNo('sp-epl-2-ml1', 'moneyline', 'Liverpool FC', 388000, 0.93, 0.08),
    yesNo('sp-epl-2-ml2', 'moneyline', 'Draw (Liverpool FC vs. Everton FC)', 96000, 0.06, 0.95),
    yesNo('sp-epl-2-ml3', 'moneyline', 'Everton FC', 54000, 0.02, 0.99),
    market('sp-epl-2-t1', 'totals', 'O/U 2.5', 120000, ['Over', 0.62], ['Under', 0.39], 2.5),
  ]),
  event(
    'sp-epl-2-ht',
    'g-epl-2',
    'Liverpool FC vs. Everton FC - Halftime Result',
    EPL,
    LIVERPOOL,
    LIVERPOOL_LIVE,
    '2026-10-21T19:30:00Z',
    [
      yesNo('sp-epl-2-ht1', 'soccer_halftime_result', 'Liverpool FC', 41000, 0.99, 0.02),
      yesNo('sp-epl-2-ht2', 'soccer_halftime_result', 'Draw', 9000, 0.01, 0.995),
      yesNo('sp-epl-2-ht3', 'soccer_halftime_result', 'Everton FC', 7000, 0.01, 0.995),
    ],
  ),
  event(
    'sp-epl-3',
    'g-epl-3',
    'Brentford FC vs. Fulham FC',
    EPL,
    [
      ['Brentford FC', 'bre'],
      ['Fulham FC', 'ful'],
    ],
    { live: false, ended: true, score: '1-1', period: 'FT' },
    '2026-10-21T14:00:00Z',
    [
      yesNo('sp-epl-3-ml1', 'moneyline', 'Brentford FC', 3000, 0.01, 0.995),
      yesNo('sp-epl-3-ml2', 'moneyline', 'Draw (Brentford FC vs. Fulham FC)', 3000, 0.995, 0.01),
      yesNo('sp-epl-3-ml3', 'moneyline', 'Fulham FC', 3000, 0.01, 0.995),
    ],
  ),
  // Rugby also has three Yes/No moneylines; the second game's market title differs from the team
  // name, so its three cells stay "—".
  event(
    'sp-rug-1',
    'g-rug-1',
    'Top 14: Toulon vs Pau',
    TOP14,
    [
      ['Toulon', 'tln'],
      ['Pau', 'pau'],
    ],
    {},
    '2026-10-24T15:00:00Z',
    [
      yesNo('sp-rug-1-ml1', 'moneyline', 'Toulon', 64000, 0.71, 0.3),
      yesNo('sp-rug-1-ml2', 'moneyline', 'Draw', 12000, 0.04, 0.97),
      yesNo('sp-rug-1-ml3', 'moneyline', 'Pau', 41000, 0.27, 0.74),
    ],
  ),
  event(
    'sp-rug-2',
    'g-rug-2',
    'Top 14: La Rochelle vs Union Bordeaux Begles',
    TOP14,
    [
      ['La Rochelle', 'lar'],
      ['Union Bordeaux-Bègles', 'ubb'],
    ],
    {},
    '2026-10-25T19:05:00Z',
    [
      yesNo('sp-rug-2-ml1', 'moneyline', 'La Rochelle', 38000, 0.45, 0.56),
      yesNo('sp-rug-2-ml2', 'moneyline', 'Draw', 9000, 0.05, 0.96),
      yesNo('sp-rug-2-ml3', 'moneyline', 'Union Bordeaux Begles', 36000, 0.52, 0.49),
    ],
  ),
  event(
    'sp-cfb-1',
    'g-cfb-1',
    'Louisiana vs. Texas State',
    CFB,
    [
      ["Ragin' Cajuns", 'ull'],
      ['Bobcats', 'txst'],
    ],
    {},
    '2026-10-24T00:00:00Z',
    [
      market(
        'sp-cfb-1-ml',
        'moneyline',
        'Louisiana vs. Texas State',
        84000,
        ['Louisiana', 0.47],
        ['Texas State', 0.54],
      ),
      market(
        'sp-cfb-1-s1',
        'spreads',
        'Spread: Texas State (-3.5)',
        40000,
        ['Texas State', 0.51],
        ['Louisiana', 0.5],
        -3.5,
      ),
      market('sp-cfb-1-t1', 'totals', 'O/U 55.5', 26000, ['Over', 0.5], ['Under', 0.51], 55.5),
    ],
  ),
  event(
    'sp-cfb-2',
    'g-cfb-2',
    'Wake Forest vs. Louisville',
    CFB,
    [
      ['Wake Forest', 'wake'],
      ['Louisville', 'lou'],
    ],
    {},
    '2026-10-23T23:30:00Z',
    [
      market(
        'sp-cfb-2-ml',
        'moneyline',
        'Wake Forest vs. Louisville',
        61000,
        ['Wake Forest', 0.27],
        ['Louisville', 0.74],
      ),
      market(
        'sp-cfb-2-s1',
        'spreads',
        'Spread: Louisville (-10.5)',
        22000,
        ['Louisville', 0.49],
        ['Wake Forest', 0.52],
        -10.5,
      ),
    ],
  ),
  event(
    'sp-atp-1',
    'g-atp-1',
    'Vienna: Jannik Sinner vs Alexander Zverev',
    ATP,
    [
      ['Jannik Sinner', 'sin'],
      ['Alexander Zverev', 'zve'],
    ],
    { live: true, ended: false, score: '6-4, 2-3', period: 'S2', elapsed: '' },
    '2026-10-21T18:00:00Z',
    [
      market(
        'sp-atp-1-ml',
        'moneyline',
        'Vienna: Jannik Sinner vs Alexander Zverev',
        158000,
        ['Jannik Sinner', 0.81],
        ['Alexander Zverev', 0.2],
      ),
    ],
  ),
  // No game_id and no game to join: a game by itself.
  event(
    'sp-cs2-1',
    null,
    'Counter-Strike: Team Vitality vs FaZe Clan (BO3)',
    CS2,
    [
      ['Team Vitality', 'vit'],
      ['FaZe Clan', 'faze'],
    ],
    {},
    '2026-10-22T15:00:00Z',
    [
      market(
        'sp-cs2-1-ml',
        'moneyline',
        'Counter-Strike: Team Vitality vs FaZe Clan (BO3)',
        97000,
        ['Team Vitality', 0.64],
        ['FaZe Clan', 0.37],
      ),
      market(
        'sp-cs2-1-mh',
        'map_handicap',
        'Map Handicap: Team Vitality (-1.5)',
        18000,
        ['Team Vitality', 0.4],
        ['FaZe Clan', 0.61],
      ),
    ],
  ),
];
