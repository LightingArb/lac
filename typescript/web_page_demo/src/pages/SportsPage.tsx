import { useEffect, useRef, type ReactNode } from 'react';
import { SportsDetail } from '../components/sports/SportsDetail';
import { SportsList } from '../components/sports/SportsList';
import { useT } from '../i18n';
import type { OddsFormat, SportsWorkspace } from '../lib/sports';
import { NO_MARKS, type CellMarks } from '../lib/sportsSignals';
import styles from './MarketsPage.module.css';

interface SportsPageProps {
  sports: SportsWorkspace;
  format: OddsFormat;
  listFooter?: ReactNode;
  /** Subscribers: ROI on the cells with signals, and the cell of the card picked in the signals column. */
  marks?: CellMarks;
}

/** Sports: games beside the picked game's markets; stacked when the content area is narrow, like Prediction. */
export function SportsPage({ sports, format, listFooter, marks = NO_MARKS }: SportsPageProps) {
  const t = useT();
  const layoutRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const emptyText = sports.error ?? (sports.loading ? t.sports.loading : t.sports.noGames);

  // A picked card brings its line into view in the detail, as a picked signal does on the Signal page.
  const pickedMarket = marks.picked?.marketId;
  const selectedId = sports.selected?.id;
  useEffect(() => {
    if (pickedMarket && selectedId) {
      document.getElementById(`line-${pickedMarket}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [pickedMarket, selectedId]);

  return (
    <div ref={layoutRef} className={styles.workspace}>
      <SportsList
        title={sports.label}
        games={sports.games}
        emptyText={emptyText}
        selectedId={sports.selected?.id ?? null}
        format={format}
        footer={listFooter}
        marks={marks}
        onSelect={(game) => {
          sports.pick(game);
          const layout = layoutRef.current;
          if (layout && getComputedStyle(layout).flexDirection === 'column') {
            detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }}
      />
      <SportsDetail
        ref={detailRef}
        game={sports.selected}
        format={format}
        marks={marks}
        emptyText={sports.error ?? (sports.detailLoading ? t.sports.loading : t.sports.pickGame)}
      />
    </div>
  );
}
