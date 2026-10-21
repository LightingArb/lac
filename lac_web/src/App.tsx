import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { BuyUsdtDialog } from './components/BuyUsdtDialog';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { SignalPanel } from './components/signals/SignalPanel';
import { Drawer } from './components/ui/Drawer';
import { CUSTOMER_PLAN, type CategoryId } from './data/catalog';
import { DEFAULT_PREFERENCES, type Preferences } from './data/preferences';
import { DEFAULT_REFERRAL_CODE } from './data/referral';
import {
  INITIAL_WORKSPACE,
  deriveWorkspace,
  type PricedSignal,
  type SignalCategoryId,
  type WorkspaceState,
} from './lib/markets';
import { COMPACT_QUERY, MOBILE_QUERY, useMediaQuery } from './lib/useMediaQuery';
import { MarketsPage } from './pages/MarketsPage';
import { LiveMarketsPage } from './pages/LiveMarketsPage';
import { useLive, type DataMode, type LiveCategory } from './lib/live';
import { ProductsPage } from './pages/ProductsPage';
import { ReferralPage } from './pages/ReferralPage';
import { SettingsPage } from './pages/SettingsPage';
import { StocksPage } from './pages/StocksPage';
import styles from './App.module.css';

type Mode = 'prediction' | 'signal' | 'stocks' | 'products' | 'referral' | 'settings';

const MODE_LABELS: Record<Mode, string> = {
  prediction: 'Prediction',
  signal: 'Signal',
  stocks: 'Stocks',
  products: 'Products',
  referral: 'Referral rewards',
  settings: 'Settings',
};

function modeFromPath(pathname: string): Mode {
  const segment = pathname.split('/')[1];
  return segment in MODE_LABELS ? (segment as Mode) : 'prediction';
}

export default function App() {
  const mode = modeFromPath(useLocation().pathname);
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const signalsInDrawer = useMediaQuery(COMPACT_QUERY);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [signalsOpen, setSignalsOpen] = useState(true);
  // On narrow screens navigation and signals live in drawers instead of side columns.
  const [menuDrawerOpen, setMenuDrawerOpen] = useState(false);
  const [signalsDrawerOpen, setSignalsDrawerOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [state, setState] = useState<WorkspaceState>(INITIAL_WORKSPACE);
  const [referralCode, setReferralCode] = useState(DEFAULT_REFERRAL_CODE);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [dataMode, setDataMode] = useState<DataMode>('demo');
  const [liveCategory, setLiveCategory] = useState('trending');
  const [liveQuery, setLiveQuery] = useState('');
  const liveCategories = useLive<{ categories: LiveCategory[] }>(dataMode === 'live' && mode === 'prediction' ? '/api/live/categories' : null, 600000);

  const update = (patch: Partial<WorkspaceState>) => setState((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (!isMobile) setMenuDrawerOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!signalsInDrawer) setSignalsDrawerOpen(false);
  }, [signalsInDrawer]);

  const workspace = useMemo(
    () => (dataMode === 'demo' && (mode === 'prediction' || mode === 'signal') ? deriveWorkspace(mode, state, CUSTOMER_PLAN) : null),
    [mode, state, dataMode],
  );

  const pickCategory = (id: string) => {
    if (dataMode === 'live') { setLiveCategory(id); setLiveQuery(''); return; }
    update(
      mode === 'signal'
        ? { signalCategory: id as SignalCategoryId, query: '' }
        : { predictionCategory: id as CategoryId, query: '' },
    );
  };

  const pickSignal = (signal: PricedSignal) => {
    // Keep the current category if the signal's event is listed in it.
    const active = workspace?.activeCategory;
    const keep = active === 'trending' || active === signal.product;
    update({
      signalEventId: signal.eventId,
      highlightId: signal.id,
      signalCategory: keep ? state.signalCategory : 'trending',
      query: '',
    });
  };

  // Keyed by mode so Prediction and Signal don't share scroll position or chart settings.
  const marketsPage = workspace && (
    <MarketsPage
      key={mode}
      workspace={workspace}
      onSelectEvent={(event) =>
        update(mode === 'signal' ? { signalEventId: event.id, highlightId: null } : { predictionEventId: event.id })
      }
      onClearHighlight={() => update({ highlightId: null })}
    />
  );

  // Every sidebar action also closes the drawer, so the result is visible straight away.
  const sidebarProps = {
    onNavigate: () => {
      update({ query: '' });
      setMenuDrawerOpen(false);
    },
    onBuyUsdt: () => {
      setMenuDrawerOpen(false);
      setBuyOpen(true);
    },
    categories: dataMode === 'live' && mode === 'prediction'
      ? liveCategories.data?.categories.map(category => ({ ...category, icon: 'prediction' as const, active: category.id === liveCategory })) ?? null
      : workspace?.categories ?? null,
    categoryHeading: mode === 'signal' ? 'Signal categories' : 'Categories',
    onPickCategory: (id: string) => {
      pickCategory(id);
      setMenuDrawerOpen(false);
    },
    language: preferences.language,
    dataMode,
    onDataMode: setDataMode,
  };

  const signalPanelProps = workspace && {
    signals: workspace.signals,
    products: workspace.visibleProducts,
    activeId: state.highlightId,
  };

  return (
    <div className={styles.shell}>
      {isMobile ? (
        <Drawer open={menuDrawerOpen} onClose={() => setMenuDrawerOpen(false)} label="Menu">
          <Sidebar variant="drawer" open onToggle={() => setMenuDrawerOpen(false)} {...sidebarProps} />
        </Drawer>
      ) : (
        <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((open) => !open)} {...sidebarProps} />
      )}

      <main className={styles.main}>
        <TopBar
          trail={
            workspace
              ? [MODE_LABELS[mode], workspace.searching ? 'Search' : workspace.categoryLabel]
              : [MODE_LABELS[mode]]
          }
          current={workspace?.selected?.title ?? null}
          search={dataMode === 'live' && mode === 'prediction' ? { value: liveQuery, onChange: setLiveQuery } : workspace ? { value: state.query, onChange: (query) => update({ query }) } : null}
          onOpenMenu={isMobile ? () => setMenuDrawerOpen(true) : undefined}
          signals={
            signalsInDrawer && mode === 'signal' && workspace
              ? { count: workspace.signals.length, onOpen: () => setSignalsDrawerOpen(true) }
              : null
          }
        />
        <Routes>
          <Route index element={<Navigate to="/prediction" replace />} />
          <Route path="prediction" element={dataMode === 'live' ? <LiveMarketsPage key={`${liveCategory}:${liveQuery}`} category={liveCategory} query={liveQuery} /> : marketsPage} />
          <Route path="signal" element={dataMode === 'live' ? <div style={{ padding: '40px', color: 'var(--color-text-muted)' }}>No LAC signals in Live demo</div> : marketsPage} />
          <Route path="stocks" element={<StocksPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="referral" element={<ReferralPage code={referralCode} />} />
          <Route
            path="settings"
            element={
              <SettingsPage
                referralCode={referralCode}
                onReferralCodeChange={setReferralCode}
                preferences={preferences}
                onPreferencesChange={setPreferences}
              />
            }
          />
          <Route path="*" element={<Navigate to="/prediction" replace />} />
        </Routes>
      </main>

      {mode === 'signal' &&
        signalPanelProps &&
        (signalsInDrawer ? (
          <Drawer open={signalsDrawerOpen} onClose={() => setSignalsDrawerOpen(false)} side="right" label="LAC signals">
            <SignalPanel
              variant="drawer"
              open
              onToggle={() => setSignalsDrawerOpen(false)}
              onSelect={(signal) => {
                setSignalsDrawerOpen(false);
                pickSignal(signal);
              }}
              {...signalPanelProps}
            />
          </Drawer>
        ) : (
          <SignalPanel
            open={signalsOpen}
            onToggle={() => setSignalsOpen((open) => !open)}
            onSelect={pickSignal}
            {...signalPanelProps}
          />
        ))}

      {buyOpen && <BuyUsdtDialog onClose={() => setBuyOpen(false)} />}
    </div>
  );
}
