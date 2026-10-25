import { canSee, type Access } from '../data/backend';
import type { SportsSignal } from '../data/sportsSignals';
import type { Messages } from '../i18n/en';
import type { PricedSignal } from './markets';
import { SPORTS, otherByEvent, type SportId, type SportsGame } from './sports';

// Sports page for subscribers: the ROI in front of a cell's odds, the cards in the signals column, and for the
// sports the customer doesn't hold only how many signals there are.

export type SignalState = 'shown' | 'locked' | 'hidden';

/**
 * A usable signal is active, has EV above 0 and is still before valid_until; anything else is never shown or
 * counted. A usable one is shown when the customer holds its sport (`canSee`, the Signal page's check), else locked.
 */
export function signalState(signal: SportsSignal, access: Access, now: number): SignalState {
  if (signal.status !== 'active' || !(signal.ev > 0) || !(now < Date.parse(signal.validUntil))) return 'hidden';
  return canSee(access, 'sport', signal.sport) ? 'shown' : 'locked';
}

/** One odds cell: one outcome of one market. */
export const oddsCell = (marketId: string, outcomeIndex: number) => `${marketId}/${outcomeIndex}`;

const signalCell = (signal: SportsSignal) => oddsCell(signal.marketId, signal.side === 'YES' ? 0 : 1);

export interface SportsSignals {
  shown: SportsSignal[];
  /** Sports not held that have usable signals now, in sidebar order: a count each, never which game or side. */
  locked: { sport: SportId; count: number }[];
  /** ROI of each cell with a shown signal. */
  roi: Record<string, number>;
}

export function sportsSignals(signals: SportsSignal[], access: Access, now: number): SportsSignals {
  const shown = signals.filter((s) => signalState(s, access, now) === 'shown');
  const locked = signals.filter((s) => signalState(s, access, now) === 'locked');
  const counts = SPORTS.map((sport) => ({ sport, count: locked.filter((s) => s.sport === sport).length }));
  return {
    shown,
    locked: counts.filter((item) => item.count > 0),
    roi: Object.fromEntries(shown.map((s) => [signalCell(s), s.roi])),
  };
}

/** What the odds cells show: each cell's ROI (by `oddsCell`), and the cell of the card picked in the signals column. */
export interface CellMarks {
  roi: Record<string, number>;
  picked: { marketId: string; outcomeIndex: number } | null;
}

export const NO_MARKS: CellMarks = { roi: {}, picked: null };

export const isPicked = (marks: CellMarks, marketId: string, outcomeIndex: number) =>
  marks.picked?.marketId === marketId && marks.picked.outcomeIndex === outcomeIndex;

/** The picked card marks its cell only while its game is the one open. */
export function cellMarks(
  view: SportsSignals,
  picked: SportsSignal | undefined,
  selected: SportsGame | null,
): CellMarks {
  const open = !!picked && !!selected?.markets.some((m) => m.id === picked.marketId);
  return {
    roi: view.roi,
    picked: open ? { marketId: picked!.marketId, outcomeIndex: picked!.side === 'YES' ? 0 : 1 } : null,
  };
}

/** The game a signal belongs to: the one holding its event (sub-events join their game). */
export function gameOf(signal: SportsSignal, games: SportsGame[]): SportsGame | undefined {
  return games.find((game) => game.events.some((event) => event.id === signal.eventId));
}

/**
 * The Signal page's card for one shown signal: "Sport · Soccer", the game with the market as Polymarket names it
 * (and the sub-event's own heading for "other" markets, e.g. Total Corners), and the outcome bought.
 */
export function signalCard(signal: SportsSignal, game: SportsGame, t: Messages, now: number): PricedSignal {
  const market = game.markets.find((m) => m.id === signal.marketId)!;
  const index = signal.side === 'YES' ? 0 : 1;
  const heading = otherByEvent(game).find((part) => part.markets.includes(market))?.heading;
  const title = [game.title, heading, market.title].filter((part, i) => part && (i === 0 || part !== game.title));
  return {
    id: signal.id,
    product: 'sport',
    market: t.sports.names[signal.sport],
    sport: signal.sport,
    title: title.join(' · '),
    sideLabel: market.outcomes[index].label.toUpperCase(),
    side: index === 0 ? 'yes' : 'no',
    eventId: signal.eventId,
    outcomeId: signalCell(signal),
    avg: signal.avgCost,
    depth: signal.depth,
    updatedSec: Math.round((now - Date.parse(signal.evaluatedAt)) / 1000),
    minutesLeft: Math.floor((Date.parse(signal.validUntil) - now) / 60000),
    entry: signal.entry,
    fair: signal.fair,
    ev: signal.ev,
    roi: signal.roi,
  };
}
