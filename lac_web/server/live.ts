import { Pool } from 'pg';
import type { Plugin } from 'vite';

const OPEN = 'e.in_current_scan AND e.active AND NOT e.closed AND NOT e.archived';
const MARKET_OPEN = 'm.in_current_scan AND m.active AND NOT m.closed AND NOT m.archived';

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
        host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME,
        user: env.DB_USER, password: env.DB_PASSWORD, max: 4,
        connectionTimeoutMillis: 5000,
        options: '-c default_transaction_read_only=on -c statement_timeout=15000',
      });
      server.httpServer?.once('close', () => { void pool.end(); });
      server.middlewares.use('/api/live', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        const respond = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
        if (req.method !== 'GET') { respond(405, { error: 'Read-only endpoint' }); return; }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const id = url.searchParams.get('id');
          if (url.pathname === '/categories') {
            const result = await query(`
              WITH eligible AS (SELECT e.event_id,e.tags FROM m_live.m01_gamma_event e WHERE ${OPEN}),
              tagged AS (
                SELECT e.event_id,t->>'id' AS id,t->>'label' AS label
                FROM eligible e CROSS JOIN LATERAL jsonb_array_elements(e.tags) t
              )
              SELECT id,MIN(label) AS label,COUNT(DISTINCT event_id)::int AS count FROM tagged
              GROUP BY id ORDER BY count DESC,id LIMIT 12`);
            const total = await query(`SELECT COUNT(e.event_id)::int AS count,MAX(e.observed_at) AS observed_at
              FROM m_live.m01_gamma_event e WHERE ${OPEN}`);
            respond(200, { categories: [{ id: 'trending', label: 'Trending', count: total.rows[0].count }, ...result.rows], observedAt: total.rows[0].observed_at });
          } else if (url.pathname === '/events') {
            const tag = url.searchParams.get('tag') ?? 'trending';
            const search = (url.searchParams.get('q') ?? '').slice(0, 200);
            const encoded = url.searchParams.get('cursor');
            let cursor: { v: string | null; id: string } | null = null;
            if (encoded) {
              try { cursor = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
              catch { respond(400, { error: 'Invalid cursor' }); return; }
              if (!cursor || typeof cursor.id !== 'string' || !/^\d+$/.test(cursor.id) ||
                (cursor.v !== null && (typeof cursor.v !== 'string' || !/^\d+(\.\d+)?$/.test(cursor.v)))) {
                respond(400, { error: 'Invalid cursor' }); return;
              }
            }
            const result = await query(`
              SELECT e.event_id,e.slug,e.title,e.image_url,e.volume_24h,e.volume_total,e.liquidity,e.end_at,e.observed_at
              FROM m_live.m01_gamma_event e WHERE ${OPEN}
                AND ($1='trending' OR e.tags @> $2::jsonb)
                AND ($3='' OR e.title ILIKE '%' || $3 || '%')
                AND ($4::text IS NULL OR
                  ($5::numeric IS NOT NULL AND (e.volume_24h<$5 OR (e.volume_24h=$5 AND e.event_id>$4) OR e.volume_24h IS NULL)) OR
                  ($5::numeric IS NULL AND e.volume_24h IS NULL AND e.event_id>$4))
              ORDER BY e.volume_24h DESC NULLS LAST,e.event_id LIMIT 51`,
            [tag, JSON.stringify([{ id: tag }]), search, cursor?.id ?? null, cursor?.v ?? null]);
            const events = result.rows.slice(0, 50);
            const summaries = events.length ? await query(`
              SELECT chosen.event_id,m.market_id,m.group_title,m.question,o.label,p.midpoint,p.best_ask
              FROM unnest($1::text[]) AS chosen(event_id)
              CROSS JOIN LATERAL (
                SELECT m.market_id,m.group_title,m.question,m.sort_order FROM m_live.m01_gamma_market m
                WHERE m.event_id=chosen.event_id AND ${MARKET_OPEN}
                ORDER BY m.sort_order,m.market_id LIMIT 3
              ) m
              CROSS JOIN LATERAL (
                SELECT o.label,o.asset_id FROM m_live.m01_gamma_outcome o WHERE o.market_id=m.market_id
                ORDER BY CASE WHEN lower(o.label)='yes' THEN 0 ELSE 1 END,o.outcome_index LIMIT 1
              ) o LEFT JOIN m_live.m02_clob_price p ON p.asset_id=o.asset_id
              ORDER BY chosen.event_id,m.sort_order,m.market_id`, [events.map(event => event.event_id)]) : { rows: [] };
            for (const event of events) event.preview = summaries.rows.filter(row => row.event_id === event.event_id);
            const last = events.at(-1);
            const next = result.rows.length > 50 && last ? Buffer.from(JSON.stringify({ v: last.volume_24h, id: last.event_id })).toString('base64url') : null;
            respond(200, { events, next });
          } else if (url.pathname === '/event' && id && /^\d+$/.test(id)) {
            const afterId = url.searchParams.get('after_id');
            const afterOrder = url.searchParams.get('after_order');
            if ((afterId !== null || afterOrder !== null) && (!afterId || !/^\d+$/.test(afterId) || !afterOrder || !/^\d{1,9}$/.test(afterOrder))) {
              respond(400, { error: 'Invalid market cursor' }); return;
            }
            const event = await query(`SELECT e.event_id,e.slug,e.title,e.description,e.resolution_source,e.image_url,
              e.start_at,e.end_at,e.volume_24h,e.volume_total,e.liquidity,e.tags,e.observed_at
              FROM m_live.m01_gamma_event e WHERE ${OPEN} AND e.event_id=$1`, [id]);
            if (!event.rows.length) { respond(404, { error: 'Event is no longer open in the current scan' }); return; }
            const page = await query(`SELECT m.market_id,m.sort_order FROM m_live.m01_gamma_market m
              WHERE m.event_id=$1 AND ${MARKET_OPEN} AND ($2::text IS NULL OR m.sort_order>$3::int OR (m.sort_order=$3::int AND m.market_id>$2))
              ORDER BY m.sort_order,m.market_id LIMIT 51`, [id, afterId, afterOrder]);
            const visibleMarkets = page.rows.slice(0, 50);
            const total = await query(`SELECT COUNT(m.market_id)::int AS count FROM m_live.m01_gamma_market m
              WHERE m.event_id=$1 AND ${MARKET_OPEN}`, [id]);
            const markets = await query(`
              SELECT m.market_id,m.sort_order,m.question,m.group_title,m.description,m.resolution_source,m.end_at,
                m.accepting_orders,m.enable_order_book,o.outcome_index,o.label,o.asset_id,
                p.best_bid,p.best_ask,p.midpoint,p.last_trade_price,p.quote_observed_at,p.mid_observed_at
              FROM m_live.m01_gamma_market m JOIN m_live.m01_gamma_outcome o ON o.market_id=m.market_id
              LEFT JOIN m_live.m02_clob_price p ON p.asset_id=o.asset_id
              WHERE m.market_id=ANY($1::text[])
              ORDER BY m.sort_order,m.market_id,o.outcome_index LIMIT 10001`, [visibleMarkets.map(market => market.market_id)]);
            if (markets.rows.length > 10000) { respond(503, { error: 'This market page exceeds the display limit' }); return; }
            respond(200, { event: event.rows[0], outcomes: markets.rows, marketCount: total.rows[0].count,
              nextMarket: page.rows.length > 50 ? visibleMarkets.at(-1) : null });
          } else if (url.pathname === '/history' && id && /^\d{1,128}$/.test(id)) {
            const coverage = await query(`SELECT asset_id,requested_start,requested_end,checked_at,status,point_count,error_reason
              FROM m_historical.m01_polymarket_coverage WHERE asset_id=$1`, [id]);
            const points = coverage.rows[0]?.status === 'success' ? await query(`
              SELECT p.minute_at,p.source_at,p.price,p.resolution_seconds FROM m_historical.m01_polymarket_price p
              JOIN m_historical.m01_polymarket_coverage c ON c.asset_id=p.asset_id
              WHERE p.asset_id=$1 AND p.source_at>=c.requested_start AND p.source_at<c.requested_end
              ORDER BY p.minute_at`, [id]) : { rows: [] };
            respond(200, { coverage: coverage.rows[0] ?? null, points: points.rows });
          } else respond(404, { error: 'Unknown Live endpoint' });
        } catch (error) {
          console.error('Live reader failed', error instanceof Error ? error.message : 'unknown');
          respond(503, { error: 'Live data is unavailable. Check the local database and crawler.' });
        }
      });
    },
  };
}
