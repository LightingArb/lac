import { useState, type MouseEvent, type Ref } from 'react';
import type { MarketEvent } from '../../data/catalog';
import { count, edge, money, plural, price } from '../../lib/format';
import { marketAnchorId, type PricedSignal } from '../../lib/markets';
import { Icon, type IconName } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Switch } from '../ui/Switch';
import { EventBadge } from './EventBadge';
import { LacFairTable } from './LacFairTable';
import { MarketsTable } from './MarketsTable';
import { LiveIndicator, TeamAvatar } from './MatchParts';
import { PriceChart } from './PriceChart';
import styles from './EventDetail.module.css';

/** Markets under this volume are hidden by "Hide low-liquidity markets". */
const LOW_LIQUIDITY = 25_000;

interface EventDetailProps {
  ref?: Ref<HTMLElement>;
  event: MarketEvent | null;
  /** Signal page shows LAC fair values instead of buy buttons. */
  showFairValues: boolean;
  signalByCell: Record<string, PricedSignal>;
  highlight: PricedSignal | null;
  onClearHighlight: () => void;
}

export function EventDetail({ ref, event, showFairValues, signalByCell, highlight, onClearHighlight }: EventDetailProps) {
  const [hideLow, setHideLow] = useState(false);

  if (!event) {
    return (
      <section ref={ref} aria-label="Event detail" className={styles.detail}>
        <p className={styles.empty}>Pick an event to see its markets.</p>
      </section>
    );
  }

  const outcomes = event.rows.filter(
    (r) => !hideLow || r.vol >= LOW_LIQUIDITY || r.id === highlight?.outcomeId,
  );
  const hidden = event.rows.length - outcomes.length;

  return (
    <section ref={ref} aria-label="Event detail" className={styles.detail}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <EventBadge event={event} size="lg" />
          <span className={styles.heading}>
            <h1 className={styles.title}>{event.title}</h1>
            {showFairValues && event.lac && <span className={styles.path}>{event.lac.path}</span>}
          </span>
          <IconButton label="Share event" icon="share" />
          <IconButton label="Bookmark event" icon="star" />
        </div>

        {event.match && (
          <div className={styles.scoreboard}>
            <LiveIndicator className={styles.scoreboardLive}>LIVE · {event.match.mapText}</LiveIndicator>
            <div className={styles.scoreRow}>
              <TeamAvatar abbr={event.match.aAbbr} team="a" size="sm" />
              <span className={styles.scoreTeam}>{event.match.teamA}</span>
              <span className={styles.scoreValue}>{event.match.scoreA}</span>
            </div>
            <div className={styles.scoreRow}>
              <TeamAvatar abbr={event.match.bAbbr} team="b" size="sm" />
              <span className={styles.scoreTeam}>{event.match.teamB}</span>
              <span className={styles.scoreValue}>{event.match.scoreB}</span>
            </div>
          </div>
        )}

        <div className={styles.tags}>
          {event.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
        </div>

        {highlight && <SignalHighlight signal={highlight} onClear={onClearHighlight} />}

        <div className={styles.stats}>
          <Stat icon="clock" label="Start" value={event.start} />
          <Stat icon="clock" label="End" value={event.end} />
          <Stat icon="volume" label="24h volume" value={money(event.vol24)} />
          <Stat icon="volume" label="Total volume" value={money(event.volTotal)} />
        </div>

        <PriceChart event={event} />

        <div className={styles.markets}>
          <div className={styles.marketsHeader}>
            <h2 className={styles.marketsTitle}>{showFairValues ? 'Markets · LAC fair value' : 'Markets'}</h2>
            <Switch label="Hide low-liquidity markets" checked={hideLow} onChange={setHideLow} />
          </div>
          {hidden > 0 && (
            <span className={styles.hiddenNote}>{plural(hidden, 'market', 'markets')} under $25K volume hidden</span>
          )}
          {showFairValues ? (
            <LacFairTable event={event} outcomes={outcomes} signalByCell={signalByCell} highlight={highlight} />
          ) : (
            <MarketsTable event={event} outcomes={outcomes} />
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>
        <Icon name={icon} size={16} />
        {label}
      </span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

function SignalHighlight({ signal, onClear }: { signal: PricedSignal; onClear: () => void }) {
  const anchor = marketAnchorId(signal.eventId, signal.outcomeId);
  const goToMarket = (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={styles.highlight}>
      <span className={styles.highlightText}>
        <span className={styles.highlightEyebrow}>LAC signal</span>
        <span className={styles.highlightTitle}>
          {signal.title} · {signal.sideLabel}
        </span>
        <span className={styles.highlightMeta}>
          EV +{price(signal.ev)} · Entry {price(signal.entry)} · Fair {price(signal.fair)} ({edge(signal.fair, signal.entry)}) ·
          Avg. Cost {price(signal.avg)} ({count(signal.depth)})
        </span>
      </span>
      <a href={`#${anchor}`} className={styles.highlightGo} onClick={goToMarket}>
        Go to market
      </a>
      <button type="button" className={styles.highlightClear} onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
