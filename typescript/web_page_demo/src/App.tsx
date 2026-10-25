import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { BuyUsdtDialog } from './components/BuyUsdtDialog';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { SignalPanel } from './components/signals/SignalPanel';
import { TradingTerminal } from './components/terminal/TradingTerminal';
import { Drawer } from './components/ui/Drawer';
import { SegmentedControl } from './components/ui/SegmentedControl';
import { CUSTOMER_PLAN, type CategoryId } from './data/catalog';
import type { Preferences } from './data/preferences';
import { DEFAULT_REFERRAL_CODE, MY_AGENTS } from './data/referral';
import { DEMO_ACCOUNT, type Position } from './data/terminal';
import type { Backend } from './data/backend';
import type { WithdrawalDraft } from './data/withdrawals';
import { useT } from './i18n';
import {
  INITIAL_WORKSPACE,
  deriveWorkspace,
  focusHighlight,
  type Highlight,
  type SignalCategoryId,
  type WorkspaceState,
} from './lib/markets';
import { useSportsWorkspace, type OddsFormat } from './lib/sports';
import { COMPACT_QUERY, MOBILE_QUERY, TERMINAL_QUERY, useMediaQuery } from './lib/useMediaQuery';
import { MarketsPage } from './pages/MarketsPage';
import { useLiveWorkspace, type DataMode } from './lib/live';
import { ProductsPage } from './pages/ProductsPage';
import { ReferralPage } from './pages/ReferralPage';
import { SettingsPage } from './pages/SettingsPage';
import { SportsPage } from './pages/SportsPage';
import { StocksPage } from './pages/StocksPage';
import styles from './App.module.css';

type Mode = 'prediction' | 'signal' | 'sports' | 'stocks' | 'products' | 'referral' | 'settings';

const MODES: Mode[] = ['prediction', 'signal', 'sports', 'stocks', 'products', 'referral', 'settings'];

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
  const terminalInDrawer = useMediaQuery(TERMINAL_QUERY);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [signalsOpen, setSignalsOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(true);
  // On narrow screens navigation, signals and the terminal live in drawers instead of side columns.
  const [menuDrawerOpen, setMenuDrawerOpen] = useState(false);
  const [signalsDrawerOpen, setSignalsDrawerOpen] = useState(false);
  const [terminalDrawerOpen, setTerminalDrawerOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [state, setState] = useState<WorkspaceState>(INITIAL_WORKSPACE);
  const [agents, setAgents] = useState(MY_AGENTS);
  const [referralCode, setReferralCode] = useState(DEFAULT_REFERRAL_CODE);
  const [dataMode, setDataMode] = useState<DataMode>('demo');
  const [liveCategory, setLiveCategory] = useState('trending');
  const [liveQuery, setLiveQuery] = useState('');
  const live = useLiveWorkspace(dataMode === 'live' && mode === 'prediction', liveCategory, liveQuery);
  const [sportsQuery, setSportsQuery] = useState('');
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>('decimal');
  const sports = useSportsWorkspace(mode === 'sports', dataMode, sportsQuery);
  // The terminal is Demo-only for now: Live Signal still has no signals and no wallet.
  const showTerminal = mode === 'signal' && dataMode === 'demo';

  const update = (patch: Partial<WorkspaceState>) => setState((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (!isMobile) setMenuDrawerOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!signalsInDrawer) setSignalsDrawerOpen(false);
  }, [signalsInDrawer]);

  useEffect(() => {
    if (!terminalInDrawer) setTerminalDrawerOpen(false);
  }, [terminalInDrawer]);

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

  // A signal or a terminal position opens its event in the middle columns and marks its Yes/No button.
  const pickHighlight = (cell: Highlight) => {
    if (workspace) update(focusHighlight(workspace, cell));
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
      setSportsQuery('');
      setMenuDrawerOpen(false);
    },
    onBuyUsdt: () => {
      setMenuDrawerOpen(false);
      setBuyOpen(true);
    },
    categories: sports ? sports.categories : (workspace?.categories ?? null),
    categoryHeading: sports
      ? t.nav.sportsCategories
      : mode === 'signal'
        ? t.nav.signalCategories
        : t.nav.categories,
    onPickCategory: (id: string) => {
      if (sports) {
        sports.pickCategory(id);
        setSportsQuery('');
      } else pickCategory(id);
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
        {sports ? (
          <TopBar
            trail={[t.nav.sports, sports.label]}
            current={sports.selected?.title ?? null}
            search={{ value: sportsQuery, onChange: setSportsQuery }}
            searchLabel={t.topBar.searchGames}
            onOpenMenu={isMobile ? () => setMenuDrawerOpen(true) : undefined}
            actions={
              <SegmentedControl
                label={t.sports.oddsFormat}
                size="sm"
                value={oddsFormat}
                onChange={setOddsFormat}
                options={[
                  { value: 'decimal', label: t.sports.decimal },
                  { value: 'american', label: t.sports.american },
                ]}
              />
            }
          />
        ) : (
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
            onOpenTerminal={terminalInDrawer && showTerminal ? () => setTerminalDrawerOpen(true) : null}
          />
        )}
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
          <Route
            path="sports"
            element={
              sports && (
                <SportsPage
                  key={dataMode}
                  sports={sports}
                  format={oddsFormat}
                  listFooter={
                    dataMode === 'live' && (
                      <nav className={styles.pagination} aria-label={t.sports.gamePages}>
                        <button disabled={sports.page === 1} onClick={sports.previous}>
                          {t.common.previous}
                        </button>
                        <span>{t.app.page(sports.page)}</span>
                        <button disabled={!sports.hasNext} onClick={sports.next}>
                          {t.common.next}
                        </button>
                      </nav>
                    )
                  }
                />
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
                pickHighlight(signal);
              }}
              {...signalPanelProps}
            />
          </Drawer>
        ) : (
          <SignalPanel
            open={signalsOpen}
            onToggle={() => setSignalsOpen((open) => !open)}
            onSelect={pickHighlight}
            {...signalPanelProps}
          />
        ))}

      {showTerminal &&
        (terminalInDrawer ? (
          <Drawer
            open={terminalDrawerOpen}
            onClose={() => setTerminalDrawerOpen(false)}
            side="right"
            label={t.terminal.panel}
          >
            <TradingTerminal
              variant="drawer"
              open
              onToggle={() => setTerminalDrawerOpen(false)}
              account={DEMO_ACCOUNT}
              activeId={state.highlightId}
              onSelect={(position: Position) => {
                setTerminalDrawerOpen(false);
                pickHighlight(position);
              }}
            />
          </Drawer>
        ) : (
          <TradingTerminal
            open={terminalOpen}
            onToggle={() => setTerminalOpen((open) => !open)}
            account={DEMO_ACCOUNT}
            activeId={state.highlightId}
            onSelect={pickHighlight}
          />
        ))}

      {buyOpen && <BuyUsdtDialog onClose={() => setBuyOpen(false)} />}
    </div>
  );
}
