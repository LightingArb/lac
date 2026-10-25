import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { Pool } from 'pg';
import { loadEnv } from 'vite';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Opt-in local verification: SELECT only, including synthetic rows in VALUES CTEs.
const env = { ...loadEnv('development', resolve('../..'), ''), ...process.env };
assert.equal(env.DB_NAME, 'lac_data');
assert.equal(env.DB_PORT, '5432');
const dir = mkdtempSync(join(tmpdir(), 'lac-live-sql-'));
await build({ entryPoints: ['server/live.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['pg-native'], outfile: join(dir, 'reader.cjs') });
const { BID, ASK, MID, HISTORY, MONEYLINE } = createRequire(import.meta.url)(join(dir, 'reader.cjs'));
const pool = new Pool({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
  max: 1, options: '-c default_transaction_read_only=on -c statement_timeout=15000 -c timezone=UTC' });
after(async () => { await pool.end(); rmSync(dir, { recursive: true, force: true }); });

test('Connection is read-only and numeric quotes retain precision and propagate each null side', async () => {
  assert.equal((await pool.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
  const cases = [
    ['0.123456789012345678', '0.987654321098765432', '0.012345678901234568', '0.876543210987654322', '0.444444444944444445'],
    [null, '0.4', '0.6', null, null],
    ['0.3', null, null, '0.7', null],
    [null, null, null, null, null],
  ];
  for (const [bid, ask, secondBid, secondAsk, midpoint] of cases) {
    const result = await pool.query(`WITH p AS (SELECT $1::numeric AS best_bid, $2::numeric AS best_ask)
      SELECT (${BID})::text AS bid, (${ASK})::text AS ask, (${MID})::text AS midpoint
      FROM p CROSS JOIN (VALUES (1)) AS o(outcome_index)`, [bid, ask]);
    const row = result.rows[0];
    const normalize = (value) => value === null ? null : value.replace(/0+$/, '').replace(/\.$/, '');
    assert.deepEqual(Object.values(row).map(normalize), [secondBid, secondAsk, midpoint].map(normalize));
  }
});
test('A missing price row gives null quotes for both outcomes', async () => {
  const result = await pool.query(`SELECT (${BID}) AS bid, (${ASK}) AS ask, (${MID}) AS midpoint
    FROM (VALUES (0), (1)) AS o(outcome_index)
    LEFT JOIN m_live.m02_clob_price AS p ON p.market_id=$1 ORDER BY o.outcome_index`, ['__missing_live_test__']);
  assert.deepEqual(result.rows, [{ bid: null, ask: null, midpoint: null }, { bid: null, ask: null, midpoint: null }]);
});

const first = Array(1440).fill(null);
first[0] = '0.1'; first[1] = '0.2'; first[3] = '0.3'; first[1439] = '0.4';
const third = Array(1440).fill(null);
third[0] = '0.5'; third[1439] = '0.6';
const days = `WITH test_days(market_id, day, prices, status) AS (VALUES
  ('1', DATE '2020-01-01', $3::numeric[], 'success'),
  ('1', DATE '2020-01-03', $4::numeric[], 'success'),
  ('1', DATE '2020-01-04', ARRAY[0.99]::numeric[], 'error'),
  ('1', DATE '2020-01-05', NULL::numeric[], 'no_data'),
  ('1', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, ARRAY[0.99]::numeric[], 'success')
), `;
const history = days + HISTORY.trim().replace(/^WITH /, '').replace('FROM m_historical.m01_price_day AS d', 'FROM test_days AS d');
test('History array ordinality means UTC minutes, null is a gap, and second price is complementary', async () => {
  const { rows } = await pool.query(history, [['1'], 1440, first, third]);
  assert.equal(rows.length, 1440);
  assert.equal(rows[0].minute_at.toISOString(), '2020-01-03T00:00:00.000Z');
  assert.equal(rows[1].minute_at.toISOString(), '2020-01-03T00:01:00.000Z');
  assert.deepEqual([rows[0].price, rows[0].second_price], ['0.5', '0.5']);
  assert.deepEqual([rows[1].price, rows[1].second_price], [null, null]);
  assert.deepEqual([rows[1439].price, rows[1439].second_price], ['0.6', '0.4']);
});
test('All uses last non-null per equal bucket, preserving missing days and excluding error/no_data/current day', async () => {
  const { rows } = await pool.query(history, [['1'], null, first, third]);
  assert.equal(rows.length, 1440);
  assert.equal(rows[0].step_minutes, 3);
  assert.equal(rows[0].price, '0.2');
  assert.equal(rows[0].minute_at.toISOString(), '2020-01-01T00:01:00.000Z');
  assert.equal(rows[1].price, '0.3');
  assert.equal(rows[2].price, null);
  assert.ok(rows.slice(480, 960).every((row) => row.price === null));
  assert.equal(rows.at(-1).end_at.toISOString(), '2020-01-03T23:59:00.000Z');
});
test('Short range ends on last data minute and empty history returns no fabricated points', async () => {
  const { rows } = await pool.query(history, [['1'], 60, first, third]);
  assert.equal(rows.length, 60);
  assert.equal(rows[0].minute_at.toISOString(), '2020-01-03T23:00:00.000Z');
  assert.equal(rows.at(-1).price, '0.6');
  assert.deepEqual((await pool.query(history, [['missing'], null, first, third])).rows, []);
});
test('Only one open moneyline per event is eligible, independent of market page', async () => {
  const query = `WITH test_markets(event_id,market_id,in_current_scan,active,closed,archived,sports_market_type) AS (VALUES
    ('single','a',true,true,false,false,'moneyline'),('single','closed',true,true,true,false,'moneyline'),
    ('many','b',true,true,false,false,'moneyline'),('many','c',true,true,false,false,'moneyline'),
    ('other','d',true,true,false,false,'spread')),
    test_outcomes(market_id,outcome_index,label) AS (VALUES ('a',0,'Alpha'),('a',1,'Beta')),
    test_prices(market_id,best_bid,best_ask) AS (VALUES ('a',0.2::numeric,0.4::numeric)), ` + MONEYLINE.trim().replace(/^WITH /, '')
      .replaceAll('m_live.m01_market', 'test_markets').replaceAll('m_live.m01_outcome', 'test_outcomes').replaceAll('m_live.m02_clob_price', 'test_prices');
  const { rows } = await pool.query(query, [['single', 'many', 'other']]);
  assert.deepEqual(rows.map((row) => [row.event_id, row.label]), [['single', 'Alpha'], ['single', 'Beta']]);
});