import { useRef, type ReactNode } from 'react';
import { SportsDetail } from '../components/sports/SportsDetail';
import { SportsList } from '../components/sports/SportsList';
import { useT } from '../i18n';
import type { OddsFormat, SportsWorkspace } from '../lib/sports';
import styles from './MarketsPage.module.css';

interface SportsPageProps {
  sports: SportsWorkspace;
  format: OddsFormat;
  listFooter?: ReactNode;
}

/** Sports: games beside the picked game's markets; stacked when the content area is narrow, like Prediction. */
export function SportsPage({ sports, format, listFooter }: SportsPageProps) {
  const t = useT();
  const layoutRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const emptyText = sports.error ?? (sports.loading ? t.sports.loading : t.sports.noGames);
  return (
    <div ref={layoutRef} className={styles.workspace}>
      <SportsList
        title={sports.label}
        games={sports.games}
        emptyText={emptyText}
        selectedId={sports.selected?.id ?? null}
        format={format}
        footer={listFooter}
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
        emptyText={sports.error ?? (sports.detailLoading ? t.sports.loading : t.sports.pickGame)}
      />
    </div>
  );
}
