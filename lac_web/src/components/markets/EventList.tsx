import type { MarketEvent } from '../../data/catalog';
import { useEffect, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { EventCard } from './EventCard';
import styles from './EventList.module.css';

interface EventListProps {
  title: string;
  events: MarketEvent[];
  emptyText: string;
  selectedId: string | null;
  showPaths: boolean;
  signalCountByEvent: Record<string, number>;
  onSelect: (event: MarketEvent) => void;
  footer?: ReactNode;
}

export function EventList({
  title,
  events,
  emptyText,
  selectedId,
  showPaths,
  signalCountByEvent,
  onSelect,
  footer,
}: EventListProps) {
  const t = useT();
  useEffect(() => {
    if (selectedId) document.getElementById(`event-${selectedId}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  return (
    <section aria-label={t.markets.events} className={styles.list}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <span className={styles.count}>{t.markets.eventCount(events.length)}</span>
      </div>
      {events.length === 0 && <p className={styles.empty}>{emptyText}</p>}
      {events.map((event) => (
        <EventCard
          key={event.id}
          event={event}
          selected={event.id === selectedId}
          showPath={showPaths}
          signalCount={showPaths ? (signalCountByEvent[event.id] ?? 0) : 0}
          onSelect={() => onSelect(event)}
        />
      ))}
      {footer}
    </section>
  );
}
