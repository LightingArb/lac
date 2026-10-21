import { useEffect, useRef } from 'react';
import type { MarketEvent } from '../data/catalog';
import { EventDetail } from '../components/markets/EventDetail';
import { EventList } from '../components/markets/EventList';
import type { Workspace } from '../lib/markets';
import styles from './MarketsPage.module.css';

interface MarketsPageProps {
  workspace: Workspace;
  onSelectEvent: (event: MarketEvent) => void;
  onClearHighlight: () => void;
}

/**
 * Prediction and Signal pages: event list beside the event detail, or above it when
 * the content area is narrow (see the container query in MarketsPage.module.css).
 */
export function MarketsPage({ workspace: ws, onSelectEvent, onClearHighlight }: MarketsPageProps) {
  const isSignal = ws.mode === 'signal';
  const layoutRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);

  // When stacked, the detail sits below the list, so bring it into view after a pick.
  const revealDetail = () => {
    const layout = layoutRef.current;
    if (layout && getComputedStyle(layout).flexDirection === 'column') {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const highlightId = ws.highlight?.id;
  useEffect(() => {
    if (highlightId) revealDetail();
  }, [highlightId]);

  return (
    <div ref={layoutRef} className={styles.workspace}>
      <EventList
        title={ws.searching ? 'Search results' : ws.categoryLabel}
        events={ws.events}
        emptyText={ws.emptyText}
        selectedId={ws.selected?.id ?? null}
        showPaths={isSignal}
        signalCountByEvent={ws.signalCountByEvent}
        onSelect={(event) => {
          onSelectEvent(event);
          revealDetail();
        }}
      />
      <EventDetail
        ref={detailRef}
        event={ws.selected}
        showFairValues={isSignal}
        signalByCell={ws.signalByCell}
        highlight={ws.highlight}
        onClearHighlight={onClearHighlight}
      />
    </div>
  );
}
