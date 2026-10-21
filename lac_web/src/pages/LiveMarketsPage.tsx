import { useMemo, useState } from 'react';
import { amount, cents, dateTime, percent, useLive, type History, type LiveEvent, type LiveOutcome } from '../lib/live';
import styles from './LiveMarketsPage.module.css';

export function LiveMarketsPage({ category, query }: { category: string; query: string }) {
  // App keys this component by category/search so cursor and selection reset together.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<string | null>(null);
  const params = new URLSearchParams({ tag: category, q: query });
  const cursor = cursors.at(-1);
  if (cursor) params.set('cursor', cursor);
  const list = useLive<{ events: LiveEvent[]; next: string | null }>(`/api/live/events?${params}`, 30000);
  const active = selected ?? list.data?.events[0]?.event_id ?? null;
  return (
    <div className={styles.workspace}>
      <section className={styles.list} aria-label="Live events">
        <div className={styles.listHeading}><strong>Live markets</strong><span>24h volume ↓</span></div>
        {list.error && <p role="alert" className={styles.notice}>{list.error}</p>}
        {!list.data && !list.error && <p className={styles.notice}>Loading live events…</p>}
        {list.data?.events.length === 0 && <p className={styles.notice}>No open events match this selection.</p>}
        {list.data?.events.map(event => (
          <button key={event.event_id} type="button" className={`${styles.event} ${active === event.event_id ? styles.active : ''}`}
            aria-pressed={active === event.event_id} onClick={() => setSelected(event.event_id)}>
            <span className={styles.eventTitle}>{event.image_url && <img src={event.image_url} alt="" loading="lazy" />}<strong>{event.title}</strong></span>
            <span className={styles.muted}>{amount(event.volume_24h)} 24h · {amount(event.liquidity)} liquidity</span>
            {event.preview?.map(preview => <span key={preview.market_id} className={styles.preview}>
              <span>{preview.group_title ?? preview.label}</span><strong>{percent(preview.midpoint)}</strong>
            </span>)}
          </button>
        ))}
        <div className={styles.pager}>
          <button type="button" disabled={cursors.length === 1} onClick={() => { setCursors(previous => previous.slice(0, -1)); setSelected(null); }}>Previous</button>
          <span>Page {cursors.length}<small>50 per page</small></span>
          <button type="button" disabled={!list.data?.next} onClick={() => { const next = list.data?.next; if (next) { setCursors(previous => [...previous, next]); setSelected(null); } }}>Next</button>
        </div>
      </section>
      <section className={styles.detail} aria-label="Live event detail">
        {active ? <EventDetail key={active} id={active} /> : <p className={styles.notice}>Select an event to view its markets.</p>}
      </section>
    </div>
  );
}

function EventDetail({ id }: { id: string }) {
  type MarketCursor = { market_id: string; sort_order: number };
  const [marketCursors, setMarketCursors] = useState<(MarketCursor | null)[]>([null]);
  const after = marketCursors.at(-1);
  const detailUrl = `/api/live/event?id=${id}${after ? `&after_id=${after.market_id}&after_order=${after.sort_order}` : ''}`;
  const detail = useLive<{ event: LiveEvent; outcomes: LiveOutcome[]; marketCount: number; nextMarket: MarketCursor | null }>(detailUrl, 30000);
  const [asset, setAsset] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const markets = useMemo(() => {
    const grouped = new Map<string, LiveOutcome[]>();
    for (const outcome of detail.data?.outcomes ?? []) {
      const group = grouped.get(outcome.market_id) ?? [];
      group.push(outcome); grouped.set(outcome.market_id, group);
    }
    return [...grouped.values()];
  }, [detail.data]);
  if (detail.error) return <p role="alert" className={styles.notice}>{detail.error}</p>;
  if (!detail.data) return <p className={styles.notice}>Loading event and quotes…</p>;
  const { event, outcomes } = detail.data;
  const chosen = asset === null ? outcomes.find(outcome => outcome.asset_id !== null) : outcomes.find(outcome => outcome.asset_id === asset);
  return <>
    <div className={styles.eyebrow}><span className={styles.liveDot} /> POLYMARKET · LIVE</div>
    <h1>{event.title}</h1>
    <div className={styles.metrics}>
      <div><span>24h volume</span><strong>{amount(event.volume_24h)}</strong></div>
      <div><span>Total volume</span><strong>{amount(event.volume_total)}</strong></div>
      <div><span>Liquidity</span><strong>{amount(event.liquidity)}</strong></div>
      <div><span>Ends</span><strong>{event.end_at ? new Date(event.end_at).toLocaleDateString('en-US') : '—'}</strong></div>
    </div>
    <div className={styles.chartCard}>
      <div className={styles.chartHeading}><div><h2>Price history</h2><p className={styles.muted}>{chosen ? `${chosen.group_title ?? chosen.question} · ${chosen.label}` : 'No asset available'}</p></div><span className={styles.pill}>3 days · 1 min</span></div>
      {chosen?.asset_id ? <PriceHistory key={chosen.asset_id} asset={chosen.asset_id} /> : <p className={styles.notice}>Demo history covers the top 500 events only</p>}
    </div>
    <div className={styles.marketHeading}><h2>Outcomes <span className={styles.muted}>({detail.data.marketCount} markets)</span></h2><span className={styles.muted}>Chance = midpoint</span></div>
    <p className={styles.muted}>Live demo shows quotes only. Order execution is not connected.</p>
    {markets.map(group => {
      const main = group.find(outcome => outcome.label.toLowerCase() === 'yes') ?? group[0];
      const stamp = main.quote_observed_at;
      const stale = !stamp || Date.now() - Date.parse(stamp) > 1200000;
      return <article className={styles.market} key={main.market_id}>
        <div className={styles.marketTitle}><strong>{main.group_title ?? main.question}</strong><span className={styles.chance}>{percent(main.midpoint)}<small>{main.label} chance</small></span></div>
        <div className={styles.outcomes}>{group.map(outcome => <button key={outcome.outcome_index} type="button"
          className={outcome.asset_id === chosen?.asset_id ? styles.selectedOutcome : ''}
          disabled={!outcome.asset_id} onClick={() => setAsset(outcome.asset_id)}
          title={`${outcome.label}: bid ${cents(outcome.best_bid)}, midpoint ${percent(outcome.midpoint)}. Quote observed ${dateTime(outcome.quote_observed_at)}. Select to view history.`}>
          <span>Buy {outcome.label}</span><strong>{cents(outcome.best_ask)}</strong>
        </button>)}</div>
        <div className={styles.quoteMeta}><span>Quotes: {dateTime(stamp)} {stale ? '· Stale / unavailable' : ''}</span><span>{main.accepting_orders ? 'Accepting orders' : 'Not accepting orders'}</span></div>
        <div className={styles.quoteMeta}>Chance observed: {dateTime(main.mid_observed_at)}{!main.mid_observed_at || Date.now() - Date.parse(main.mid_observed_at) > 1200000 ? ' · Stale / unavailable' : ''}</div>
      </article>;
    })}
    {!markets.length && <p className={styles.notice}>No open markets are available for this event.</p>}
    {detail.data.marketCount > 50 && <div className={styles.pager}>
      <button disabled={marketCursors.length === 1} onClick={() => { setMarketCursors(value => value.slice(0, -1)); setAsset(null); }}>Previous markets</button>
      <span>{marketCursors.length} / {Math.ceil(detail.data.marketCount / 50)}</span>
      <button disabled={!detail.data.nextMarket} onClick={() => { const next = detail.data?.nextMarket; if (next) { setMarketCursors(value => [...value, next]); setAsset(null); } }}>Next markets</button>
    </div>}
    <section className={styles.rules}><h2>About this event</h2>
      <p className={expanded ? styles.description : styles.descriptionShort}>{event.description ?? 'No event description supplied.'}</p>
      {event.description && event.description.length > 350 && <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Read more'}</button>}
      {event.resolution_source && <p>Resolution source: {event.resolution_source}</p>}
      <a href={`https://polymarket.com/event/${encodeURIComponent(event.slug)}`} target="_blank" rel="noreferrer">View on Polymarket ↗</a>
      <p className={styles.muted}>Market metadata observed: {dateTime(event.observed_at)}</p>
    </section>
  </>;
}

function PriceHistory({ asset }: { asset: string }) {
  const history = useLive<History>(`/api/live/history?id=${asset}`);
  if (history.error) return <p role="alert" className={styles.notice}>{history.error}</p>;
  if (!history.data) return <p className={styles.notice}>Loading history…</p>;
  const { coverage, points } = history.data;
  if (!coverage) return <p className={styles.notice}>Demo history covers the top 500 events only</p>;
  if (coverage.status === 'error') return <p className={styles.notice}>History request failed. No substitute data is shown.</p>;
  if (!points.length) return <p className={styles.notice}>No price history returned for this asset in the requested window.</p>;
  const start = Date.parse(coverage.requested_start), end = Date.parse(coverage.requested_end);
  const x = (stamp: string) => 48 + ((Date.parse(stamp) - start) / (end - start)) * 700;
  const y = (price: string) => 205 - Number(price) * 180;
  const path = points.map((point, index) => {
    const previous = points[index - 1];
    const move = !previous || Date.parse(point.minute_at) - Date.parse(previous.minute_at) > 60000;
    return `${move ? 'M' : 'L'}${x(point.source_at).toFixed(2)},${y(point.price).toFixed(2)}`;
  }).join(' ');
  return <>
    <svg className={styles.chart} viewBox="0 0 780 245" role="img" aria-label={`Historical probability chart with ${points.length} observed minute points`}>
      {[0, .25, .5, .75, 1].map(value => <g key={value}><line x1="48" y1={205 - value * 180} x2="748" y2={205 - value * 180} stroke="#e6e8ef" /><text x="4" y={209 - value * 180} fill="#7a8193" fontSize="11">{value * 100}%</text></g>)}
      <path d={path} fill="none" stroke="#6558e8" strokeWidth="2" />
      <circle cx={x(points.at(-1)!.source_at)} cy={y(points.at(-1)!.price)} r="3" fill="#6558e8" />
      <text x="48" y="232" fill="#7a8193" fontSize="11">{dateTime(coverage.requested_start)}</text>
      <text x="748" y="232" textAnchor="end" fill="#7a8193" fontSize="11">{dateTime(coverage.requested_end)}</text>
    </svg>
    <p className={styles.muted}>{points.length.toLocaleString()} observed minute points · Gaps remain empty · Retrieved {dateTime(coverage.checked_at)}</p>
  </>;
}
