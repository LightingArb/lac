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
test('History path breaks on null minutes/buckets and renders isolated real points', () => {
  const path = historyPath([0.1, null, 0.3, 0.4, null], [0, 60, 120, 180, 240], 0, 240);
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.ok(path.includes('M0,90 L0,90'));
  assert.ok(path.includes('M50,70 L50,70 L75,60'));
  assert.equal(historyPath([null, null], [0, 60], 0, 60).trim(), '');
});
