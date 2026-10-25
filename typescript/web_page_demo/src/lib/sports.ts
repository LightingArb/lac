import { useState } from 'react';
import { useT, type Messages } from '../i18n';
import type { IconName } from '../components/ui/Icon';
import type { CategoryItem } from './markets';
import { useLive, type DataMode } from './live';
import { DEMO_EVENTS } from '../data/sports';

// Sports page: games with exactly two teams, grouped by sport → league, priced as odds.

export type SportId =
  | 'soccer'
  | 'basketball'
  | 'hockey'
  | 'football'
  | 'baseball'
  | 'tennis'
  | 'tableTennis'
  | 'esports'
  | 'cricket'
  | 'rugby'
  | 'mma'
  | 'boxing'
  | 'volleyball'
  | 'handball'
  | 'lacrosse'
  | 'darts'
  | 'aussieRules'
  | 'pickleball'
  | 'other';

/**
 * Polymarket gives the league (`sport.sport` on the event) but no sport above it.
 * Built from the league codes of open two-team events in the local lac_data (2026-10-25);
 * a code that is not listed here, or an event without a league, goes to "other".
 */
// prettier-ignore
export const SPORT_LEAGUES: Record<Exclude<SportId, 'other'>, string[]> = {
  soccer: [
    'acle', 'arg', 'argcopa', 'argpn', 'atc', 'auc', 'aus', 'aut', 'aze1', 'aze2', 'bel1', 'bel2', 'bl2', 'bl3',
    'blr1', 'bol1', 'bra', 'bra2', 'bra3', 'brco', 'bul', 'bun', 'canpl', 'cdr', 'chi', 'chi1', 'chi2', 'chl2',
    'clf', 'col', 'col1', 'col2', 'conl', 'cze1', 'den', 'dfb', 'ecu1', 'efa', 'efl', 'egy1', 'el1', 'el2', 'elc',
    'enl', 'epl', 'ere', 'es2', 'es3', 'est1', 'fif', 'fin1', 'fl1', 'fpd', 'fr2', 'grc', 'gre1', 'gtm', 'hr1',
    'hun', 'idn1', 'idn2', 'irl1', 'isl1', 'isp', 'isr', 'itc', 'itsb', 'ja2', 'ja3', 'jap', 'kaz1', 'kor', 'kor2',
    'lal', 'lec', 'ltu1', 'lva1', 'mar1', 'mex', 'mex2', 'mls', 'ned2', 'nirl1', 'nlc', 'nls', 'nor', 'nor2',
    'nwsl', 'par1', 'per1', 'pol', 'por', 'pt2', 'ptc', 'rou1', 'rus', 'sclc', 'scoc', 'scop', 'sea', 'serc', 'skc',
    'slo', 'spl', 'srb', 'sud', 'sui', 'svk1', 'swe', 'swe2', 'tha1', 'trsk', 'tur', 'tur2', 'u20wwc', 'uae1',
    'ucl', 'uel', 'ukr1', 'unl', 'uru1', 'usl1', 'uslc', 'usoc', 'uwcl', 'uwec', 'uzb1', 'ven1', 'wsl', 'wsl2',
  ],
  basketball: [
    'nba', 'wnba', 'euroleague', 'bkaba', 'bkarg', 'bkbbl', 'bkbsl', 'bkcba', 'bkcl', 'bkeurocup', 'bkfibaqam',
    'bkfr1', 'bkgr1', 'bkisrsl', 'bkjpn', 'bkkbl', 'bkkls', 'bkligend', 'bklkl', 'bknbb', 'bknbl', 'bkplk',
    'bkseriea', 'bkvtb',
  ],
  hockey: ['nhl', 'ahl', 'khl', 'shl', 'liiga', 'dehl', 'cehl', 'snhl'],
  football: ['nfl', 'cfb'],
  baseball: ['mlb', 'kbo', 'npb', 'cpbl', 'lmb'],
  tennis: ['atp', 'atp-doubles', 'wta', 'wta-doubles', 'itf'],
  tableTennis: ['wtt', 'setkameua', 'setkamecz', 'setkamemd', 'setkawoua'],
  esports: ['cs2', 'dota2', 'lol', 'val', 'ow', 'sc2', 'r6siege', 'hok', 'mlbb'],
  cricket: [
    'crint', 'cricranji', 'cricmukono', 'criccsat20w', 'cricpsl', 'cricshield', 'cricjcl', 'cricjclt10',
    'crickerala', 'criccoppat10', 'criclcl', 'cricecsbg', 'crictbcl',
  ],
  rugby: ['rutopft', 'ruurc', 'ruprem', 'rlsuper'],
  mma: ['ufc'],
  boxing: ['boxing', 'zuffa'],
  volleyball: [
    'vbefeler', 'vbligueaw', 'vbligueb', 'vbliguea', 'vbbelligaa', 'vbdivisao1', 'vbsuperlega', 'vbbundesliga',
    'vbplusliga', 'vbsuperliga',
  ],
  handball: ['hbbundesliga', 'hbasobal', 'hbhandbold', 'hblnh', 'hbehfcl', 'hbnbi'],
  lacrosse: ['pll', 'wll'],
  darts: ['pdcdarts', 'modus'],
  aussieRules: ['aflw'],
  pickleball: ['ppa-doubles'],
};

/** Sidebar order; "other" is always last. */
export const SPORTS: SportId[] = [...(Object.keys(SPORT_LEAGUES) as Exclude<SportId, 'other'>[]), 'other'];

const SPORT_BY_LEAGUE = new Map(
  Object.entries(SPORT_LEAGUES).flatMap(([sport, leagues]) => leagues.map((code) => [code, sport as SportId])),
);

export function sportOf(league: string | null): SportId {
  return (league !== null && SPORT_BY_LEAGUE.get(league)) || 'other';
}

export const SPORT_ICONS: Record<SportId, IconName> = Object.fromEntries(
  SPORTS.map((sport) => [sport, sport === 'esports' ? 'esports' : 'sports']),
) as Record<SportId, IconName>;

export interface SportsOutcome {
  index: number;
  label: string;
  /** Price to buy this outcome now (0–1); first outcome best_ask, second 1 − first best_bid. */
  buy: number | null;
}

export interface SportsMarket {
  id: string;
  /** The event (議題) the market belongs to; a game can hold several events. */
  eventId: string;
  /** Polymarket `sports_market_type`: moneyline, spreads, totals, or anything else. */
  type: string | null;
  sortOrder: number;
  /** Polymarket's own option name: group_title, or the question when there is none. */
  title: string;
  line: number | null;
  liquidity: number | null;
  outcomes: SportsOutcome[];
}

export interface SportsTeam {
  name: string | null;
  abbreviation: string | null;
  alias?: string | null;
}

/** One Polymarket event with exactly two teams, as the Demo stores it. */
export interface SportsEvent {
  id: string;
  /** Polymarket gameId; null when the source gives none. */
  gameId: string | null;
  title: string;
  league: { code: string | null; name: string | null };
  teams: SportsTeam[];
  score: string | null;
  live: boolean | null;
  ended: boolean | null;
  period: string | null;
  elapsed: string | null;
  /** ISO time of the scheduled start (game_start_at). */
  startAt: string | null;
  markets: SportsMarket[];
}

/**
 * One game (場): its events merged by `mergeGames`. Time, teams, score and status are the
 * representative event's; markets are every open market of every event in the game.
 */
export interface SportsGame {
  /** The representative event's id. */
  id: string;
  title: string;
  league: { code: string | null; name: string | null };
  teams: SportsTeam[];
  score: string | null;
  live: boolean | null;
  ended: boolean | null;
  period: string | null;
  elapsed: string | null;
  startAt: string | null;
  /** Every event of the game, smallest id first. */
  events: { id: string; title: string }[];
  marketCount: number;
  markets: SportsMarket[];
}

export interface LeagueCount {
  code: string | null;
  name: string | null;
  count: number;
}

export type OddsFormat = 'decimal' | 'american';

/** Decimal (European) odds = 1 ÷ buy price, two decimals; e.g. 0.62 → "1.61". */
export function decimalOdds(price: number | null): string | null {
  if (price === null || price <= 0 || price >= 1) return null;
  return (1 / price).toFixed(2);
}

/** American odds from the buy price: above 0.5 negative, below positive, exactly 0.5 is +100; e.g. 0.62 → "-163". */
export function americanOdds(price: number | null): string | null {
  if (price === null || price <= 0 || price >= 1) return null;
  if (price === 0.5) return '+100';
  // Rounded half away from zero, so +x and −x round alike.
  if (price > 0.5) return `-${Math.round((price / (1 - price)) * 100)}`;
  return `+${Math.round(((1 - price) / price) * 100)}`;
}

export function odds(price: number | null, format: OddsFormat): string {
  return (format === 'decimal' ? decimalOdds(price) : americanOdds(price)) ?? '—';
}

const bySortOrder = (a: SportsMarket, b: SportsMarket) =>
  a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Polymarket ids are digit strings: shorter is smaller, then text order. */
export function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

const pairKey = (event: SportsEvent) => {
  const [a, b] = [event.teams[0]?.name, event.teams[1]?.name];
  if (a == null || b == null || event.startAt === null) return null;
  return JSON.stringify([event.league.code ?? '', ...[a, b].sort(), event.startAt]);
};

/**
 * Events → games. The same game_id is one game. An event without game_id joins the one game
 * (built from game_id) with the same league code, the same two team names in any order and the
 * same start time on any of its events; with no such game or more than one, it is a game by itself.
 * Titles are never compared. Same rule as the Live SQL (SPORTS_GROUPS).
 */
export function mergeGames(events: SportsEvent[]): SportsGame[] {
  const byPair = new Map<string, Set<string>>();
  for (const event of events) {
    const key = pairKey(event);
    if (event.gameId !== null && key !== null) byPair.set(key, (byPair.get(key) ?? new Set()).add(event.gameId));
  }
  const groups = new Map<string, SportsEvent[]>();
  for (const event of events) {
    const joined = event.gameId === null ? [...(byPair.get(pairKey(event) ?? '') ?? [])] : [];
    const key = event.gameId !== null ? `g:${event.gameId}` : joined.length === 1 ? `g:${joined[0]}` : `e:${event.id}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()].map((members) => {
    members.sort((a, b) => compareIds(a.id, b.id));
    const rep = members.find((event) => event.markets.some((m) => m.type === 'moneyline')) ?? members[0];
    const markets = members.flatMap((event) => event.markets);
    return {
      id: rep.id,
      title: rep.title,
      league: rep.league,
      teams: rep.teams,
      score: rep.score,
      live: rep.live,
      ended: rep.ended,
      period: rep.period,
      elapsed: rep.elapsed,
      startAt: rep.startAt,
      events: members.map((event) => ({ id: event.id, title: event.title })),
      marketCount: markets.length,
      markets,
    };
  });
}

/** The Demo's events merged into games, the same way the Live reader merges the database's. */
export const DEMO_GAMES: SportsGame[] = mergeGames(DEMO_EVENTS);

/** All moneyline markets in Polymarket order: one with two team outcomes, or three Yes/No markets (1X2). */
export function moneylines(markets: SportsMarket[]): SportsMarket[] {
  return markets.filter((m) => m.type === 'moneyline').sort(bySortOrder);
}

const isYesNo = (market: SportsMarket) =>
  market.outcomes.length === 2 &&
  market.outcomes.some((o) => o.label === 'Yes') &&
  market.outcomes.some((o) => o.label === 'No');

/**
 * A game with exactly three moneyline markets, all Yes/No (soccer, rugby…), shows one row of three
 * cells: team 1 / draw / team 2, each the market's Yes. The market whose title names only team 1
 * (name or alias, not team 2) is cell 1, only team 2 is cell 3, the remaining one is the draw.
 * Not exactly that: three nulls ("—"). Any other moneyline shape: null.
 */
export function threeWay(game: Pick<SportsGame, 'teams' | 'markets'>): (SportsOutcome | null)[] | null {
  const markets = moneylines(game.markets);
  if (markets.length !== 3 || !markets.every(isYesNo)) return null;
  const names = (team: SportsTeam | undefined) =>
    [team?.name, team?.alias].filter((name): name is string => name != null && name !== '');
  const [first, second] = [names(game.teams[0]), names(game.teams[1])];
  const hits = (market: SportsMarket, team: string[]) => team.some((name) => market.title.includes(name));
  const one = markets.filter((m) => hits(m, first) && !hits(m, second));
  const two = markets.filter((m) => hits(m, second) && !hits(m, first));
  if (one.length !== 1 || two.length !== 1) return [null, null, null];
  const draw = markets.find((m) => m !== one[0] && m !== two[0])!;
  const yes = (market: SportsMarket) => market.outcomes.find((o) => o.label === 'Yes') ?? null;
  return [yes(one[0]), yes(draw), yes(two[0])];
}

/** The list shows one line per spreads / totals: the largest liquidity, then sort_order (unknown liquidity is smallest). */
export function mainLine(markets: SportsMarket[], type: 'spreads' | 'totals'): SportsMarket | null {
  const lines = markets.filter((m) => m.type === type);
  lines.sort((a, b) => (b.liquidity ?? -Infinity) - (a.liquidity ?? -Infinity) || bySortOrder(a, b));
  return lines[0] ?? null;
}

export interface MarketGroups {
  moneyline: SportsMarket[];
  spreads: SportsMarket[];
  totals: SportsMarket[];
  other: SportsMarket[];
}

/** Detail view: every open market, grouped by type, each group in Polymarket order. */
export function groupMarkets(markets: SportsMarket[]): MarketGroups {
  const sorted = [...markets].sort(bySortOrder);
  return {
    moneyline: sorted.filter((m) => m.type === 'moneyline'),
    spreads: sorted.filter((m) => m.type === 'spreads'),
    totals: sorted.filter((m) => m.type === 'totals'),
    other: sorted.filter((m) => m.type !== 'moneyline' && m.type !== 'spreads' && m.type !== 'totals'),
  };
}

/**
 * "Other" markets under one sub-heading per event, in the game's event order. The heading is the
 * event title, without the representative title when it starts with it ("… - Total Corners" → "Total Corners").
 */
export function otherByEvent(game: SportsGame): { eventId: string; heading: string; markets: SportsMarket[] }[] {
  const other = groupMarkets(game.markets).other;
  return game.events
    .map((event) => ({
      eventId: event.id,
      heading: event.title.startsWith(`${game.title} - `) ? event.title.slice(game.title.length + 3) : event.title,
      markets: other.filter((m) => m.eventId === event.id),
    }))
    .filter((group) => group.markets.length > 0);
}

/** 0 in play, 1 not started (or unknown), 2 ended. `live=true` wins over `ended`, as on screen. */
export function statusRank(game: Pick<SportsGame, 'live' | 'ended'>): 0 | 1 | 2 {
  if (game.live === true) return 0;
  if (game.ended === true) return 2;
  return 1;
}

/**
 * In play first, then by start time (unknown last), ended last, all from the representative event;
 * its event_id breaks ties. Same order as the Live SQL.
 */
export function compareGames(a: SportsGame, b: SportsGame): number {
  const rank = statusRank(a) - statusRank(b);
  if (rank) return rank;
  const at = a.startAt === null ? Infinity : Date.parse(a.startAt);
  const bt = b.startAt === null ? Infinity : Date.parse(b.startAt);
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Search: the title of any event in the game, or either team's name. */
export function matchesQuery(game: SportsGame, query: string): boolean {
  const q = query.trim().toLowerCase();
  return (
    q === '' ||
    game.events.some((event) => event.title.toLowerCase().includes(q)) ||
    game.teams.some((team) => team.name != null && team.name.toLowerCase().includes(q))
  );
}

export function leagueCounts(games: SportsGame[]): LeagueCount[] {
  const counts = new Map<string | null, LeagueCount>();
  for (const game of games) {
    const item = counts.get(game.league.code) ?? { code: game.league.code, name: game.league.name, count: 0 };
    item.count += 1;
    counts.set(game.league.code, item);
  }
  return [...counts.values()];
}

/** Sidebar selection: everything, one sport (with its leagues opened below it), or one league. */
export type SportsFilter = { sport: SportId | null; league: string | null | undefined };
export const ALL_SPORTS: SportsFilter = { sport: null, league: undefined };

const LEAGUE_PREFIX = 'league:';
const SPORT_PREFIX = 'sport:';

export function filterFromId(id: string): SportsFilter {
  if (id.startsWith(SPORT_PREFIX)) return { sport: id.slice(SPORT_PREFIX.length) as SportId, league: undefined };
  if (id.startsWith(LEAGUE_PREFIX)) {
    const code = id.slice(LEAGUE_PREFIX.length) || null;
    return { sport: sportOf(code), league: code };
  }
  return ALL_SPORTS;
}

/** League codes the current filter covers; null means every league. An event without a league is ''. */
export function filterLeagues(filter: SportsFilter, leagues: LeagueCount[]): string[] | null {
  if (filter.league !== undefined) return [filter.league ?? ''];
  if (filter.sport === null) return null;
  return leagues.filter((l) => sportOf(l.code) === filter.sport).map((l) => l.code ?? '');
}

/** Sports with their game counts; the picked sport lists its leagues under it, largest first. */
export function sportsCategories(
  leagues: LeagueCount[],
  filter: SportsFilter,
  searching: boolean,
  t: Messages,
): CategoryItem[] {
  const total = leagues.reduce((sum, l) => sum + l.count, 0);
  const items: CategoryItem[] = [
    { id: 'all', label: t.sports.all, icon: 'sports', count: total, active: !searching && filter.sport === null },
  ];
  for (const sport of SPORTS) {
    const own = leagues.filter((l) => sportOf(l.code) === sport);
    if (!own.length) continue;
    items.push({
      id: SPORT_PREFIX + sport,
      label: t.sports.names[sport],
      icon: SPORT_ICONS[sport],
      count: own.reduce((sum, l) => sum + l.count, 0),
      active: !searching && filter.sport === sport && filter.league === undefined,
    });
    if (filter.sport !== sport) continue;
    own.sort(
      (a, b) =>
        b.count - a.count || (a.name ?? '').localeCompare(b.name ?? '') || (a.code ?? '').localeCompare(b.code ?? ''),
    );
    for (const league of own) {
      items.push({
        id: LEAGUE_PREFIX + (league.code ?? ''),
        label: league.name ?? t.sports.unknownLeague,
        icon: SPORT_ICONS[sport],
        count: league.count,
        active: !searching && filter.league !== undefined && filter.league === league.code,
        depth: 1,
      });
    }
  }
  return items;
}

/** One output row of the Live market query: one outcome of one open market. */
export interface LiveSportsRow {
  event_id: string;
  market_id: string;
  sports_market_type: string | null;
  sort_order: number;
  group_title: string | null;
  question: string;
  line: string | null;
  liquidity: string | null;
  outcome_index: number;
  label: string;
  buy: string | null;
}

/** One game from the Live reader: the representative event's fields plus every event of the game. */
export interface LiveSportsGame {
  event_id: string;
  title: string;
  league_code: string | null;
  league_name: string | null;
  teams: SportsTeam[];
  score: string | null;
  live: boolean | null;
  ended: boolean | null;
  period: string | null;
  elapsed: string | null;
  game_start_at: string | null;
  events: { event_id: string; title: string }[];
  market_count: number;
}

const number = (value: string | null) => (value === null ? null : Number(value));

/** Published rows mapped into the same model as the Demo games; rows of other games are skipped. */
export function liveSportsGame(game: LiveSportsGame, rows: LiveSportsRow[]): SportsGame {
  const members = new Set(game.events.map((event) => event.event_id));
  const markets = new Map<string, SportsMarket>();
  for (const row of rows) {
    if (!members.has(row.event_id)) continue;
    let market = markets.get(row.market_id);
    if (!market) {
      market = {
        id: row.market_id,
        eventId: row.event_id,
        type: row.sports_market_type,
        sortOrder: row.sort_order,
        title: row.group_title || row.question,
        line: number(row.line),
        liquidity: number(row.liquidity),
        outcomes: [],
      };
      markets.set(row.market_id, market);
    }
    market.outcomes.push({ index: row.outcome_index, label: row.label, buy: number(row.buy) });
  }
  for (const market of markets.values()) market.outcomes.sort((a, b) => a.index - b.index);
  return {
    id: game.event_id,
    title: game.title,
    league: { code: game.league_code, name: game.league_name },
    teams: game.teams,
    score: game.score,
    live: game.live,
    ended: game.ended,
    period: game.period,
    elapsed: game.elapsed,
    startAt: game.game_start_at,
    events: game.events.map((event) => ({ id: event.event_id, title: event.title })),
    marketCount: game.market_count,
    markets: [...markets.values()],
  };
}

interface SportsPaging {
  scope: string;
  cursors: (string | null)[];
  selected: string | null;
}

export interface SportsWorkspace {
  categories: CategoryItem[];
  games: SportsGame[];
  selected: SportsGame | null;
  loading: boolean;
  /** Live: a game is picked and its markets are on the way. */
  detailLoading: boolean;
  error: string | null;
  searching: boolean;
  label: string;
  page: number;
  hasNext: boolean;
  next: () => void;
  previous: () => void;
  pick: (game: SportsGame) => void;
  pickCategory: (id: string) => void;
}

/** Demo filters the built-in games here; Live asks the reader for one page at a time. */
export function useSportsWorkspace(enabled: boolean, dataMode: DataMode, query: string): SportsWorkspace | null {
  const t = useT();
  const live = enabled && dataMode === 'live';
  const [filter, setFilter] = useState<SportsFilter>(ALL_SPORTS);
  const searching = query.trim() !== '';

  const leagueData = useLive<{ leagues: LeagueCount[] }>(live ? '/api/live/sports/leagues' : null, 600000);
  const leagues = live ? (leagueData.data?.leagues ?? []) : leagueCounts(DEMO_GAMES);
  const covered = searching ? null : filterLeagues(filter, leagues);
  // Pages and the picked game belong to one mode, filter and search; any change starts from the first page.
  const scope = `${dataMode}:${query}:${covered?.join(',') ?? '*'}`;
  const initial: SportsPaging = { scope, cursors: [null], selected: null };
  const [stored, setStored] = useState<SportsPaging>(initial);
  const paging = stored.scope === scope ? stored : initial;
  const patch = (value: Partial<SportsPaging>) => setStored({ ...paging, ...value });
  const cursor = paging.cursors.at(-1);
  const selectedId = paging.selected;

  const params = new URLSearchParams();
  for (const code of covered ?? []) params.append('league', code);
  if (searching) params.set('q', query.trim().slice(0, 200));
  if (cursor) params.set('cursor', cursor);
  // A sport with no league in the data has nothing to ask for.
  const requested = live && !!leagueData.data && (covered === null || covered.length > 0);
  const list = useLive<{ games: LiveSportsGame[]; markets: LiveSportsRow[]; next: string | null }>(
    requested ? `/api/live/sports/games?${params}` : null,
    30000,
  );
  const liveGames = list.data?.games.map((game) => liveSportsGame(game, list.data!.markets)) ?? [];
  const demoGames = DEMO_GAMES.filter((game) =>
    searching ? matchesQuery(game, query) : covered === null || covered.includes(game.league.code ?? ''),
  ).sort(compareGames);
  const games = live ? liveGames : demoGames;
  const chosen = selectedId ?? games[0]?.id ?? null;
  const detail = useLive<{ game: LiveSportsGame; markets: LiveSportsRow[] }>(
    live && chosen ? `/api/live/sports/game?id=${chosen}` : null,
    30000,
  );

  if (!enabled) return null;
  const selected = live
    ? detail.data && detail.data.game.event_id === chosen
      ? liveSportsGame(detail.data.game, detail.data.markets)
      : null
    : (games.find((game) => game.id === chosen) ?? null);
  const label = searching
    ? t.common.search
    : filter.league !== undefined
      ? (leagues.find((l) => l.code === filter.league)?.name ?? t.sports.unknownLeague)
      : filter.sport
        ? t.sports.names[filter.sport]
        : t.sports.all;

  return {
    categories: sportsCategories(leagues, filter, searching, t),
    games,
    selected,
    loading: live && !leagueData.error && (!leagueData.data || (requested && !list.data && !list.error)),
    detailLoading: live && !!chosen && !selected && !detail.error,
    error: live ? (leagueData.error ?? list.error ?? detail.error) : null,
    searching,
    label,
    page: paging.cursors.length,
    hasNext: live && !!list.data?.next,
    next: () => {
      if (list.data?.next) patch({ cursors: [...paging.cursors, list.data.next], selected: null });
    },
    previous: () => patch({ cursors: paging.cursors.slice(0, -1), selected: null }),
    pick: (game) => patch({ selected: game.id }),
    pickCategory: (id) => setFilter(filterFromId(id)),
  };
}
