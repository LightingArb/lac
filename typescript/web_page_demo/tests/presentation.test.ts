import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/i18n';
import { LiveMatchBoard } from '../src/components/markets/MatchParts';
import { EventCard } from '../src/components/markets/EventCard';
import { historyPath } from '../src/lib/history';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import sample from './live_event.json';
import { liveMatch, liveEvent, type LiveEvent, type LiveOutcome } from '../src/lib/live';
import { cents, chance, multiplier } from '../src/lib/format';
import { EVENTS, SIGNALS } from '../src/data/catalog';
import { DEMO_ACCOUNT, EMPTY_ACCOUNT, type Account } from '../src/data/terminal';
import {
  INITIAL_WORKSPACE,
  deriveWorkspace,
  focusHighlight,
  focusPrediction,
  sideLabel,
  signalCovers,
  type WorkspaceState,
} from '../src/lib/markets';
import {
  accountSummary,
  currentPrice,
  positionPnl,
  positionRow,
  positionValue,
  reservedCash,
  shortAddress,
} from '../src/lib/terminal';
import { TradingTerminal } from '../src/components/terminal/TradingTerminal';
import { SportsList } from '../src/components/sports/SportsList';
import {
  ALL_SPORTS,
  DEMO_GAMES,
  SPORTS,
  SPORT_LEAGUES,
  americanOdds,
  compareGames,
  compareIds,
  decimalOdds,
  filterFromId,
  filterLeagues,
  focusFilter,
  leagueCounts,
  liveSportsGame,
  mainLine,
  matchesQuery,
  mergeGames,
  moneylines,
  odds,
  otherByEvent,
  sportOf,
  sportsCategories,
  threeWay,
  type LiveSportsGame,
  type SportsEvent,
  type SportsGame,
  type SportsMarket,
} from '../src/lib/sports';
import {
  MY_AGENTS,
  REFERRED_TRADERS,
  YOUR_RATE,
  dollars,
  earnings,
  normalizeRate,
  normalizeReferralCode,
  referralLink,
} from '../src/data/referral';
import { AGENT_TREE, flattenTree, lineFees, lineMembers, nodeEarnings } from '../src/data/admin';
import {
  INITIAL_BACKEND,
  backendReducer,
  canSee,
  entitlementStatus,
  memberAccess,
  type Access,
  type Backend,
  type BackendAction,
} from '../src/data/backend';
import { DEMO_SPORTS_SIGNALS, SPORTS_DEMO_NOW, type SportsSignal } from '../src/data/sportsSignals';
import { SignalPanel } from '../src/components/signals/SignalPanel';
import { SportsDetail } from '../src/components/sports/SportsDetail';
import { cellMarks, gameOf, signalCard, signalState, sportsSignals } from '../src/lib/sportsSignals';
import { DEFAULT_HOLDING, DEMO_STOCKS, HOLDINGS, STOCKS_DEMO_TODAY, quarters } from '../src/data/stocks';
import { addDays } from '../src/data/products';
import { CONGRESS_MEMBERS, CONGRESS_TRADES } from '../src/data/congress';
import { DEMO_FUNDS } from '../src/data/funds';
import { StockSelector } from '../src/components/stocks/StockSelector';
import {
  amountText,
  congressMembers,
  dailyCandles,
  dayStart,
  earningsReports,
  formatPrice,
  fundHoldings,
  fundsHolding,
  isoDay,
  latestRange,
  memberTrades,
  openingView,
  rangeBoxes,
  searchFunds,
  searchStocks,
  stockByCode,
  stockSeries,
  tabsFor,
  tradeMarks,
  upside,
  upsideText,
  weekdays,
  weekdaysAfter,
} from '../src/lib/stocks';
import { liveVersion } from '../src/data/products';
import { en } from '../src/i18n/en';
import { zh } from '../src/i18n/zh';
import {
  INITIAL_WITHDRAWALS,
  logText,
  ME,
  balanceOf,
  parseAmount,
  requestWithdrawal,
  reviewWithdrawal,
  validateDraft,
} from '../src/data/withdrawals';

// Captured 2026-10-25T07:15:34Z, event 878226, from the local read-only reader.
test('Live maps each market to its own midpoint, asks, volume and liquidity', () => {
  const mapped = liveEvent(sample.event as LiveEvent, sample.outcomes as LiveOutcome[], sample.marketCount);
  assert.equal(mapped.match, undefined);
  assert.equal(mapped.source, 'live');
  for (const row of mapped.rows) {
    const source = sample.outcomes.filter((o) => o.market_id === row.id);
    const yes = source.find((o) => o.label === 'Yes')!;
    const no = source.find((o) => o.label === 'No')!;
    assert.equal(row.yes, yes.midpoint === null ? null : Number(yes.midpoint));
    assert.equal(row.yesAsk, yes.best_ask === null ? null : Number(yes.best_ask));
    assert.equal(row.noAsk, no.best_ask === null ? null : Number(no.best_ask));
    assert.equal(row.liquidity, Number(yes.liquidity));
    assert.equal(row.vol, Number(yes.volume_total));
  }
});
test('Missing quote values stay null and label matching ignores outcome order', () => {
  const pair = sample.outcomes.slice(0, 2).map((o) => ({ ...o, midpoint: null, best_ask: null }));
  const mapped = liveEvent(sample.event as LiveEvent, pair.reverse() as LiveOutcome[], 1);
  assert.equal(mapped.rows[0].yesAsset, sample.outcomes.find((o) => o.label === 'Yes')!.asset_id);
  assert.equal(mapped.rows[0].yes, null);
  assert.equal(mapped.rows[0].no, null);
  assert.equal(mapped.rows[0].yesAsk, null);
  assert.equal(mapped.rows[0].noAsk, null);
  assert.equal(cents(null), '—');
  assert.equal(chance(null), '—');
  assert.equal(multiplier(null), '—');
  assert.equal(multiplier(0), '—');
  assert.equal(multiplier(0.25), '×4.0');
  assert.equal(mapped.kind, 'binary');
});
test('Referral allocation conserves 100 percent at every allowed direct-agent rate', () => {
  for (let rate = 0; rate <= 80; rate++) {
    assert.equal(20 + (YOUR_RATE - rate) + rate, 100);
    assert.equal(earnings(10000, YOUR_RATE - rate), (80 - rate) * 100);
  }
  assert.equal(normalizeRate(-1), 0);
  assert.equal(normalizeRate(81), 80);
  assert.equal(normalizeRate(55.9), 55);
  const total =
    MY_AGENTS.reduce((sum, a) => sum + earnings(a.feesCents, YOUR_RATE - a.rate), 0) +
    REFERRED_TRADERS.reduce((sum, t) => sum + earnings(t.feesCents, YOUR_RATE), 0);
  assert.equal(dollars(total), '$951.72');
  assert.equal(earnings(3145, 80), 2516);
});
test('Referral code accepts only ASCII letters and digits, uppercases and caps at sixteen', () => {
  assert.equal(normalizeReferralCode('a中b-é!ß12'), 'AB12');
  assert.equal(normalizeReferralCode('1234567890abcdefghij'), '1234567890ABCDEF');
  assert.equal(normalizeReferralCode('中文!'), '');
  assert.equal(referralLink(normalizeReferralCode('new99')), 'https://lac.example/r/NEW99');
});
test('Agent tree shares add up to every builder-fee dollar and match the customer view', () => {
  const nodes = flattenTree(AGENT_TREE).map((r) => r.node);
  assert.equal(nodes.reduce((sum, n) => sum + nodeEarnings(n), 0), lineFees(AGENT_TREE));
  const me = nodes.find((n) => n.code === 'LAC8X2')!;
  for (const agent of MY_AGENTS) {
    const child = me.children.find((c) => c.name === agent.name)!;
    assert.equal(lineFees(child), agent.feesCents);
    assert.equal(lineMembers(child), agent.members);
    assert.equal(child.rate, agent.rate);
  }
  assert.equal(me.ownFeesCents, REFERRED_TRADERS.reduce((sum, t) => sum + t.feesCents, 0));
  assert.equal(dollars(nodeEarnings(me)), '$951.72');
});
test('Withdrawal balance holds open requests and returns rejected ones', () => {
  const start = balanceOf(INITIAL_WITHDRAWALS, ME);
  assert.deepEqual(start, { settled: 284560, pending: 30000, paid: 40000, available: 214560 });
  const draft = { amountCents: parseAmount('100.5'), network: 'usdt-trc20' as const, address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' };
  assert.deepEqual(validateDraft(draft, start.available), {});
  let list = requestWithdrawal(INITIAL_WITHDRAWALS, ME, draft, 'Oct 21, 2026 10:00');
  const id = list[0].id;
  assert.equal(id, 'W-1047');
  assert.equal(balanceOf(list, ME).available, 214560 - 10050);
  // Paying is only allowed after approval.
  assert.equal(reviewWithdrawal(list, id, { type: 'paid', txHash: 'x' }, 'admin', 'now')[0].status, 'pending');
  list = reviewWithdrawal(list, id, { type: 'approve' }, 'admin', 'now');
  list = reviewWithdrawal(list, id, { type: 'paid', txHash: 'abc' }, 'admin', 'now');
  assert.equal(list[0].status, 'paid');
  assert.equal(list[0].log.length, 3);
  assert.equal(balanceOf(list, ME).paid, 40000 + 10050);
  const rejected = reviewWithdrawal(INITIAL_WITHDRAWALS, 'W-1046', { type: 'reject', reason: 'Test' }, 'admin', 'now');
  assert.equal(balanceOf(rejected, ME).available, start.available + 30000);
  assert.equal(reviewWithdrawal(rejected, 'W-1046', { type: 'approve' }, 'admin', 'now').find((w) => w.id === 'W-1046')!.status, 'rejected');
});
test('Withdrawal form rejects bad amounts and addresses', () => {
  assert.ok(Number.isNaN(parseAmount('1.234')));
  assert.ok(Number.isNaN(parseAmount('')));
  assert.equal(parseAmount('50'), 5000);
  const base = { network: 'usdc-polygon' as const, address: '0x8f3a5c21b9e04d7a6c1f2e9b0d4a7c3e5f6141c2' };
  assert.equal(validateDraft({ ...base, amountCents: 4999 }, 100000).amount, 'min');
  assert.equal(validateDraft({ ...base, amountCents: 100001 }, 100000).amount, 'max');
  assert.equal(validateDraft({ ...base, amountCents: NaN }, 100000).amount, 'empty');
  assert.equal(validateDraft({ ...base, amountCents: 5000, address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' }, 100000).address, 'invalid');
  assert.deepEqual(validateDraft({ ...base, amountCents: 5000 }, 100000), {});
});
test('Chinese copy covers every English key and formats demo dates and sides', () => {
  const keys = (o: object, prefix = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  assert.deepEqual(keys(zh).sort(), keys(en).sort());
  assert.equal(zh.date('Oct 19, 2026 21:14'), '2026/10/19 21:14');
  assert.equal(zh.date('Oct 1, 2026'), '2026/10/1');
  assert.equal(zh.date('Oct 29'), '10/29');
  assert.equal(zh.date('—'), '—');
  assert.equal(zh.side('Up'), '漲');
  assert.equal(zh.side('YES'), '是');
  assert.equal(zh.side('Arsenal'), 'Arsenal');
  assert.equal(en.side('Up'), 'Up');
  const w = INITIAL_WITHDRAWALS.find((x) => x.id === 'W-1041')!;
  assert.deepEqual(w.log.map((entry) => logText(en, w, entry)), ['Requested $250.00', `Rejected: ${w.reason}`]);
  assert.deepEqual(w.log.map((entry) => logText(zh, w, entry)), ['申請提領 $250.00', `駁回：${w.reason}`]);
});
test('Back office: publishing keeps old buyers on their version, upgrades and refunds follow the rules', () => {
  const run = (b: Backend, a: BackendAction) => backendReducer(b, { ...a, at: 'Oct 22, 2026 10:00' });
  let b = run(INITIAL_BACKEND, { type: 'reviewItem', id: 'baseball', approve: true });
  assert.equal(b.items.find((i) => i.id === 'baseball')!.status, 'approved');
  assert.equal(liveVersion(b.versions, 'sport').id, 'sport-v2');

  b = run(b, { type: 'publish', product: 'sport', items: ['soccer', 'basketball', 'baseball'], prices: {} });
  assert.equal(liveVersion(b.versions, 'sport').id, 'sport-v3');
  assert.equal(b.versions.find((v) => v.id === 'sport-v2')!.retiredOn, '2026-10-22');
  // Rosa bought v2 and keeps it untouched.
  const rosa = b.entitlements.find((e) => e.member === 'ROSAM')!;
  assert.equal(rosa.versionId, 'sport-v2');
  assert.equal(entitlementStatus(rosa), 'active');

  b = run(b, { type: 'upgrade', id: rosa.id });
  assert.equal(b.entitlements.find((e) => e.id === rosa.id)!.versionId, 'sport-v3');
  assert.equal(b.entitlements.find((e) => e.id === rosa.id)!.expires, rosa.expires);

  b = run(b, { type: 'grant', member: 'MIKAS', product: 'weather', days: 30 });
  const granted = b.entitlements.at(-1)!;
  assert.deepEqual([granted.member, granted.versionId, granted.start, granted.expires, granted.source], ['MIKAS', 'weather-v1', '2026-10-22', '2026-11-21', 'manual']);

  b = run(b, { type: 'setExpiry', id: granted.id, expires: '2026-10-01' });
  assert.equal(b.entitlements.at(-1)!.expires, '2026-11-21', 'an end date before the start is ignored');

  b = run(b, { type: 'refund', id: 'P-2204' });
  assert.equal(b.payments.find((p) => p.id === 'P-2204')!.status, 'refunded');
  assert.equal(entitlementStatus(b.entitlements.find((e) => e.ref === 'P-2204')!), 'revoked');

  b = run(b, { type: 'setMemberStatus', member: 'ALEXC', status: 'suspended' });
  const blocked = run(b, { type: 'reviewWithdrawal', id: 'W-1043', action: { type: 'approve' } });
  assert.equal(blocked.withdrawals.find((w) => w.id === 'W-1043')!.status, 'pending');
  const rejected = run(b, { type: 'reviewWithdrawal', id: 'W-1043', action: { type: 'reject', reason: 'Suspended' } });
  assert.equal(rejected.withdrawals.find((w) => w.id === 'W-1043')!.status, 'rejected');

  assert.deepEqual(
    b.activity.slice(0, 6).map((a) => a.kind),
    ['suspended', 'refunded', 'granted', 'upgraded', 'published', 'approvedItem'],
  );
});

// Synthetic variants exercise presentation branches, not provider parsing.
const sports = (overrides: Partial<LiveEvent> = {}): LiveEvent => ({
  ...sample.event, market_count: 1,
  teams: [{ name: 'Alpha', abbreviation: 'alp' }, { name: 'Beta', abbreviation: 'bet' }],
  score: '1-3', live: true, ended: false, period: 'Q4', elapsed: '00:03', game_start_at: '2026-10-25T00:00:00Z',
  moneyline: [{ outcome_index: 0, label: 'Beta', midpoint: '0.25' }, { outcome_index: 1, label: 'Alpha', midpoint: '0.75' }],
  ...overrides,
});
test('Only exactly two teams get a Live scoreboard, preserving source order and raw score', () => {
  assert.equal(liveMatch(sports({ teams: null })), undefined);
  assert.equal(liveMatch(sports({ teams: [] })), undefined);
  assert.equal(liveMatch(sports({ teams: sports().teams!.slice(0, 1) })), undefined);
  assert.equal(liveMatch(sports({ teams: [...sports().teams!, sports().teams![0]] })), undefined);
  const match = liveMatch(sports())!;
  assert.deepEqual(match.teams.map((team) => team.name), ['Alpha', 'Beta']);
  assert.equal(match.score, '1-3');
  assert.deepEqual(match.probabilities, [0.75, 0.25]);
  assert.equal(liveMatch(sports({ score: '' }))!.score, '');
});
test('Moneyline needs both exact names; absent, multiple candidates, or mismatched labels use generic options', () => {
  for (const moneyline of [[], sports().moneyline.slice(0, 1), [...sports().moneyline, ...sports().moneyline],
    sports().moneyline.map((outcome) => ({ ...outcome, label: outcome.label.toLowerCase() }))]) {
    const event = sports({ moneyline });
    assert.equal(liveMatch(event)!.probabilities, null);
    const mapped = liveEvent(event, sample.outcomes as LiveOutcome[], 1);
    const html = renderToStaticMarkup(createElement(EventCard, { event: mapped, selected: false, showPath: false, signalCount: 0, onSelect: () => {} }));
    assert.ok(html.includes('Alpha') && html.includes('Beta') && html.includes('1-3'));
    assert.ok(html.includes('Yes') && html.includes('No'));
  }
  assert.deepEqual(liveMatch(sports({ moneyline: sports().moneyline.map((outcome) => ({ ...outcome, midpoint: null })) }))!.probabilities, [null, null]);
});
test('Live, ended, and unknown sports states render bilingual source status and uppercase abbreviations', () => {
  const render = (event: LiveEvent, language: 'en' | 'zh-Hant') => renderToStaticMarkup(
    createElement(I18nProvider, { language, children: createElement(LiveMatchBoard, { match: liveMatch(event)! }) }));
  const html = render(sports(), 'en');
  assert.ok(html.includes('LIVE') && html.includes('Q4') && html.includes('00:03') && html.includes('1-3'));
  assert.ok(html.includes('ALP') && html.includes('BET'));
  assert.ok(!html.includes('Home') && !html.includes('Away'));
  assert.ok(render(sports({ live: false, ended: true }), 'en').includes('Ended'));
  assert.ok(render(sports({ live: null, ended: true }), 'zh-Hant').includes('已結束'));
  assert.ok(render(sports({ live: null, ended: null }), 'en').includes('Starts'));
  assert.ok(render(sports({ live: null, ended: null }), 'zh-Hant').includes('開賽時間'));
  assert.ok(!render(sports({ live: null, ended: null }), 'en').includes('LIVE'));
});
test('Yes/No label selection carries outcome index into history, even when Yes is second', () => {
  const pair = sample.outcomes.map((outcome) => ({ ...outcome, outcome_index: 1 - outcome.outcome_index }));
  const row = liveEvent(sample.event as LiveEvent, pair as LiveOutcome[], 1).rows[0];
  assert.equal(row.yesIndex, 1);
  assert.equal(row.noIndex, 0);
});
test('Moneyline label may be either team name or alias; anything else uses generic options', () => {
  // College football: team name "Ragin' Cajuns", alias "Louisiana", moneyline label "Louisiana".
  const teams = [
    { name: "Ragin' Cajuns", abbreviation: 'ull', alias: 'Louisiana' },
    { name: 'Bobcats', abbreviation: 'txst', alias: 'Texas State' },
  ];
  const byName = sports({ moneyline: [{ outcome_index: 0, label: 'Beta', midpoint: '0.4' }, { outcome_index: 1, label: 'Alpha', midpoint: '0.6' }] });
  assert.deepEqual(liveMatch(byName)!.probabilities, [0.6, 0.4]);
  const byAlias = sports({ teams, moneyline: [{ outcome_index: 0, label: 'Louisiana', midpoint: '0.47' }, { outcome_index: 1, label: 'Texas State', midpoint: '0.53' }] });
  assert.deepEqual(liveMatch(byAlias)!.probabilities, [0.47, 0.53]);
  const mixed = sports({ teams, moneyline: [{ outcome_index: 0, label: 'Bobcats', midpoint: '0.53' }, { outcome_index: 1, label: 'Louisiana', midpoint: '0.47' }] });
  assert.deepEqual(liveMatch(mixed)!.probabilities, [0.47, 0.53]);
  const neither = sports({ teams, moneyline: [{ outcome_index: 0, label: 'UL Lafayette', midpoint: '0.47' }, { outcome_index: 1, label: 'Texas State', midpoint: '0.53' }] });
  assert.equal(liveMatch(neither)!.probabilities, null);
  const noAlias = sports({ teams: teams.map(({ alias: _alias, ...team }) => team), moneyline: byAlias.moneyline });
  assert.equal(liveMatch(noAlias)!.probabilities, null);
  // One label claimed by both teams is not a match.
  const shared = sports({ teams: [teams[0], { ...teams[1], alias: 'Louisiana' }], moneyline: byAlias.moneyline });
  assert.equal(liveMatch(shared)!.probabilities, null);
});

// What the demo customer holds: the bundle v1 (London, New York, BTC 5m, ETH 15m, EUR/USD, Gold, Soccer).
const ACCESS = memberAccess(INITIAL_BACKEND, 'LAC8X2');
const act = (b: Backend, a: BackendAction) => backendReducer(b, { ...a, at: 'Oct 22, 2026 10:00' });
// Staff grant Sport (v2: soccer and basketball) to the demo customer.
const BOTH_SPORTS = memberAccess(act(INITIAL_BACKEND, { type: 'grant', member: 'LAC8X2', product: 'sport', days: 30 }), 'LAC8X2');
const NO_SPORT: Access = { products: ACCESS.products.filter((p) => p !== 'sport'), sports: [] };

// Trading terminal (Demo account).
const position = (id: string) => DEMO_ACCOUNT.positions.find((p) => p.id === id)!;
test('Terminal summary: equity = cash + position values, available = cash − open buy orders, P/L summed', () => {
  assert.equal(reservedCash(DEMO_ACCOUNT.orders), 220); // 0.54×200 + 0.82×100 + 0.15×200; the sell holds no cash
  assert.deepEqual(accountSummary(DEMO_ACCOUNT), { balance: 920.5, equity: 1891.3, available: 700.5, unrealized: 41.3 });
  const rows = DEMO_ACCOUNT.positions.map((p) => positionRow(p));
  assert.deepEqual(
    rows.map((r) => [r.position.id, r.value, r.pnl!.amount, r.pnl!.percent]),
    [
      ['p1', 210, 30, 16.67],
      ['p2', 63, -12, -16],
      ['p3', 220, 28, 14.58],
      ['p4', 145, 15, 11.54],
      ['p5', 150, 13.5, 9.89],
      ['p6', 76, -14, -15.56],
      ['p7', 52.8, -7.2, -12],
      ['p8', 54, -12, -18.18],
    ],
  );
  assert.deepEqual(rows.filter((r) => r.redeemable).map((r) => r.position.id), ['p5']);
  assert.equal(shortAddress(DEMO_ACCOUNT.address), '0x12ab…89cd');
});
test('Terminal value and P/L follow price; a missing price stays unknown; an empty wallet is all zero', () => {
  assert.equal(positionValue(150, 0.333), 49.95);
  assert.equal(positionValue(10, null), null);
  assert.equal(positionPnl(position('p1'), null), null);
  assert.deepEqual(positionPnl({ ...position('p1'), avgCost: 0 }, 0.42), { amount: 210, percent: null });
  assert.deepEqual(accountSummary(EMPTY_ACCOUNT), { balance: 0, equity: 0, available: 0, unrealized: 0 });
  const cashOnly: Account = { ...EMPTY_ACCOUNT, cash: 120.25 };
  assert.deepEqual(accountSummary(cashOnly), { balance: 120.25, equity: 120.25, available: 120.25, unrealized: 0 });
  for (const language of ['en', 'zh-Hant'] as const) {
    const html = renderToStaticMarkup(createElement(I18nProvider, { language, children: createElement(TradingTerminal, {
      open: true, onToggle: () => {}, account: EMPTY_ACCOUNT, activeId: null, onSelect: () => {} }) }));
    assert.ok(html.includes(language === 'en' ? 'No positions' : '沒有持倉'));
  }
});
test('Demo account is consistent: Demo events, screen prices, enough rows, cash equals the ledger', () => {
  const ids = new Set(EVENTS.map((e) => e.id));
  for (const item of [...DEMO_ACCOUNT.positions, ...DEMO_ACCOUNT.orders, ...DEMO_ACCOUNT.trades.filter((x) => x.eventId)]) {
    assert.ok(ids.has(item.eventId!), `${item.id} uses a Demo event`);
  }
  // Both kinds of position: on an event Signal lists, and on one LAC does not cover.
  const covered = DEMO_ACCOUNT.positions.map((p) => signalCovers(p.eventId, ACCESS));
  assert.ok(covered.includes(true) && covered.includes(false));
  for (const p of DEMO_ACCOUNT.positions.filter((x) => x.settledPrice === undefined)) {
    const event = EVENTS.find((e) => e.id === p.eventId)!;
    const outcome = event.rows.find((r) => r.id === p.outcomeId)!;
    assert.equal(currentPrice(p), p.side === 'yes' ? outcome.yes : outcome.no);
  }
  const rows = DEMO_ACCOUNT.positions.map((p) => positionRow(p));
  assert.ok(rows.length >= 5 && rows.some((r) => r.pnl!.amount > 0) && rows.some((r) => r.pnl!.amount < 0));
  assert.ok(DEMO_ACCOUNT.orders.length >= 3 && new Set(DEMO_ACCOUNT.orders.map((o) => o.action)).size === 2);
  const kinds = new Set(DEMO_ACCOUNT.trades.map((x) => x.kind));
  assert.ok(DEMO_ACCOUNT.trades.length >= 10 && kinds.has('deposit') && kinds.has('redeem'));
  assert.equal(Math.round(DEMO_ACCOUNT.trades.reduce((sum, x) => sum + x.amount, 0) * 100) / 100, DEMO_ACCOUNT.cash);
  const times = DEMO_ACCOUNT.trades.map((x) => Date.parse(x.at));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'trades are newest first');
});
test('Clicking a position: with LAC signals it opens in the Signal columns, without them on Prediction; both mark the cell', () => {
  const open = (state: WorkspaceState) => deriveWorkspace('signal', state, ACCESS, en);
  const predict = (state: WorkspaceState) => deriveWorkspace('prediction', state, ACCESS, en);
  for (const p of DEMO_ACCOUNT.positions.filter((x) => signalCovers(x.eventId, ACCESS))) {
    for (const start of ['trending', 'weather', 'sport'] as const) {
      const before: WorkspaceState = { ...INITIAL_WORKSPACE, signalCategory: start };
      const after = open({ ...before, ...focusHighlight(open(before), p) });
      assert.equal(after.selected!.id, p.eventId);
      assert.ok(after.events.some((e) => e.id === p.eventId), `${p.id} is listed in ${after.activeCategory}`);
      assert.deepEqual([after.highlight!.id, after.highlight!.outcomeId, after.highlight!.side], [p.id, p.outcomeId, p.side]);
    }
  }
  // The US shutdown position has no LAC signal: Signal can't list it, so it opens on Prediction. So does Lakers:
  // LAC has a basketball signal, but the customer holds only soccer.
  const shutdown = position('p8');
  assert.equal(signalCovers(shutdown.eventId, ACCESS), false);
  assert.equal(signalCovers(position('p4').eventId, ACCESS), false);
  assert.equal(signalCovers(position('p4').eventId, BOTH_SPORTS), true);
  assert.ok(!open(INITIAL_WORKSPACE).events.some((e) => e.id === shutdown.eventId));
  for (const start of ['trending', 'finance', 'politics'] as const) {
    const before: WorkspaceState = { ...INITIAL_WORKSPACE, predictionCategory: start, highlightId: 's1' };
    const after = predict({ ...before, ...focusPrediction(before, shutdown) });
    assert.equal(after.selected!.id, 'shutdown');
    assert.equal(after.activeCategory, 'politics', 'the event is not trending, so its own category lists it');
    assert.ok(after.events.some((e) => e.id === 'shutdown'));
    assert.deepEqual([after.highlight!.id, after.highlight!.outcomeId, after.highlight!.side], ['p8', 'yn', 'yes']);
  }
  // Prediction marks only terminal positions, and only on the selected event.
  assert.equal(predict({ ...INITIAL_WORKSPACE, highlightId: 's1', predictionEventId: 'london' }).highlight, null);
  assert.equal(predict({ ...INITIAL_WORKSPACE, highlightId: 'p8', predictionEventId: 'fed' }).highlight, null);
  // The category stays when it lists the event, otherwise Trending.
  const weather = open({ ...INITIAL_WORKSPACE, signalCategory: 'weather' });
  assert.equal(focusHighlight(weather, position('p1')).signalCategory, 'weather');
  assert.equal(focusHighlight(weather, position('p7')).signalCategory, 'trending');
  // Side names follow the event: Yes/No on multi-outcome events, team or Up/Down on binary ones.
  const lakers = EVENTS.find((e) => e.id === 'lakers')!;
  assert.equal(positionRow(position('p4')).sideLabel, 'Celtics');
  assert.equal(sideLabel(lakers, 'no'), 'Celtics');
  assert.equal(positionRow(position('p1')).sideLabel, 'Yes');
  assert.equal(positionRow(position('p6')).sideLabel, 'Up');
});

// Sports page.
const line = (id: string, type: string, liquidity: number | null, sortOrder: number, eventId = 'e'): SportsMarket => ({
  id, eventId, type, sortOrder, title: id, line: null, liquidity, outcomes: [],
});
test('Odds: decimal = 1 ÷ buy price, American by side of 0.5, null shows a dash', () => {
  assert.deepEqual([decimalOdds(0.62), americanOdds(0.62)], ['1.61', '-163']);
  assert.deepEqual([decimalOdds(0.38), americanOdds(0.38)], ['2.63', '+163']);
  assert.deepEqual([decimalOdds(0.5), americanOdds(0.5)], ['2.00', '+100']);
  assert.deepEqual([decimalOdds(0.75), americanOdds(0.75)], ['1.33', '-300']);
  assert.deepEqual([decimalOdds(0.2), americanOdds(0.2)], ['5.00', '+400']);
  assert.deepEqual([decimalOdds(0.001), americanOdds(0.999)], ['1000.00', '-99900']);
  assert.deepEqual([decimalOdds(null), americanOdds(null)], [null, null]);
  assert.equal(odds(null, 'decimal'), '—');
  assert.equal(odds(null, 'american'), '—');
  assert.equal(odds(0.62, 'american'), '-163');
});
test('Second outcome buy price arrives from the reader and maps per outcome in index order, for every event of the game', () => {
  const game: LiveSportsGame = {
    event_id: '9', title: 'A vs. B', league_code: 'nba', league_name: 'NBA', teams: [{ name: 'A', abbreviation: 'a' }, { name: 'B', abbreviation: 'b' }],
    score: null, live: null, ended: null, period: null, elapsed: null, game_start_at: '2026-10-25T00:00:00.000Z',
    events: [{ event_id: '9', title: 'A vs. B' }, { event_id: '10', title: 'A vs. B - More Markets' }], market_count: 2,
  };
  const row = { event_id: '9', market_id: '1', sports_market_type: 'moneyline', sort_order: 0, group_title: '', question: 'A vs. B', line: null, liquidity: '10' };
  // Reader rows for best_bid 0.61 / best_ask 0.62: outcome 0 buys at 0.62, outcome 1 at 1 − 0.61.
  const mapped = liveSportsGame(game, [
    { ...row, outcome_index: 1, label: 'B', buy: '0.39' },
    { ...row, outcome_index: 0, label: 'A', buy: '0.62' },
    { ...row, event_id: '10', market_id: '2', sports_market_type: 'totals', group_title: 'O/U 9.5', outcome_index: 0, label: 'Over', buy: '0.5' },
    { ...row, event_id: '8', market_id: '3', outcome_index: 0, label: 'X', buy: '0.5' },
  ]);
  assert.deepEqual(mapped.markets.map((m) => [m.id, m.eventId]), [['1', '9'], ['2', '10']], 'rows of other games are skipped');
  assert.deepEqual(mapped.events, [{ id: '9', title: 'A vs. B' }, { id: '10', title: 'A vs. B - More Markets' }]);
  assert.equal(mapped.markets[0].title, 'A vs. B', 'empty group_title falls back to the question');
  assert.deepEqual(mapped.markets[0].outcomes, [{ index: 0, label: 'A', buy: 0.62 }, { index: 1, label: 'B', buy: 0.39 }]);
  assert.deepEqual(mapped.markets[0].outcomes.map((o) => odds(o.buy, 'decimal')), ['1.61', '2.56']);
  assert.equal(liveSportsGame(game, [{ ...row, outcome_index: 1, label: 'B', buy: null }]).markets[0].outcomes[0].buy, null);
});

// Sports games: events merged by game_id, then null game_id by league + team names + start time.
const sportsEvent = (id: string, gameId: string | null, overrides: Partial<SportsEvent> = {}): SportsEvent => ({
  id, gameId, title: `Alpha vs. Beta${id.includes('-') ? ` - ${id.split('-')[1]}` : ''}`,
  league: { code: 'epl', name: 'Premier League' },
  teams: [{ name: 'Alpha', abbreviation: 'alp' }, { name: 'Beta', abbreviation: 'bet' }],
  score: null, live: null, ended: null, period: null, elapsed: null, startAt: '2026-10-22T19:00:00Z', markets: [], ...overrides,
});
test('Games: same game_id is one game; a null game_id joins the only matching game, else stands alone', () => {
  const swapped = [{ name: 'Beta', abbreviation: 'bet' }, { name: 'Alpha', abbreviation: 'alp' }];
  const games = mergeGames([
    sportsEvent('100', 'g1'),
    sportsEvent('101-More Markets', 'g1'),
    sportsEvent('102-Total Corners', null, { teams: swapped }), // team order does not matter
    sportsEvent('200', 'g2', { teams: [{ name: 'Gamma', abbreviation: 'gam' }, { name: 'Delta', abbreviation: 'del' }] }),
    sportsEvent('201', 'g3', { teams: [{ name: 'Gamma', abbreviation: 'gam' }, { name: 'Delta', abbreviation: 'del' }] }),
    sportsEvent('202-Total Corners', null, { teams: [{ name: 'Gamma', abbreviation: 'gam' }, { name: 'Delta', abbreviation: 'del' }] }),
    sportsEvent('300-Total Corners', null, { startAt: '2026-10-23T19:00:00Z' }), // different start: no game
    sportsEvent('301-Total Corners', null, { league: { code: 'efa', name: 'FA Cup' } }), // different league: no game
    sportsEvent('302', null), // fields match g1 (titles are never compared): joins
    sportsEvent('400', null, { teams: [{ name: 'Eta', abbreviation: 'eta' }, { name: 'Theta', abbreviation: 'the' }] }),
    sportsEvent('401-Total Corners', null, { teams: [{ name: 'Eta', abbreviation: 'eta' }, { name: 'Theta', abbreviation: 'the' }] }),
  ]);
  const members = (id: string) => games.find((g) => g.events.some((e) => e.id === id))!.events.map((e) => e.id);
  assert.deepEqual(members('100'), ['100', '302', '101-More Markets', '102-Total Corners']);
  assert.deepEqual(members('202-Total Corners'), ['202-Total Corners'], 'two matching games: not joined');
  assert.deepEqual(members('300-Total Corners'), ['300-Total Corners']);
  assert.deepEqual(members('301-Total Corners'), ['301-Total Corners']);
  assert.deepEqual(members('400'), ['400'], 'null events only join a game_id game, never each other');
  assert.deepEqual(members('401-Total Corners'), ['401-Total Corners']);
  assert.equal(games.length, 8, 'g1 (4 events), g2, g3, and five games of one event');
  assert.deepEqual(leagueCounts(games), [{ code: 'epl', name: 'Premier League', count: 7 }, { code: 'efa', name: 'FA Cup', count: 1 }]);
});
test('Games: representative is the event with a moneyline, else the smallest id; lines come from every event', () => {
  const ml = { ...line('ml', 'moneyline', 10, 0, '1000'), outcomes: [] };
  const games = mergeGames([
    sportsEvent('999', 'g', { title: 'Alpha vs. Beta - Exact Margin', live: false, markets: [line('t-small', 'totals', 5, 0, '999')] }),
    sportsEvent('1000', 'g', { title: 'Alpha vs. Beta', live: true, score: '1-0', markets: [ml] }),
    sportsEvent('1001', 'g', { title: 'Alpha vs. Beta - More Markets', markets: [line('s', 'spreads', 7, 0, '1001'), line('t-big', 'totals', 50, 1, '1001')] }),
  ]);
  assert.equal(games.length, 1);
  const [game] = games;
  assert.deepEqual([game.id, game.title, game.live, game.score], ['1000', 'Alpha vs. Beta', true, '1-0']);
  assert.deepEqual(game.events.map((e) => e.id), ['999', '1000', '1001'], 'ids compare as numbers');
  assert.equal(game.marketCount, 4);
  assert.equal(mainLine(game.markets, 'totals')!.id, 't-big', 'main total across events');
  assert.equal(mainLine(game.markets, 'spreads')!.id, 's');
  assert.ok(matchesQuery(game, 'exact margin') && matchesQuery(game, 'beta') && !matchesQuery(game, 'gamma'));
  const noMoneyline = mergeGames([sportsEvent('20', 'h'), sportsEvent('3', 'h')])[0];
  assert.equal(noMoneyline.id, '3', 'no moneyline: smallest id (3 < 20)');
  assert.ok(compareIds('999', '1000') < 0 && compareIds('1000', '1001') < 0);
  // "Other" markets sit under one heading per event; the representative title prefix is dropped.
  const other = mergeGames([
    sportsEvent('1', 'k', { markets: [{ ...ml, eventId: '1' }] }),
    sportsEvent('2', 'k', { title: 'Alpha vs. Beta - Total Corners', markets: [line('c', 'total_corners', 1, 0, '2')] }),
  ])[0];
  assert.deepEqual(otherByEvent(other).map((g) => [g.heading, g.markets.map((m) => m.id)]), [['Total Corners', ['c']]]);
});

// Three Yes/No moneylines: team 1 / draw / team 2.
const yn = (id: string, title: string, yes: number): SportsMarket => ({
  id, eventId: 'e', type: 'moneyline', sortOrder: Number(id), title, line: null, liquidity: null,
  outcomes: [{ index: 0, label: 'Yes', buy: yes }, { index: 1, label: 'No', buy: 1 - yes }],
});
test('Three-way: only-team-1 market, draw, only-team-2 market; the draw title may name both teams', () => {
  const teams = [{ name: 'Stevenage FC', abbreviation: 'ste' }, { name: 'Sheffield Wednesday FC', abbreviation: 'shw' }];
  const cells = threeWay({ teams, markets: [
    yn('2', 'Sheffield Wednesday FC', 0.3), yn('1', 'Draw (Stevenage FC vs. Sheffield Wednesday FC)', 0.28), yn('0', 'Stevenage FC', 0.45),
  ] })!;
  assert.deepEqual(cells.map((c) => c!.outcome.buy), [0.45, 0.28, 0.3]);
  assert.deepEqual(cells.map((c) => c!.market.id), ['0', '1', '2']);
  // Rugby (Top 14): plain "Draw" title.
  const rugby = threeWay({ teams: [{ name: 'Toulon', abbreviation: 'tln' }, { name: 'Pau', abbreviation: 'pau' }],
    markets: [yn('0', 'Toulon', 0.71), yn('1', 'Draw', 0.04), yn('2', 'Pau', 0.27)] })!;
  assert.deepEqual(rugby.map((c) => c!.outcome.buy), [0.71, 0.04, 0.27]);
  // Alias: the market says "Louisiana", the team name is "Ragin' Cajuns".
  const alias = threeWay({ teams: [{ name: "Ragin' Cajuns", abbreviation: 'ull', alias: 'Louisiana' }, { name: 'Bobcats', abbreviation: 'txst', alias: 'Texas State' }],
    markets: [yn('0', 'Texas State', 0.5), yn('1', 'Draw', 0.1), yn('2', 'Louisiana', 0.4)] })!;
  assert.deepEqual(alias.map((c) => c!.outcome.buy), [0.4, 0.1, 0.5]);
});
test('Three-way: anything but exactly three placed cells shows three dashes; other shapes are not three-way', () => {
  const teams = [{ name: 'La Rochelle', abbreviation: 'lar' }, { name: 'Union Bordeaux Bègles', abbreviation: 'ubb' }];
  const dashes = threeWay({ teams, markets: [yn('0', 'La Rochelle', 0.45), yn('1', 'Draw', 0.05), yn('2', 'Union Bordeaux Begles', 0.52)] });
  assert.deepEqual(dashes, [null, null, null]);
  assert.deepEqual(threeWay({ teams, markets: [yn('0', 'La Rochelle', 0.4), yn('1', 'La Rochelle win by 7+', 0.2), yn('2', 'Union Bordeaux Bègles', 0.4)] }),
    [null, null, null], 'two markets name only team 1');
  assert.equal(threeWay({ teams, markets: [yn('0', 'La Rochelle', 0.4), yn('2', 'Union Bordeaux Bègles', 0.6)] }), null);
  const teamOutcome: SportsMarket = { ...yn('3', 'La Rochelle', 0.4), outcomes: [{ index: 0, label: 'La Rochelle', buy: 0.4 }, { index: 1, label: 'Draw', buy: 0.6 }] };
  assert.equal(threeWay({ teams, markets: [teamOutcome, yn('1', 'Draw', 0.05), yn('2', 'Union Bordeaux Bègles', 0.5)] }), null);
  for (const language of ['en', 'zh-Hant'] as const) {
    const game = DEMO_GAMES.find((g) => g.id === 'sp-rug-2')!;
    const html = renderToStaticMarkup(createElement(I18nProvider, { language, children: createElement(SportsList, {
      title: 't', games: [game], emptyText: '', selectedId: null, format: 'decimal', onSelect: () => {} }) }));
    assert.ok(html.includes('LAR') && html.includes('UBB') && html.includes(language === 'en' ? 'Draw' : '和'));
    assert.equal(html.split('>—<').length - 1 >= 3, true, 'three dashes');
  }
});
test('Spreads and totals list the most liquid line, then sort_order; moneylines keep Polymarket order', () => {
  const markets = [
    line('s-small', 'spreads', 10, 0), line('s-big', 'spreads', 500, 3), line('s-tie', 'spreads', 500, 1),
    line('t-unknown', 'totals', null, 0), line('t-one', 'totals', 1, 5),
    line('ml-2', 'moneyline', 5, 2), line('ml-1', 'moneyline', 9, 1), line('other', 'first_half_totals', 9999, 0),
  ];
  assert.equal(mainLine(markets, 'spreads')!.id, 's-tie');
  assert.equal(mainLine(markets, 'totals')!.id, 't-one');
  assert.equal(mainLine([line('t-unknown', 'totals', null, 1), line('t-null', 'totals', null, 0)], 'totals')!.id, 't-null');
  assert.equal(mainLine([line('x', 'moneyline', 1, 0)], 'spreads'), null);
  assert.deepEqual(moneylines(markets).map((m) => m.id), ['ml-1', 'ml-2']);
});
test('League table maps leagues to sports; unknown or missing leagues are Other', () => {
  assert.deepEqual(['nba', 'nhl', 'cfb', 'epl', 'cs2', 'atp', 'setkameua', 'ufc'].map(sportOf),
    ['basketball', 'hockey', 'football', 'soccer', 'esports', 'tennis', 'tableTennis', 'mma']);
  assert.equal(sportOf('not-a-league'), 'other');
  assert.equal(sportOf(null), 'other');
  const all = Object.values(SPORT_LEAGUES).flat();
  assert.equal(new Set(all).size, all.length, 'each league belongs to one sport');
  assert.equal(all.length, 230);
  for (const sport of Object.keys(SPORT_LEAGUES)) assert.ok(en.sports.names[sport as keyof typeof en.sports.names]);

  const leagues = [
    { code: 'nba', name: 'NBA', count: 3 }, { code: 'wnba', name: 'WNBA', count: 5 }, { code: 'epl', name: 'Premier League', count: 2 },
    { code: 'mystery', name: 'Mystery Cup', count: 4 }, { code: null, name: null, count: 1 },
  ];
  const items = sportsCategories(leagues, filterFromId('sport:basketball'), false, en);
  assert.deepEqual(items.map((i) => [i.id, i.count, i.depth ?? 0, i.active]), [
    ['all', 15, 0, false], ['sport:soccer', 2, 0, false], ['sport:basketball', 8, 0, true],
    ['league:wnba', 5, 1, false], ['league:nba', 3, 1, false], ['sport:other', 5, 0, false],
  ]);
  assert.deepEqual(filterLeagues(filterFromId('sport:other'), leagues), ['mystery', '']);
  assert.deepEqual(filterLeagues(filterFromId('league:'), leagues), ['']);
  assert.deepEqual(filterLeagues(filterFromId('league:nba'), leagues), ['nba']);
  assert.equal(filterLeagues(filterFromId('all'), leagues), null);
  const other = sportsCategories(leagues, filterFromId('league:'), false, en);
  assert.deepEqual(other.filter((i) => i.depth).map((i) => [i.label, i.active]), [['Mystery Cup', false], ['No league', true]]);
});
test('Games sort in play first, then by start time (unknown last), ended last', () => {
  const g = (id: string, live: boolean | null, ended: boolean | null, startAt: string | null) =>
    ({ ...DEMO_GAMES[0], id, live, ended, startAt }) as SportsGame;
  const games = [
    g('9', false, true, '2026-10-20T00:00:00Z'), g('8', null, null, null), g('7', null, null, '2026-10-23T00:00:00Z'),
    g('6', true, false, '2026-10-21T10:00:00Z'), g('5', null, null, '2026-10-22T00:00:00Z'), g('4', true, true, '2026-10-21T09:00:00Z'),
    g('3', false, false, '2026-10-22T00:00:00Z'),
  ];
  assert.deepEqual([...games].sort(compareGames).map((x) => x.id), ['4', '6', '3', '5', '7', '8', '9']);
});
test('Demo Sports data: three or more leagues, ten or more games, every state, some lines missing, merged sub-events', () => {
  assert.ok(leagueCounts(DEMO_GAMES).length >= 3 && DEMO_GAMES.length >= 10);
  assert.ok(DEMO_GAMES.filter((x) => x.events.length > 1).length >= 2, 'games with sub-events');
  const arsenal = DEMO_GAMES.find((x) => x.id === 'sp-epl-1')!;
  assert.deepEqual(arsenal.events.map((e) => e.id), ['sp-epl-1', 'sp-epl-1-mm', 'sp-epl-1-tc'], 'Total Corners joins without game_id');
  assert.deepEqual(threeWay(arsenal)!.map((c) => c!.outcome.buy), [0.55, 0.24, 0.23]);
  assert.equal(mainLine(arsenal.markets, 'spreads')!.eventId, 'sp-epl-1-mm');
  assert.ok(DEMO_GAMES.find((x) => x.id === 'sp-cs2-1')!.events.length === 1, 'no game_id, no match: alone');
  assert.ok(DEMO_GAMES.some((x) => x.live === true) && DEMO_GAMES.some((x) => x.ended === true));
  assert.ok(DEMO_GAMES.some((x) => x.live !== true && x.ended !== true));
  assert.ok(DEMO_GAMES.some((x) => !mainLine(x.markets, 'spreads')) && DEMO_GAMES.some((x) => !mainLine(x.markets, 'totals')));
  assert.ok(DEMO_GAMES.every((x) => x.teams.length === 2 && x.markets.every((m) => m.outcomes.length === 2)));
});

// Signals for subscribers: what the demo customer holds decides which sports they see.
test('Access comes from the versions held: the bundle v1 gives every product but only soccer for Sport', () => {
  assert.deepEqual(ACCESS, { products: ['weather', 'crypto', 'forex', 'future', 'sport'], sports: ['soccer'] });
  assert.deepEqual(BOTH_SPORTS.sports, ['soccer', 'basketball'], 'granting Sport adds v2: soccer and basketball');
  const revoked = memberAccess(act(INITIAL_BACKEND, { type: 'revoke', id: 'E-302' }), 'LAC8X2');
  assert.deepEqual(revoked, { products: [], sports: [] });
  assert.deepEqual(memberAccess(INITIAL_BACKEND, 'LAC8X2', '2026-12-03'), { products: [], sports: [] }, 'expired');
  assert.ok(canSee(ACCESS, 'weather', null) && canSee(ACCESS, 'sport', 'soccer'));
  assert.ok(!canSee(ACCESS, 'sport', 'basketball') && !canSee(ACCESS, 'sport', null) && !canSee(revoked, 'weather', null));
});
test('Signal page: sport signals and events follow the sports held, by the same check as the Sports page', () => {
  const sportIds = (access: Access) =>
    deriveWorkspace('signal', INITIAL_WORKSPACE, access, en).signals.filter((s) => s.product === 'sport').map((s) => s.id);
  assert.deepEqual(sportIds(ACCESS), ['s8', 's9']);
  assert.deepEqual(sportIds(BOTH_SPORTS), ['s8', 's9', 's10']);
  assert.deepEqual(sportIds(NO_SPORT), []);
  const sport = (access: Access) => deriveWorkspace('signal', { ...INITIAL_WORKSPACE, signalCategory: 'sport' }, access, en);
  assert.deepEqual(sport(ACCESS).events.map((e) => e.id), ['arsenal'], 'Lakers (basketball) is not listed');
  assert.deepEqual(sport(BOTH_SPORTS).events.map((e) => e.id), ['arsenal', 'lakers']);
  assert.ok(!sport(NO_SPORT).categories.some((c) => c.id === 'sport'));
  assert.equal(sport(NO_SPORT).activeCategory, 'trending');
  for (const s of SIGNALS.filter((x) => x.product === 'sport')) {
    assert.equal(s.sport, EVENTS.find((e) => e.id === s.eventId)!.lac!.sport, `${s.id} carries its event's sport`);
  }
  // ROI on the cards is the signal's own: fair ÷ entry − 1.
  const s1 = deriveWorkspace('signal', INITIAL_WORKSPACE, ACCESS, en).signals.find((s) => s.id === 's1')!;
  assert.equal(s1.roi, 0.54 / 0.42 - 1);
});

const NOW = Date.parse(SPORTS_DEMO_NOW);
const signal = (id: string) => DEMO_SPORTS_SIGNALS.find((s) => s.id === id)!;
const renderIn = (language: 'en' | 'zh-Hant', element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nProvider, { language, children: element }));
test('Sports ROI shows only for a held sport, active, EV above 0 and before valid_until; missing any one hides it', () => {
  const ok = signal('sg-1');
  const variant = (overrides: Partial<SportsSignal>) => signalState({ ...ok, ...overrides }, ACCESS, NOW);
  assert.equal(signalState(ok, ACCESS, NOW), 'shown');
  assert.equal(variant({ sport: 'basketball' }), 'locked', 'not held: counted, never shown');
  assert.equal(signalState(ok, NO_SPORT, NOW), 'locked');
  assert.equal(variant({ status: 'stale' }), 'hidden');
  assert.equal(variant({ ev: 0 }), 'hidden');
  assert.equal(variant({ ev: -0.01 }), 'hidden');
  assert.equal(variant({ validUntil: SPORTS_DEMO_NOW }), 'hidden', 'gone at valid_until');
  assert.equal(variant({ sport: 'basketball', ev: 0 }), 'hidden', 'unusable signals are not counted either');
  const view = sportsSignals(DEMO_SPORTS_SIGNALS, ACCESS, NOW);
  assert.deepEqual(view.shown.map((s) => s.id), ['sg-1', 'sg-2', 'sg-3', 'sg-4']);
  assert.deepEqual(view.roi, { 'sp-epl-1-ml1/0': 0.0909, 'sp-epl-1-t1/0': 0.0741, 'sp-epl-1-c1/0': 0.0577, 'sp-epl-2-t1/1': 0.0769 });
  assert.deepEqual(view.locked, [{ sport: 'basketball', count: 2 }, { sport: 'hockey', count: 1 }]);
  // In front of the odds, in both formats, in the list (1X2 cell, main total) and the detail (also Total Corners).
  const arsenal = DEMO_GAMES.find((g) => g.id === 'sp-epl-1')!;
  const marks = { roi: view.roi, picked: null };
  for (const [format, odds] of [['decimal', '1.82'], ['american', '-122']] as const) {
    const list = renderIn('en', createElement(SportsList, {
      title: 't', games: [arsenal], emptyText: '', selectedId: null, format, onSelect: () => {}, marks }));
    assert.ok(list.includes(`(+9.1%)</span> ${odds}`), `${format}: ${odds}`);
    assert.ok(list.includes('(+7.4%)') && !list.includes('(+5.8%)'), 'corners are not a list column');
    const detail = renderIn('en', createElement(SportsDetail, { game: arsenal, format, emptyText: '', marks }));
    assert.ok(['(+9.1%)', '(+7.4%)', '(+5.8%)'].every((text) => detail.includes(text)));
    assert.equal(detail.split('%)').length - 1, 4, 'three-way cell and its line, the total, the corners');
  }
  // The README example: 62¢ with fair 64.6% → (+4.2%) 1.61 / −163, once basketball is held.
  const heat = DEMO_GAMES.find((g) => g.id === 'sp-nba-1')!;
  const heatView = sportsSignals(DEMO_SPORTS_SIGNALS, BOTH_SPORTS, NOW);
  for (const [format, odds] of [['decimal', '1.61'], ['american', '-163']] as const) {
    const html = renderIn('en', createElement(SportsList, {
      title: 't', games: [heat], emptyText: '', selectedId: null, format, onSelect: () => {}, marks: { roi: heatView.roi, picked: null } }));
    assert.ok(html.includes(`(+4.2%)</span> ${odds}`), `${format}: ${odds}`);
  }
  assert.ok(!heatView.shown.some((s) => s.id === 'sg-9'), 'the stale spread signal stays hidden');
});
test('Sports not held: the column gives a count per sport only, and no cell carries any mark', () => {
  const view = sportsSignals(DEMO_SPORTS_SIGNALS, NO_SPORT, NOW);
  assert.deepEqual([view.shown, view.roi], [[], {}]);
  assert.deepEqual(view.locked, [{ sport: 'soccer', count: 4 }, { sport: 'basketball', count: 2 }, { sport: 'hockey', count: 1 }]);
  const list = renderIn('en', createElement(SportsList, {
    title: 't', games: DEMO_GAMES, emptyText: '', selectedId: null, format: 'decimal', onSelect: () => {}, marks: { roi: view.roi, picked: null } }));
  assert.ok(!list.includes('%'));
  for (const game of DEMO_GAMES) {
    assert.ok(!renderIn('en', createElement(SportsDetail, { game, format: 'decimal', emptyText: '', marks: { roi: view.roi, picked: null } })).includes('%'));
  }
  for (const language of ['en', 'zh-Hant'] as const) {
    const t = language === 'en' ? en : zh;
    const panel = renderIn(language, createElement(SignalPanel, {
      open: true, onToggle: () => {}, signals: [], products: [], activeId: null, onSelect: () => {},
      locked: view.locked.map(({ sport, count }) => ({ id: sport, text: t.sports.lockedSignals(t.sports.names[sport], count) })) }));
    assert.ok(panel.includes(language === 'en' ? 'Soccer has 4 LAC signals today. Subscribe to unlock' : '足球今天有 4 個 LAC 訊號，訂閱解鎖'));
    assert.ok(panel.includes(language === 'en' ? 'Ice hockey has 1 LAC signal today' : '冰球今天有 1 個 LAC 訊號'));
    assert.ok(!panel.includes(t.signals.none), 'count lines replace "no signals"');
    for (const game of DEMO_GAMES) assert.ok(!panel.includes(game.title) && !panel.includes(game.teams[0].name!), 'no game, no side');
  }
  // Live has no LAC signals yet: the column says so, as the Signal page does.
  const live = renderIn('zh-Hant', createElement(SignalPanel, {
    open: true, onToggle: () => {}, signals: [], products: [], activeId: null, onSelect: () => {}, emptyText: zh.app.noLiveSignals }));
  assert.ok(live.includes('Live 模式沒有 LAC 訊號'));
});
test('Clicking a sports card opens its game (sub-events included) and marks exactly its cell', () => {
  const view = sportsSignals(DEMO_SPORTS_SIGNALS, ACCESS, NOW);
  const leagues = leagueCounts(DEMO_GAMES);
  for (const s of view.shown) {
    const game = gameOf(s, DEMO_GAMES)!;
    assert.ok(game.markets.some((m) => m.id === s.marketId && m.eventId === s.eventId), `${s.id} is in ${game.id}`);
    assert.deepEqual(cellMarks(view, s, game).picked, { marketId: s.marketId, outcomeIndex: s.side === 'YES' ? 0 : 1 });
    assert.equal(cellMarks(view, s, DEMO_GAMES.find((g) => g.id === 'sp-nhl-1')!).picked, null, 'another game open: no mark');
    // The filter stays when it lists the game, otherwise all sports.
    assert.deepEqual(focusFilter(filterFromId('sport:soccer'), game, leagues), filterFromId('sport:soccer'));
    assert.deepEqual(focusFilter(filterFromId('league:epl'), game, leagues), filterFromId('league:epl'));
    assert.deepEqual(focusFilter(filterFromId('sport:basketball'), game, leagues), ALL_SPORTS);
  }
  assert.deepEqual(view.shown.map((s) => gameOf(s, DEMO_GAMES)!.id), ['sp-epl-1', 'sp-epl-1', 'sp-epl-1', 'sp-epl-2']);
  assert.equal(cellMarks(view, undefined, DEMO_GAMES[0]).picked, null);
  // Cards read like the Signal page's: "Sport · Soccer", the game and the market, the outcome bought.
  const arsenal = DEMO_GAMES.find((g) => g.id === 'sp-epl-1')!;
  const corners = signalCard(signal('sg-3'), arsenal, en, NOW);
  assert.deepEqual(
    [corners.market, corners.title, corners.sideLabel, corners.side, corners.roi, corners.updatedSec, corners.minutesLeft],
    ['Soccer', 'Arsenal FC vs. Chelsea FC · Total Corners · O/U 9.5', 'OVER', 'yes', 0.0577, 150, 1320],
  );
  assert.equal(signalCard(signal('sg-1'), arsenal, zh, NOW).title, 'Arsenal FC vs. Chelsea FC · Arsenal FC');
  const under = signalCard(signal('sg-4'), DEMO_GAMES.find((g) => g.id === 'sp-epl-2')!, zh, NOW);
  assert.deepEqual([under.market, under.sideLabel, under.side, under.minutesLeft], ['足球', 'UNDER', 'no', 5]);
  const heat = signalCard(signal('sg-7'), DEMO_GAMES.find((g) => g.id === 'sp-nba-1')!, en, NOW);
  assert.deepEqual([heat.title, heat.sideLabel], ['Heat vs. Hornets', 'HEAT']);
});
test('Demo sports signals sit on Demo cells: entry is the buy price, ev and roi match, every kind is present', () => {
  for (const s of DEMO_SPORTS_SIGNALS) {
    const game = gameOf(s, DEMO_GAMES)!;
    const market = game.markets.find((m) => m.id === s.marketId && m.eventId === s.eventId)!;
    assert.equal(market.outcomes[s.side === 'YES' ? 0 : 1].buy, s.entry, `${s.id} entry`);
    assert.ok(Math.abs(s.fair - s.entry - s.ev) < 1e-9, `${s.id} ev`);
    assert.ok(Math.abs(s.fair / s.entry - 1 - s.roi) < 0.00005, `${s.id} roi`);
    assert.deepEqual([sportOf(game.league.code), game.league.code], [s.sport, s.league], `${s.id} classification`);
  }
  const everySport: Access = { products: ['sport'], sports: [...SPORTS] };
  const shown = sportsSignals(DEMO_SPORTS_SIGNALS, everySport, NOW).shown;
  const count = (sport: string) => shown.filter((s) => s.sport === sport).length;
  assert.ok(count('soccer') >= 3 && count('basketball') >= 2 && shown.some((s) => s.sport !== 'soccer' && s.sport !== 'basketball'));
  assert.ok(DEMO_SPORTS_SIGNALS.some((s) => s.ev <= 0 && s.status === 'active' && signalState(s, everySport, NOW) === 'hidden'));
  assert.ok(DEMO_SPORTS_SIGNALS.some((s) => s.ev > 0 && Date.parse(s.validUntil) <= NOW && signalState(s, everySport, NOW) === 'hidden'));
});

// Stocks page (Demo).
const selector = (language: 'en' | 'zh-Hant', props: Partial<Parameters<typeof StockSelector>[0]> = {}) =>
  renderIn(language, createElement(StockSelector, {
    market: 'tw', onMarket: () => {}, tab: 'analysis', onTab: () => {}, holding: DEFAULT_HOLDING, selectedCode: '2330', onPick: () => {}, ...props }));
test('Stocks: a report about every 90 days for three years; per holding period lower < 50% < upper, fair inside, wider when longer', () => {
  for (const stock of DEMO_STOCKS) {
    const { candles, reports } = stockSeries(stock);
    const days = new Set(candles.map((c) => isoDay(c.timestamp)));
    assert.deepEqual(earningsReports(stock, dailyCandles(stock)), reports, `${stock.code} same seed, same reports`);
    assert.ok(reports.length >= 11 && reports.length <= 13, `${stock.code}: ${reports.length} reports`);
    assert.ok(reports.at(-1)!.date < STOCKS_DEMO_TODAY, 'the last report is before today');
    reports.forEach((report, i) => {
      assert.ok(days.has(report.date), `${stock.code} ${report.date} is a candle day`);
      if (i > 0) {
        const gap = (dayStart(report.date) - dayStart(reports[i - 1].date)) / 86400000;
        assert.ok(gap >= 84 && gap <= 100, `${stock.code} ${report.date}: ${gap} days after the previous report`);
      }
      assert.equal(report.ranges.length, HOLDINGS.length);
      report.ranges.forEach((r, h) => {
        assert.ok(r.lower < r.median && r.median < r.upper, `${stock.code} ${report.date} ${HOLDINGS[h]} order`);
        assert.ok(r.lower < r.fair && r.fair < r.upper, `${stock.code} ${report.date} ${HOLDINGS[h]} fair inside`);
        if (h > 0) assert.ok(r.upper - r.lower > report.ranges[h - 1].upper - report.ranges[h - 1].lower, `${stock.code} ${report.date} ${HOLDINGS[h]} wider`);
      });
    });
  }
});
test('Stocks: past boxes run from a report to the next one without overlapping, also at Q+12; the latest runs N × 90 days', () => {
  const tsmc = stockByCode('2330')!;
  const { candles, reports } = stockSeries(tsmc);
  for (const holding of ['Q+1', 'Q+4', 'Q+12'] as const) {
    const boxes = rangeBoxes(reports, candles, holding);
    assert.equal(boxes.length, reports.length);
    boxes.slice(0, -1).forEach((box, i) => {
      assert.deepEqual([box.from, box.to, box.latest], [reports[i].date, reports[i + 1].date, false]);
      assert.equal(box.end, boxes[i + 1].start, `${holding}: box ${i} ends where the next starts`);
      assert.ok(box.start < box.end);
      assert.equal(candles[box.start].timestamp, dayStart(box.from));
      assert.equal(candles[box.end].timestamp, dayStart(box.to));
      assert.deepEqual(box.range, reports[i].ranges[HOLDINGS.indexOf(holding)]);
    });
    const latest = boxes.at(-1)!;
    assert.ok(latest.latest);
    assert.equal(latest.to, addDays(latest.from, 90 * quarters(holding)), `${holding}: N × 90 days`);
    assert.equal(latest.end - latest.start, weekdays(latest.from, latest.to).length, 'counted in weekday candles');
    // The chart's date under the box's end (past the last candle, weekdays continue): the box's last day.
    const endDay = isoDay(weekdaysAfter(candles.at(-1)!.timestamp, latest.end - (candles.length - 1)));
    assert.ok(endDay <= latest.to && endDay >= addDays(latest.to, -2), `${holding}: ends ${endDay} for ${latest.to}`);
  }
  assert.equal(isoDay(weekdaysAfter(dayStart('2026-10-23'), 1)), '2026-10-26', 'Friday + 1 weekday is Monday');
  assert.equal(isoDay(weekdaysAfter(dayStart('2026-10-23'), 5)), '2026-10-30');
  assert.equal(rangeBoxes(reports, candles, 'Q+1').at(-1)!.to, addDays(reports.at(-1)!.date, 90));
  assert.equal(rangeBoxes(reports, candles, 'Q+12').at(-1)!.to, addDays(reports.at(-1)!.date, 1080));
  assert.ok(rangeBoxes(reports, candles, 'Q+12').at(-1)!.end > candles.length - 1, 'reaches past today');
  // Opening view: about a year of candles, then the latest box's first ~3 months after the last candle.
  const view = openingView(candles, reports);
  assert.ok(view.past >= 260 && view.past <= 262, `${view.past} candles in the last year`);
  assert.equal(view.future, weekdays(STOCKS_DEMO_TODAY, addDays(reports.at(-1)!.date, 91)).length);
});
test('Stocks: the list and the figures show the latest report; upside = fair ÷ price − 1; no chance, no win rate', () => {
  for (const stock of DEMO_STOCKS) {
    const { reports } = stockSeries(stock);
    HOLDINGS.forEach((holding, h) => assert.deepEqual(latestRange(stock, holding), reports.at(-1)!.ranges[h]));
  }
  assert.deepEqual([upsideText(1400, 1085), upsideText(1050, 1085), upsideText(1085, 1085), upsideText(75.29, 88.6)], ['+29.0%', '-3.2%', '+0.0%', '-15.0%']);
  assert.equal(upside(1400, 1085), 1400 / 1085 - 1);
  assert.deepEqual([formatPrice('tw', 1085), formatPrice('tw', 38.75), formatPrice('us', 262.35), formatPrice('us', 290)], ['1,085', '38.75', '262.35', '290.00']);
  const tsmc = stockByCode('2330')!;
  for (const holding of ['Q+1', 'Q+12'] as const) {
    const fair = latestRange(tsmc, holding).fair;
    const html = selector('zh-Hant', { holding });
    assert.ok(html.includes(formatPrice('tw', fair)) && html.includes(upsideText(fair, tsmc.price)), `${holding} row`);
    assert.ok(html.includes('合理價格') && html.includes('空間') && !html.includes('Q+'));
  }
  assert.ok(selector('en', { market: 'us' }).includes('Upside'));
  // Nothing on the page says chance or win rate: every Stocks string, and the rendered lists of every tab.
  const strings = (value: unknown): string =>
    typeof value === 'object' && value !== null ? Object.values(value).map(strings).join(' ') : String(value);
  const pages = [zh, en].flatMap((t) => [strings(t.stocks)]).concat(
    (['tw', 'us'] as const).flatMap((market) => tabsFor(market).flatMap((tab) => [selector('zh-Hant', { market, tab }), selector('en', { market, tab })])),
  );
  for (const text of pages) assert.ok(!/機率|勝率|chance|win rate/i.test(text));
  assert.deepEqual(searchStocks('tw', '台積').map((s) => s.code), ['2330']);
  assert.deepEqual(searchStocks('us', 'nv').map((s) => s.code), ['NVDA']);
  assert.deepEqual(searchStocks('tw', 'tsmc').map((s) => s.code), ['2330']);
  assert.equal(searchStocks('tw', '').length, 10);
  assert.equal(searchStocks('us', '').length, 10);
});
test('Stocks: daily candles repeat for a seed, cover about three years of weekdays, stay consistent and end at the price', () => {
  const today = dayStart(STOCKS_DEMO_TODAY);
  for (const stock of DEMO_STOCKS) {
    const candles = dailyCandles(stock);
    assert.deepEqual(dailyCandles(stock), candles, `${stock.code} same seed, same candles`);
    assert.ok(candles.length >= 775 && candles.length <= 790, `${stock.code}: ${candles.length} weekdays`);
    assert.equal(candles.at(-1)!.timestamp, today);
    assert.ok(today - candles[0].timestamp <= 3 * 366 * 86400000 && today - candles[0].timestamp >= 3 * 364 * 86400000, 'about three years');
    candles.forEach((c, i) => {
      const day = new Date(c.timestamp).getUTCDay();
      assert.ok(day !== 0 && day !== 6, `${stock.code} weekday`);
      assert.ok(i === 0 || c.timestamp > candles[i - 1].timestamp, 'in order');
      assert.ok(c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.low > 0, `${stock.code} ${i} high/low`);
      assert.ok(Number.isInteger(c.volume) && c.volume > 0);
    });
    assert.equal(candles.at(-1)!.close, stock.price, `${stock.code} last close is the price`);
  }
  const tsmc = stockByCode('2330')!;
  assert.notDeepEqual(dailyCandles({ ...tsmc, seed: 1 }).slice(0, 5), dailyCandles(tsmc).slice(0, 5), 'another seed, other candles');
});
test('Congress: trades newest first, filed 1 to 45 days later, on chart days; marks for one member and stock', () => {
  const memberIds = new Set(CONGRESS_MEMBERS.map((m) => m.id));
  const days = new Map(DEMO_STOCKS.filter((s) => s.market === 'us').map((s) => [s.code, new Set(dailyCandles(s).map((c) => c.timestamp))]));
  for (const trade of CONGRESS_TRADES) {
    assert.ok(memberIds.has(trade.memberId));
    assert.ok(days.get(trade.code)?.has(dayStart(trade.tradedOn)), `${trade.id}: ${trade.code} ${trade.tradedOn} is a candle of a US Demo stock`);
    const gap = (dayStart(trade.filedOn) - dayStart(trade.tradedOn)) / 86400000;
    assert.ok(gap >= 1 && gap <= 45, `${trade.id} filed ${gap} days later`);
    assert.ok(trade.filedOn <= STOCKS_DEMO_TODAY);
  }
  for (const member of CONGRESS_MEMBERS) {
    const trades = memberTrades(member.id);
    assert.ok(trades.length >= 3 && trades.length <= 19, member.id);
    assert.deepEqual(trades.map((x) => x.tradedOn), trades.map((x) => x.tradedOn).sort().reverse(), `${member.id} newest first`);
  }
  assert.deepEqual(congressMembers().map((r) => [r.member.id, r.trades, r.lastFiled]), [
    ['dana-whitcombe', 11, '2026-10-15'], ['morgan-ellery', 10, '2026-10-01'], ['riley-okonjo', 14, '2026-09-21'],
    ['avery-linwood', 7, '2026-08-30'], ['elliot-varga', 3, '2026-03-23'],
  ]);
  const marks = tradeMarks('riley-okonjo', 'TSLA');
  assert.deepEqual(marks.map((m) => [m.tradedOn, m.side, m.filedOn, m.amount]), [
    ['2023-11-14', 'buy', '2023-12-14', '$1,001 – $15,000'],
    ['2024-08-06', 'buy', '2024-09-04', '$15,001 – $50,000'],
    ['2025-01-14', 'sell', '2025-02-05', '$15,001 – $50,000'],
    ['2025-09-09', 'buy', '2025-10-17', '$1,001 – $15,000'],
    ['2026-02-10', 'sell', '2026-03-05', '$1,001 – $15,000'],
    ['2026-06-30', 'buy', '2026-07-15', '$1,001 – $15,000'],
  ]);
  assert.ok(marks.every((m) => m.timestamp === dayStart(m.tradedOn)));
  assert.deepEqual(tradeMarks('riley-okonjo', 'XOM'), [], 'only that member and that stock');
  assert.deepEqual(tradeMarks('morgan-ellery', 'XOM').map((m) => m.side), ['buy', 'buy', 'sell', 'buy', 'sell']);
  assert.deepEqual([amountText(0), amountText(1), amountText(2)], ['$1,001 – $15,000', '$15,001 – $50,000', '$50,001 – $100,000']);
  const html = selector('zh-Hant', { market: 'us', tab: 'congress', selectedCode: 'AAPL' });
  assert.ok(html.includes('Riley Okonjo') && html.includes('眾議院') && html.includes('虛構'));
});
test('Funds: holdings by weight plus "others" make 100%; funds holding a stock by weight; Taiwan has no congress tab', () => {
  for (const fund of DEMO_FUNDS) {
    const rows = fundHoldings(fund);
    const listed = rows.slice(0, -1);
    assert.equal(rows.at(-1)!.stock, null, `${fund.code} ends with others`);
    assert.ok(listed.every((r) => r.stock!.market === fund.market), `${fund.code} holds its own market's Demo stocks`);
    assert.deepEqual(listed.map((r) => r.weight), listed.map((r) => r.weight).sort((a, b) => b - a), `${fund.code} by weight`);
    assert.equal(rows.reduce((sum, r) => sum + Math.round(r.weight * 10), 0), 1000, `${fund.code} adds up to 100%`);
    assert.ok(rows.at(-1)!.weight >= 0);
  }
  assert.ok(DEMO_FUNDS.filter((f) => f.market === 'tw').length >= 4 && DEMO_FUNDS.filter((f) => f.market === 'us').length >= 4);
  const top50 = fundHoldings(DEMO_FUNDS.find((f) => f.code === '0050')!);
  assert.deepEqual([top50[0].stock!.code, top50[0].weight, top50.at(-1)!.weight], ['2330', 58.2, 23]);
  assert.deepEqual(fundsHolding('2303').map((h) => [h.fund.code, h.weight]), [['00878', 3.8], ['0056', 3.1], ['0050', 1], ['006208', 1]]);
  assert.deepEqual(fundsHolding('AAPL').map((h) => h.fund.code), ['XLK', 'QQQ', 'SPY', 'VTI']);
  assert.deepEqual(searchFunds('tw', '高股息').map((f) => f.code), ['0056', '00878']);
  assert.deepEqual(searchFunds('us', 'qqq').map((f) => f.code), ['QQQ']);
  // Congress filings are US-only.
  assert.deepEqual(tabsFor('tw'), ['analysis', 'funds']);
  assert.deepEqual(tabsFor('us'), ['analysis', 'congress', 'funds']);
  assert.ok(!selector('zh-Hant', { market: 'tw' }).includes('國會持股') && selector('zh-Hant', { market: 'us' }).includes('國會持股'));
  assert.ok(!selector('en', { market: 'tw' }).includes('Congress trades'));
  const funds = selector('zh-Hant', { tab: 'funds' });
  assert.ok(funds.includes('元大台灣50') && funds.includes('資料日期 2026/9/30') && funds.includes('其他') && funds.includes('23.0%'));
});

test('History path breaks on null minutes/buckets and renders isolated real points', () => {
  const path = historyPath([0.1, null, 0.3, 0.4, null], [0, 60, 120, 180, 240], 0, 240);
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.ok(path.includes('M0,90 L0,90'));
  assert.ok(path.includes('M50,70 L50,70 L75,60'));
  assert.equal(historyPath([null, null], [0, 60], 0, 60).trim(), '');
});
