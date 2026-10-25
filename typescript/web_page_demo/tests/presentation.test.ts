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
import { CUSTOMER_PLAN, EVENTS } from '../src/data/catalog';
import { DEMO_ACCOUNT, EMPTY_ACCOUNT, type Account } from '../src/data/terminal';
import { INITIAL_WORKSPACE, deriveWorkspace, focusHighlight, sideLabel, type WorkspaceState } from '../src/lib/markets';
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
import { DEMO_GAMES } from '../src/data/sports';
import {
  SPORT_LEAGUES,
  americanOdds,
  compareGames,
  decimalOdds,
  filterFromId,
  filterLeagues,
  leagueCounts,
  liveSportsGame,
  mainLine,
  moneylines,
  odds,
  sportOf,
  sportsCategories,
  type LiveSportsEvent,
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
import { INITIAL_BACKEND, backendReducer, entitlementStatus, type Backend, type BackendAction } from '../src/data/backend';
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

// Trading terminal (Demo account).
const position = (id: string) => DEMO_ACCOUNT.positions.find((p) => p.id === id)!;
test('Terminal summary: equity = cash + position values, available = cash − open buy orders, P/L summed', () => {
  assert.equal(reservedCash(DEMO_ACCOUNT.orders), 220); // 0.54×200 + 0.82×100 + 0.15×200; the sell holds no cash
  assert.deepEqual(accountSummary(DEMO_ACCOUNT), { balance: 986.5, equity: 1903.3, available: 766.5, unrealized: 53.3 });
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
  // Signal's Trending lists every event that the Signal page can open.
  const ids = new Set(deriveWorkspace('signal', INITIAL_WORKSPACE, CUSTOMER_PLAN, en).events.map((e) => e.id));
  for (const item of [...DEMO_ACCOUNT.positions, ...DEMO_ACCOUNT.orders, ...DEMO_ACCOUNT.trades.filter((x) => x.eventId)]) {
    assert.ok(ids.has(item.eventId!), `${item.id} uses a Signal event`);
  }
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
test('Clicking a position opens its event in the Signal columns and marks that outcome and side', () => {
  const open = (state: WorkspaceState) => deriveWorkspace('signal', state, CUSTOMER_PLAN, en);
  for (const p of DEMO_ACCOUNT.positions) {
    for (const start of ['trending', 'weather', 'sport'] as const) {
      const before: WorkspaceState = { ...INITIAL_WORKSPACE, signalCategory: start };
      const after = open({ ...before, ...focusHighlight(open(before), p) });
      assert.equal(after.selected!.id, p.eventId);
      assert.ok(after.events.some((e) => e.id === p.eventId), `${p.id} is listed in ${after.activeCategory}`);
      assert.deepEqual([after.highlight!.id, after.highlight!.outcomeId, after.highlight!.side], [p.id, p.outcomeId, p.side]);
    }
  }
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
const line = (id: string, type: string, liquidity: number | null, sortOrder: number): SportsMarket => ({
  id, type, sortOrder, title: id, line: null, liquidity, outcomes: [],
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
test('Second outcome buy price arrives from the reader and maps per outcome in index order', () => {
  const event: LiveSportsEvent = {
    event_id: '9', title: 'A vs. B', league_code: 'nba', league_name: 'NBA', teams: [{ name: 'A', abbreviation: 'a' }, { name: 'B', abbreviation: 'b' }],
    score: null, live: null, ended: null, period: null, elapsed: null, game_start_at: '2026-10-25T00:00:00.000Z', market_count: 1,
  };
  const row = { event_id: '9', market_id: '1', sports_market_type: 'moneyline', sort_order: 0, group_title: '', question: 'A vs. B', line: null, liquidity: '10' };
  // Reader rows for best_bid 0.61 / best_ask 0.62: outcome 0 buys at 0.62, outcome 1 at 1 − 0.61.
  const game = liveSportsGame(event, [
    { ...row, outcome_index: 1, label: 'B', buy: '0.39' },
    { ...row, outcome_index: 0, label: 'A', buy: '0.62' },
    { ...row, event_id: '8', outcome_index: 0, label: 'X', buy: '0.5' },
  ]);
  assert.equal(game.markets.length, 1);
  assert.equal(game.markets[0].title, 'A vs. B', 'empty group_title falls back to the question');
  assert.deepEqual(game.markets[0].outcomes, [{ index: 0, label: 'A', buy: 0.62 }, { index: 1, label: 'B', buy: 0.39 }]);
  assert.deepEqual(game.markets[0].outcomes.map((o) => odds(o.buy, 'decimal')), ['1.61', '2.56']);
  assert.equal(liveSportsGame(event, [{ ...row, outcome_index: 1, label: 'B', buy: null }]).markets[0].outcomes[0].buy, null);
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
test('Demo Sports data: three or more leagues, ten or more games, every state, some lines missing', () => {
  assert.ok(leagueCounts(DEMO_GAMES).length >= 3 && DEMO_GAMES.length >= 10);
  assert.ok(DEMO_GAMES.some((x) => x.live === true) && DEMO_GAMES.some((x) => x.ended === true));
  assert.ok(DEMO_GAMES.some((x) => x.live !== true && x.ended !== true));
  assert.ok(DEMO_GAMES.some((x) => !mainLine(x.markets, 'spreads')) && DEMO_GAMES.some((x) => !mainLine(x.markets, 'totals')));
  assert.ok(DEMO_GAMES.every((x) => x.teams.length === 2 && x.markets.every((m) => m.outcomes.length === 2)));
});

test('History path breaks on null minutes/buckets and renders isolated real points', () => {
  const path = historyPath([0.1, null, 0.3, 0.4, null], [0, 60, 120, 180, 240], 0, 240);
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.ok(path.includes('M0,90 L0,90'));
  assert.ok(path.includes('M50,70 L50,70 L75,60'));
  assert.equal(historyPath([null, null], [0, 60], 0, 60).trim(), '');
});
