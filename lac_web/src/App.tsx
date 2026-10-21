import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { BuyUsdtDialog } from './components/BuyUsdtDialog';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { SignalPanel } from './components/signals/SignalPanel';
import { Drawer } from './components/ui/Drawer';
import { CUSTOMER_PLAN, type CategoryId } from './data/catalog';
import type { Preferences } from './data/preferences';
import { DEFAULT_REFERRAL_CODE, MY_AGENTS } from './data/referral';
import type { Backend } from './data/backend';
import type { WithdrawalDraft } from './data/withdrawals';
import { useT } from './i18n';
import {
  INITIAL_WORKSPACE,
  deriveWorkspace,
  type PricedSignal,
  type SignalCategoryId,
  type WorkspaceState,
} from './lib/markets';
import { COMPACT_QUERY, MOBILE_QUERY, useMediaQuery } from './lib/useMediaQuery';
import { MarketsPage } from './pages/MarketsPage';
import { useLiveWorkspace, type DataMode } from './lib/live';
import { ProductsPage } from './pages/ProductsPage';
import { ReferralPage } from './pages/ReferralPage';
import { SettingsPage } from './pages/SettingsPage';
import { StocksPage } from './pages/StocksPage';
import styles from './App.module.css';

type Mode = 'prediction' | 'signal' | 'stocks' | 'products' | 'referral' | 'settings';

const MODES: Mode[] = ['prediction', 'signal', 'stocks', 'products', 'referral', 'settings'];

function modeFromPath(pathname: string): Mode {
  const segment = pathname.split('/')[1] as Mode;
  return MODES.includes(segment) ? segment : 'prediction';
}

interface AppProps {
  backend: Backend;
  onWithdraw: (draft: WithdrawalDraft) => void;
  preferences: Preferences;
  onPreferencesChange: (preferences: Preferences) => void;
  onToggleLanguage: () => void;
}

export default function App({
  backend,
  onWithdraw,
  preferences,
  onPreferencesChange,
  onToggleLanguage,
}: AppProps) {
  const t = useT();
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
  const [agents, setAgents] = useState(MY_AGENTS);
  const [referralCode, setReferralCode] = useState(DEFAULT_REFERRAL_CODE);
  const [dataMode, setDataMode] = useState<DataMode>('demo');
  const [liveCategory, setLiveCategory] = useState('trending');
  const [liveQuery, setLiveQuery] = useState('');
  const live = useLiveWorkspace(dataMode === 'live' && mode === 'prediction', liveCategory, liveQuery);

  const update = (patch: Partial<WorkspaceState>) => setState((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (!isMobile) setMenuDrawerOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!signalsInDrawer) setSignalsDrawerOpen(false);
  }, [signalsInDrawer]);

  const demoWorkspace = useMemo(
    () =>
      dataMode === 'demo' && (mode === 'prediction' || mode === 'signal')
        ? deriveWorkspace(mode, state, CUSTOMER_PLAN, t)
        : null,
    [mode, state, dataMode, t],
  );

  const workspace = dataMode === 'live' ? live.workspace : demoWorkspace;

  const pickCategory = (id: string) => {
    if (dataMode === 'live') {
      setLiveCategory(id);
      setLiveQuery('');
      return;
    }
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
      key={`${mode}:${dataMode}`}
      workspace={workspace}
      error={live.error}
      listFooter={
        dataMode === 'live' && (
          <nav className={styles.pagination} aria-label={t.app.eventPages}>
            <button disabled={live.page === 1} onClick={live.previous}>
              {t.common.previous}
            </button>
            <span>{t.app.page(live.page)}</span>
            <button disabled={!live.hasNext} onClick={live.next}>
              {t.common.next}
            </button>
          </nav>
        )
      }
      detailFooter={
        dataMode === 'live' &&
        live.marketCount > 50 && (
          <nav className={styles.pagination} aria-label={t.app.marketPages}>
            <button disabled={live.marketPage === 1} onClick={live.previousMarket}>
              {t.app.previousMarkets}
            </button>
            <span>{t.app.marketPage(live.marketPage, live.marketCount)}</span>
            <button disabled={!live.hasNextMarket} onClick={live.nextMarket}>
              {t.app.nextMarkets}
            </button>
          </nav>
        )
      }
      onSelectEvent={(event) =>
        dataMode === 'live'
          ? live.pick(event)
          : update(mode === 'signal' ? { signalEventId: event.id, highlightId: null } : { predictionEventId: event.id })
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
    categories: workspace?.categories ?? null,
    categoryHeading: mode === 'signal' ? t.nav.signalCategories : t.nav.categories,
    onPickCategory: (id: string) => {
      pickCategory(id);
      setMenuDrawerOpen(false);
    },
    language: preferences.language,
    onToggleLanguage,
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
        <Drawer open={menuDrawerOpen} onClose={() => setMenuDrawerOpen(false)} label={t.nav.menu}>
          <Sidebar variant="drawer" open onToggle={() => setMenuDrawerOpen(false)} {...sidebarProps} />
        </Drawer>
      ) : (
        <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((open) => !open)} {...sidebarProps} />
      )}

      <main className={styles.main}>
        <TopBar
          trail={
            workspace
              ? [t.nav[mode], workspace.searching ? t.common.search : workspace.categoryLabel]
              : [t.nav[mode]]
          }
          current={workspace?.selected?.title ?? null}
          search={
            dataMode === 'live' && mode === 'prediction'
              ? { value: liveQuery, onChange: setLiveQuery }
              : workspace
                ? { value: state.query, onChange: (query) => update({ query }) }
                : null
          }
          onOpenMenu={isMobile ? () => setMenuDrawerOpen(true) : undefined}
          signals={
            signalsInDrawer && mode === 'signal' && workspace
              ? { count: workspace.signals.length, onOpen: () => setSignalsDrawerOpen(true) }
              : null
          }
        />
        <Routes>
          <Route index element={<Navigate to="/prediction" replace />} />
          <Route path="prediction" element={marketsPage} />
          <Route
            path="signal"
            element={
              dataMode === 'live' ? (
                <div style={{ padding: '40px', color: 'var(--color-text-muted)' }}>{t.app.noLiveSignals}</div>
              ) : (
                marketsPage
              )
            }
          />
          <Route path="stocks" element={<StocksPage />} />
          <Route path="products" element={<ProductsPage items={backend.items} versions={backend.versions} />} />
          <Route
            path="referral"
            element={
              <ReferralPage
                code={referralCode}
                agents={agents}
                onAgentsChange={setAgents}
                withdrawals={backend.withdrawals}
                onWithdraw={onWithdraw}
              />
            }
          />
          <Route
            path="settings"
            element={
              <SettingsPage
                referralCode={referralCode}
                onReferralCodeChange={setReferralCode}
                preferences={preferences}
                onPreferencesChange={onPreferencesChange}
              />
            }
          />
          <Route path="*" element={<Navigate to="/prediction" replace />} />
        </Routes>
      </main>

      {mode === 'signal' &&
        signalPanelProps &&
        (signalsInDrawer ? (
          <Drawer open={signalsDrawerOpen} onClose={() => setSignalsDrawerOpen(false)} side="right" label={t.signals.panel}>
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
