import { Pool } from 'pg';
import type { Plugin } from 'vite';

const OPEN = 'e.in_current_scan AND e.active AND NOT e.closed AND NOT e.archived';
const MARKET_OPEN = 'm.in_current_scan AND m.active AND NOT m.closed AND NOT m.archived';

// PostgreSQL numeric arithmetic; NULL propagates through every derived quote.
export const BID = 'CASE o.outcome_index WHEN 0 THEN p.best_bid WHEN 1 THEN 1::numeric - p.best_ask END';
export const ASK = 'CASE o.outcome_index WHEN 0 THEN p.best_ask WHEN 1 THEN 1::numeric - p.best_bid END';
export const MID = `((${BID}) + (${ASK})) / 2::numeric`;
const PREVIEW_MID = MID.replaceAll('o.', 'preview_outcome.').replaceAll('p.', 'preview_quote.');
const GAME = 'e.teams,e.score,e.live,e.ended,e.period,e.elapsed,e.game_start_at';

// One bounded batch for both list previews and details, independent of market pagination.
export const MONEYLINE = `
WITH matches AS (
    SELECT
        m.event_id,
        MIN(m.market_id) AS market_id
    FROM m_live.m01_market AS m
    WHERE m.event_id = ANY($1::text []) AND ${MARKET_OPEN} AND m.sports_market_type = 'moneyline'
    GROUP BY m.event_id
    HAVING COUNT(*) = 1
)

SELECT
    m.event_id,
    o.market_id,
    o.outcome_index,
    o.label,
    (${MID})::text AS midpoint
FROM matches AS m INNER JOIN m_live.m01_outcome AS o ON m.market_id = o.market_id
LEFT JOIN m_live.m02_clob_price AS p ON m.market_id = p.market_id
ORDER BY m.event_id, o.outcome_index
`;

// Sports page: open events with exactly two teams, merged into games; the league is the event's sport.sport.
const TWO_TEAMS = 'JSONB_ARRAY_LENGTH(e.teams) = 2';

// Events → games (README §4). The same game_id is one game. An event without game_id joins the one
// game_id game with the same league code, the same two team names in any order and the same
// game_start_at on any of its events; with none or several it is a game by itself. No titles.
// The representative event (time, teams, score, status, title) has an open moneyline, else the smallest id.
const SPORTS_GROUPS = `
WITH two AS MATERIALIZED (
    SELECT
        e.event_id,
        e.game_id,
        e.title,
        e.game_start_at,
        COALESCE(e.sport ->> 'sport', '') AS league,
        LEAST(e.teams -> 0 ->> 'name', e.teams -> 1 ->> 'name') AS name_lo,
        GREATEST(e.teams -> 0 ->> 'name', e.teams -> 1 ->> 'name') AS name_hi,
        (e.teams -> 0 ->> 'name') IS NOT NULL AND (e.teams -> 1 ->> 'name') IS NOT NULL AS named,
        EXISTS(
            SELECT 1 FROM m_live.m01_market AS m
            WHERE
                m.event_id = e.event_id AND m.sports_market_type = 'moneyline'
                AND ${MARKET_OPEN}
        ) AS has_moneyline
    FROM m_live.m01_event AS e
    WHERE ${OPEN} AND ${TWO_TEAMS}
),

attached AS (
    SELECT
        n.event_id,
        MIN(g.game_id) AS game_id
    FROM two AS n
    INNER JOIN two AS g
        ON
            n.league = g.league AND n.name_lo = g.name_lo AND n.name_hi = g.name_hi
            AND n.game_start_at = g.game_start_at
    WHERE n.game_id IS NULL AND n.named AND g.game_id IS NOT NULL AND g.named
    GROUP BY n.event_id
    HAVING COUNT(DISTINCT g.game_id) = 1
),

members AS MATERIALIZED (
    SELECT
        t.event_id,
        t.title,
        t.name_lo,
        t.name_hi,
        t.has_moneyline,
        COALESCE('g:' || COALESCE(t.game_id, a.game_id), 'e:' || t.event_id) AS game_key
    FROM two AS t
    LEFT JOIN attached AS a ON t.event_id = a.event_id
),

games AS MATERIALIZED (
    SELECT DISTINCT ON (mb.game_key)
        mb.game_key,
        mb.event_id
    FROM members AS mb
    ORDER BY mb.game_key ASC, mb.has_moneyline DESC, LENGTH(mb.event_id) ASC, mb.event_id ASC
)`;

export const SPORTS_LEAGUES = `${SPORTS_GROUPS}

SELECT
    COUNT(*)::int AS count,
    e.sport ->> 'sport' AS code,
    MIN(e.sport ->> 'name') AS name
FROM games AS g
INNER JOIN m_live.m01_event AS e ON g.event_id = e.event_id
GROUP BY e.sport ->> 'sport'
ORDER BY count DESC, code ASC NULLS LAST
`;

// One game: the representative event's fields (alias e), every event of the game and their open markets.
const SPORTS_GAME = `e.event_id,
    e.title,
    e.score,
    e.live,
    e.ended,
    e.period,
    e.elapsed,
    e.game_start_at,
    e.sport ->> 'sport' AS league_code,
    e.sport ->> 'name' AS league_name,
    (
        SELECT
            JSONB_AGG(
                JSONB_BUILD_OBJECT(
                    'name', t.team ->> 'name', 'abbreviation', t.team ->> 'abbreviation', 'alias', t.team ->> 'alias'
                ) ORDER BY t.i
            )
        FROM JSONB_ARRAY_ELEMENTS(e.teams) WITH ORDINALITY AS t (team, i)
    ) AS teams,
    (
        SELECT
            JSONB_AGG(
                JSONB_BUILD_OBJECT('event_id', mb.event_id, 'title', mb.title)
                ORDER BY LENGTH(mb.event_id), mb.event_id
            )
        FROM members AS mb
        WHERE mb.game_key = g.game_key
    ) AS events,
    (
        SELECT COUNT(*)::int FROM members AS mb
        INNER JOIN m_live.m01_market AS m ON mb.event_id = m.event_id
        WHERE mb.game_key = g.game_key AND ${MARKET_OPEN}
    ) AS market_count`;

// In play first, then not started by start time (unknown last), ended last, from the representative
// event; keyset on (rank, start, representative event_id). Search: any event title or either team name.
export const SPORTS_GAMES = `${SPORTS_GROUPS},

searched AS (
    SELECT DISTINCT mb.game_key
    FROM members AS mb
    WHERE
        $2 <> '' AND (
            mb.title ILIKE '%' || $2 || '%' OR mb.name_lo ILIKE '%' || $2 || '%' OR mb.name_hi ILIKE '%' || $2 || '%'
        )
),

ranked AS MATERIALIZED (
    SELECT
        g.game_key,
        g.event_id,
        e.game_start_at,
        CASE WHEN e.live THEN 0 WHEN e.ended THEN 2 ELSE 1 END AS status_rank
    FROM games AS g
    INNER JOIN m_live.m01_event AS e ON g.event_id = e.event_id
    WHERE
        ($1::text [] IS NULL OR COALESCE(e.sport ->> 'sport', '') = ANY($1::text []))
        AND ($2 = '' OR g.game_key IN (SELECT s.game_key FROM searched AS s))
),

page AS (
    SELECT
        r.game_key,
        r.event_id,
        r.game_start_at,
        r.status_rank
    FROM ranked AS r
    WHERE
        $3::int IS NULL
        OR r.status_rank > $3::int
        OR (
            r.status_rank = $3::int AND (
                (
                    $4::timestamptz IS NOT NULL AND (
                        r.game_start_at > $4::timestamptz OR r.game_start_at IS NULL
                        OR (r.game_start_at = $4::timestamptz AND r.event_id > $5)
                    )
                )
                OR ($4::timestamptz IS NULL AND r.game_start_at IS NULL AND r.event_id > $5)
            )
        )
    ORDER BY r.status_rank ASC, r.game_start_at ASC NULLS LAST, r.event_id ASC LIMIT 51
)

SELECT
    p.status_rank,
    ${SPORTS_GAME},
    TO_CHAR(p.game_start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS start_key
FROM page AS p
INNER JOIN games AS g ON p.game_key = g.game_key
INNER JOIN m_live.m01_event AS e ON p.event_id = e.event_id
ORDER BY p.status_rank ASC, p.game_start_at ASC NULLS LAST, p.event_id ASC
`;

// The game that event $1 belongs to.
export const SPORTS_GAME_DETAIL = `${SPORTS_GROUPS}

SELECT
    ${SPORTS_GAME}
FROM games AS g
INNER JOIN m_live.m01_event AS e ON g.event_id = e.event_id
WHERE g.game_key = (
    SELECT mb.game_key FROM members AS mb
    WHERE mb.event_id = $1
)
`;

// Buy price of each outcome: first outcome best_ask, second 1 − first best_bid (numeric, NULL stays NULL).
export const SPORTS_MARKETS = `
SELECT
    m.event_id,
    m.market_id,
    m.sports_market_type,
    m.sort_order,
    m.group_title,
    m.question,
    m.line::text AS line,
    m.liquidity::text AS liquidity,
    o.outcome_index,
    o.label,
    (${ASK})::text AS buy
FROM m_live.m01_market AS m INNER JOIN m_live.m01_outcome AS o ON m.market_id = o.market_id
LEFT JOIN m_live.m02_clob_price AS p ON m.market_id = p.market_id
WHERE
    m.event_id = ANY($1::text []) AND ${MARKET_OPEN}
    AND ($2::text [] IS NULL OR m.sports_market_type = ANY($2::text []))
ORDER BY m.event_id, m.sort_order, m.market_id, o.outcome_index LIMIT 20001
`;

/** Market types the list shows; the detail shows every open market. */
const LIST_TYPES = ['moneyline', 'spreads', 'totals'];

// The grid is at most 1,440 equal-width buckets per market, including empty buckets.
// Last non-null minute in each bucket wins; no_data/error/pending never supply points.
export const HISTORY = `
WITH minutes AS MATERIALIZED (
    SELECT
        d.market_id,
        v.price,
        (d.day::timestamp AT TIME ZONE 'UTC') + (v.i - 1) * interval '1 minute' AS minute_at
    FROM m_historical.m01_price_day AS d
    CROSS JOIN LATERAL unnest(d.prices) WITH ORDINALITY AS v (price, i)
    WHERE
        d.market_id = any($1::text []) AND d.status = 'success'
        AND d.day < (current_timestamp AT TIME ZONE 'UTC')::date AND v.price IS NOT NULL
),

bounds AS (
    SELECT
        min(minute_at) AS first_at,
        max(minute_at) AS end_at
    FROM minutes
),

requested_window AS (
    SELECT
        first_at,
        end_at,
        CASE
            WHEN $2::int IS NULL THEN first_at
            ELSE greatest(first_at, end_at - ($2::int - 1) * interval '1 minute')
        END AS start_at
    FROM bounds
),

width AS (
    SELECT
        first_at,
        start_at,
        end_at,
        greatest(1, ceil((extract(EPOCH FROM (end_at - start_at)) / 60 + 1) / 1440))::int AS step_minutes
    FROM requested_window
),

selected AS (
    SELECT
        m.market_id,
        m.minute_at,
        m.price,
        floor(extract(EPOCH FROM (m.minute_at - w.start_at)) / (60 * w.step_minutes))::int AS bucket
    FROM minutes AS m CROSS JOIN width AS w
    WHERE m.minute_at >= w.start_at
),

last_points AS (
    SELECT DISTINCT ON (market_id, bucket)
        market_id,
        bucket,
        minute_at,
        price
    FROM selected
    ORDER BY market_id ASC, bucket ASC, minute_at DESC
)

SELECT
    ids.market_id,
    w.first_at,
    w.start_at,
    w.end_at,
    w.step_minutes,
    p.price::text AS price,
    (1::numeric - p.price)::text AS second_price,
    coalesce(p.minute_at, w.start_at + b.bucket * w.step_minutes * interval '1 minute') AS minute_at
FROM unnest($1::text []) AS ids (market_id) CROSS JOIN width AS w
CROSS JOIN
    LATERAL generate_series(
        0,
        floor(extract(EPOCH FROM (w.end_at - w.start_at)) / (60 * w.step_minutes))::int
    ) AS b (bucket)
LEFT JOIN last_points AS p ON ids.market_id = p.market_id AND b.bucket = p.bucket
ORDER BY ids.market_id, b.bucket
`;

/** Browser presentation only. This reader never writes tables or calls a crawler. */
export function liveData(env: Record<string, string>): Plugin {
  let pool: Pool;
  const query = (sql: string, values: unknown[] = []) => pool.query(sql, values);
  return {
    name: 'lac-public-table-reader',
    configureServer(server) {
      for (const name of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
        if (!env[name]) throw new Error(`Missing server environment: ${name}`);
      }
      if (env.DB_NAME !== 'lac_data' || env.DB_PORT !== '5432') throw new Error('Unexpected database');
      pool = new Pool({
        host: env.DB_HOST,
        port: Number(env.DB_PORT),
        database: env.DB_NAME,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        max: 4,
        connectionTimeoutMillis: 5000,
        options: '-c default_transaction_read_only=on -c statement_timeout=15000',
      });
      server.httpServer?.once('close', () => {
        void pool.end();
      });
      server.middlewares.use('/api/live', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        const respond = (status: number, body: unknown) => {
          res.statusCode = status;
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'GET') {
          respond(405, { error: 'Read-only endpoint' });
          return;
        }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const id = url.searchParams.get('id');
          if (url.pathname === '/categories') {
            const result = await query(`
WITH eligible AS (
    SELECT
        e.event_id,
        e.tags
    FROM m_live.m01_event AS e
    WHERE ${OPEN}
),

wanted (
    slug, label, ord) AS (
    VALUES ('politics', 'Politics', 1), ('sports', 'Sports', 2),
    ('finance', 'Finance', 3), ('crypto', 'Crypto', 4), ('esports', 'Esports', 5),
    ('geopolitics', 'Geopolitics', 6), ('weather', 'Weather', 7)
)

SELECT
    w.slug AS id,
    w.label,
    COUNT(e.event_id)::int AS count
FROM wanted AS w
LEFT JOIN eligible AS e ON e.tags @> JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('slug', w.slug))
GROUP BY w.slug, w.label, w.ord
ORDER BY w.ord, w.slug
`);
            const total = await query(`
SELECT
    LEAST(COUNT(*), 100)::int AS count,
    MAX(e.m_live_updated_at) AS m_live_updated_at
FROM m_live.m01_event AS e
WHERE ${OPEN}
`);
            respond(200, {
              categories: [{ id: 'trending', label: 'Trending', count: total.rows[0].count }, ...result.rows],
              updatedAt: total.rows[0].m_live_updated_at,
            });
          } else if (url.pathname === '/events') {
            const tag = url.searchParams.get('tag') ?? 'trending';
            if (
              !['trending', 'politics', 'sports', 'finance', 'crypto', 'esports', 'geopolitics', 'weather'].includes(
                tag,
              )
            ) {
              respond(400, { error: 'Unknown category' });
              return;
            }
            const search = (url.searchParams.get('q') ?? '').slice(0, 200);
            const encoded = url.searchParams.get('cursor');
            let cursor: { v: string | null; id: string } | null = null;
            if (encoded) {
              try {
                cursor = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
              } catch {
                respond(400, { error: 'Invalid cursor' });
                return;
              }
              if (
                !cursor ||
                typeof cursor.id !== 'string' ||
                !/^\d+$/.test(cursor.id) ||
                (cursor.v !== null && (typeof cursor.v !== 'string' || !/^\d+(\.\d+)?$/.test(cursor.v)))
              ) {
                respond(400, { error: 'Invalid cursor' });
                return;
              }
            }
            const result = await query(
              `
WITH eligible AS MATERIALIZED (
    SELECT
        e.event_id,
        e.volume_24h
    FROM m_live.m01_event AS e
    WHERE ${OPEN}
),

chosen AS (
    SELECT candidate.event_id
    FROM eligible AS candidate
    WHERE
        $1 <> 'trending' OR candidate.event_id IN
        (
            SELECT ranked.event_id FROM eligible AS ranked
            ORDER BY ranked.volume_24h DESC NULLS LAST, ranked.event_id ASC LIMIT 100
        )
)

SELECT
    e.event_id,
    e.slug,
    e.title,
    e.image_url,
    e.tags,
    e.start_at,
    e.volume_24h,
    e.volume_total,
    e.liquidity,
    e.end_at,
    e.m_live_updated_at,
    ${GAME},
    (
        SELECT COUNT(*)::int FROM m_live.m01_market AS m
        WHERE m.event_id = e.event_id AND ${MARKET_OPEN}
    ) AS market_count
FROM
    chosen AS c
INNER JOIN m_live.m01_event AS e ON c.event_id = e.event_id
WHERE
    ($1 = 'trending' OR e.tags @> $2::jsonb)
    AND ($3 = '' OR e.title ILIKE '%' || $3 || '%')
    AND (
        $4::text IS NULL
        OR ($5::numeric IS NOT NULL AND (
            e.volume_24h < $5 OR (e.volume_24h = $5 AND e.event_id > $4) OR e.volume_24h IS NULL
        ))
        OR ($5::numeric IS NULL AND e.volume_24h IS NULL AND e.event_id > $4)
    )
ORDER BY e.volume_24h DESC NULLS LAST, e.event_id ASC LIMIT 51
`,
              [tag, JSON.stringify([{ slug: tag }]), search, cursor?.id ?? null, cursor?.v ?? null],
            );
            const events = result.rows.slice(0, 50);
            const summaries = events.length
              ? await query(
                  `
SELECT
    chosen.event_id,
    m.market_id,
    m.group_title,
    m.question,
    m.liquidity,
    m.volume_total,
    o.outcome_index,
    o.label,
    o.asset_id,
    (${MID})::text AS midpoint,
    (${BID})::text AS best_bid,
    (${ASK})::text AS best_ask,
    p.requested_at
FROM unnest($1::text []) AS chosen (event_id)
CROSS JOIN
    LATERAL (
        SELECT
            m.market_id,
            m.group_title,
            m.question,
            m.sort_order,
            m.liquidity,
            m.volume_total
        FROM m_live.m01_market AS m
        LEFT JOIN m_live.m02_clob_price AS preview_quote ON m.market_id = preview_quote.market_id
        LEFT JOIN LATERAL (
            SELECT preview_o.outcome_index
            FROM m_live.m01_outcome AS preview_o
            WHERE preview_o.market_id = m.market_id
            ORDER BY
                CASE WHEN lower(preview_o.label) IN ('yes', 'up') THEN 0 ELSE 1 END,
                preview_o.outcome_index
            LIMIT 1
        ) AS preview_outcome ON true
        WHERE m.event_id = chosen.event_id AND ${MARKET_OPEN}
        ORDER BY (${PREVIEW_MID}) DESC NULLS LAST, m.sort_order ASC, m.market_id ASC LIMIT 3
    ) AS m
INNER JOIN m_live.m01_outcome AS o ON m.market_id = o.market_id
LEFT JOIN m_live.m02_clob_price AS p ON o.market_id = p.market_id
ORDER BY chosen.event_id, m.sort_order, m.market_id, o.outcome_index
`,
                  [events.map((event) => event.event_id)],
                )
              : { rows: [] };
            const byEvent = new Map<string, typeof summaries.rows>();
            for (const row of summaries.rows) {
              const group = byEvent.get(row.event_id) ?? [];
              group.push(row);
              byEvent.set(row.event_id, group);
            }
            const moneyline = events.length ? await query(MONEYLINE, [events.map((event) => event.event_id)]) : { rows: [] };
            for (const event of events) {
              event.preview = byEvent.get(event.event_id) ?? [];
              event.moneyline = moneyline.rows.filter((row) => row.event_id === event.event_id);
            }
            const last = events.at(-1);
            const next =
              result.rows.length > 50 && last
                ? Buffer.from(JSON.stringify({ v: last.volume_24h, id: last.event_id })).toString('base64url')
                : null;
            respond(200, { events, next });
          } else if (url.pathname === '/event' && id && /^\d+$/.test(id)) {
            const afterId = url.searchParams.get('after_id');
            const afterOrder = url.searchParams.get('after_order');
            if (
              (afterId !== null || afterOrder !== null) &&
              (!afterId || !/^\d+$/.test(afterId) || !afterOrder || !/^\d{1,9}$/.test(afterOrder))
            ) {
              respond(400, { error: 'Invalid market cursor' });
              return;
            }
            const event = await query(
              `
SELECT
    e.event_id, e.slug, e.title, e.description, e.resolution_source, e.image_url,
    e.start_at, e.end_at, e.volume_24h, e.volume_total, e.liquidity, e.tags, e.m_live_updated_at, ${GAME}
FROM m_live.m01_event AS e
WHERE ${OPEN} AND e.event_id = $1
`,
              [id],
            );
            if (!event.rows.length) {
              respond(404, { error: 'Event is no longer open in the current scan' });
              return;
            }
            const page = await query(
              `
SELECT
    m.market_id,
    m.sort_order
FROM m_live.m01_market AS m
WHERE
    m.event_id = $1
    AND ${MARKET_OPEN}
    AND ($2::text IS NULL OR m.sort_order > $3::int OR (m.sort_order = $3::int AND m.market_id > $2))
ORDER BY m.sort_order, m.market_id LIMIT 51
`,
              [id, afterId, afterOrder],
            );
            const visibleMarkets = page.rows.slice(0, 50);
            const total = await query(
              `
SELECT COUNT(m.market_id)::int AS count FROM m_live.m01_market AS m
WHERE m.event_id = $1 AND ${MARKET_OPEN}
`,
              [id],
            );
            const markets = await query(
              `
SELECT
    m.market_id,
    m.sort_order,
    m.question,
    m.group_title,
    m.description,
    m.resolution_source,
    m.end_at,
    m.liquidity,
    m.volume_total,
    m.accepting_orders,
    m.enable_order_book,
    o.outcome_index,
    o.label,
    o.asset_id,
    (${BID})::text AS best_bid,
    (${ASK})::text AS best_ask,
    (${MID})::text AS midpoint,
    p.requested_at
FROM m_live.m01_market AS m INNER JOIN m_live.m01_outcome AS o ON m.market_id = o.market_id
LEFT JOIN m_live.m02_clob_price AS p ON o.market_id = p.market_id
WHERE m.market_id = ANY($1::text [])
ORDER BY m.sort_order, m.market_id, o.outcome_index LIMIT 10001
`,
              [visibleMarkets.map((market) => market.market_id)],
            );
            if (markets.rows.length > 10000) {
              respond(503, { error: 'This market page exceeds the display limit' });
              return;
            }
            respond(200, {
              event: { ...event.rows[0], moneyline: (await query(MONEYLINE, [[id]])).rows },
              outcomes: markets.rows,
              marketCount: total.rows[0].count,
              nextMarket: page.rows.length > 50 ? visibleMarkets.at(-1) : null,
            });
          } else if (url.pathname === '/history') {
            const ids = [...new Set((url.searchParams.get('ids') ?? id ?? '').split(','))];
            if (!ids.length || ids.length > 50 || ids.some((value) => !/^\d{1,128}$/.test(value))) {
              respond(400, { error: 'Expected 1–50 market IDs' });
              return;
            }
            const ranges: Record<string, number | null> = { '1H': 60, '6H': 360, '1D': 1440, '1W': 10080, '1M': 43200, ALL: null };
            const range = url.searchParams.get('range') ?? 'ALL';
            if (!Object.hasOwn(ranges, range)) {
              respond(400, { error: 'Unknown history range' });
              return;
            }
            const points = await query(HISTORY, [ids, ranges[range]]);
            const histories: Record<string, { points: { minute_at: string; price: string | null; second_price: string | null }[] }> =
              Object.fromEntries(ids.map((market) => [market, { points: [] }]));
            for (const point of points.rows) histories[point.market_id].points.push({
              minute_at: point.minute_at, price: point.price, second_price: point.second_price,
            });
            const bounds = points.rows[0];
            respond(200, { histories, firstAt: bounds?.first_at ?? null, startAt: bounds?.start_at ?? null,
              endAt: bounds?.end_at ?? null, stepMinutes: bounds?.step_minutes ?? 1 });
          } else if (url.pathname === '/sports/leagues') {
            respond(200, { leagues: (await query(SPORTS_LEAGUES)).rows });
          } else if (url.pathname === '/sports/games') {
            // An event without a league is ''; no league parameter means every league.
            const leagues = url.searchParams.getAll('league');
            if (leagues.length > 400 || leagues.some((code) => !/^[a-z0-9-]{0,40}$/.test(code))) {
              respond(400, { error: 'Invalid league' });
              return;
            }
            const search = (url.searchParams.get('q') ?? '').slice(0, 200);
            const encoded = url.searchParams.get('cursor');
            let cursor: { r: number; t: string | null; id: string } | null = null;
            if (encoded) {
              try {
                cursor = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
              } catch {
                respond(400, { error: 'Invalid cursor' });
                return;
              }
              if (
                !cursor ||
                ![0, 1, 2].includes(cursor.r) ||
                typeof cursor.id !== 'string' ||
                !/^\d+$/.test(cursor.id) ||
                (cursor.t !== null &&
                  (typeof cursor.t !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.t)))
              ) {
                respond(400, { error: 'Invalid cursor' });
                return;
              }
            }
            const result = await query(SPORTS_GAMES, [
              leagues.length ? leagues : null,
              search,
              cursor?.r ?? null,
              cursor?.t ?? null,
              cursor?.id ?? null,
            ]);
            // One page is 50 games; markets come from every event of those games.
            const page = result.rows.slice(0, 50);
            const eventIds = page.flatMap((game) => game.events.map((event: { event_id: string }) => event.event_id));
            const markets = page.length ? await query(SPORTS_MARKETS, [eventIds, LIST_TYPES]) : { rows: [] };
            if (markets.rows.length > 20000) {
              respond(503, { error: 'This game page exceeds the display limit' });
              return;
            }
            const last = page.at(-1);
            const next =
              result.rows.length > 50 && last
                ? Buffer.from(JSON.stringify({ r: last.status_rank, t: last.start_key, id: last.event_id })).toString(
                    'base64url',
                  )
                : null;
            const games = page.map(({ status_rank: _rank, start_key: _key, ...game }) => game);
            respond(200, { games, markets: markets.rows, next });
          } else if (url.pathname === '/sports/game' && id && /^\d+$/.test(id)) {
            const game = await query(SPORTS_GAME_DETAIL, [id]);
            if (!game.rows.length) {
              respond(404, { error: 'Game is no longer open in the current scan' });
              return;
            }
            const eventIds = game.rows[0].events.map((event: { event_id: string }) => event.event_id);
            const markets = await query(SPORTS_MARKETS, [eventIds, null]);
            if (markets.rows.length > 20000) {
              respond(503, { error: 'This game exceeds the display limit' });
              return;
            }
            respond(200, { game: game.rows[0], markets: markets.rows });
          } else respond(404, { error: 'Unknown Live endpoint' });
        } catch (error) {
          console.error('Live reader failed', error instanceof Error ? error.message : 'unknown');
          respond(503, { error: 'Live data is unavailable. Check the local database.' });
        }
      });
    },
  };
}
