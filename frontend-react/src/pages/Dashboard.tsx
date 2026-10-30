import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useTranslation } from 'react-i18next';
import { Target } from 'lucide-react';
import TamagotchiWidget from '../components/TamagotchiWidget';
import WeeklyBudgetCard from '../components/WeeklyBudgetCard';
import SalaryCycleCard from '../components/SalaryCycleCard';
import { SummaryCard, SummaryModals } from '../components/summary/SummaryCards';
import { SUMMARY_KINDS, useSummaryModel, type SummaryTransaction } from '../components/summary/useSummaryModel';
import { useAIAssistant } from '../hooks/useAIAssistant';
import { useCompanion } from '../hooks/useCompanion';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { healthChangeText, messageText, reasonText } from '../utils/companion';
import { WIDE_QUERY } from '../utils/breakpoints';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  // Laptop / desktop: the four summary cards are here, and the companion's
  // cosmos screen takes the stats grid's free 6th cell (beside Budget health
  // on 2 columns, under Income on 3). Phone / tablet: the four cards live in
  // Statistics as tiles; Budget health stays here.
  const wideDesktop = useMediaQuery(WIDE_QUERY);
  const { axiosInstance, user } = useAuth();
  const {
    formatAmount,
    aiAdviceEnabled,
    monthlySpendingGoal,
    liteMode,
    budgetWindow,
  } = useSettings();
  const { t, i18n } = useTranslation();
  const [transactions, setTransactions] = useState<SummaryTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiServiceMode, setAIServiceMode] = useState<'online' | 'autonomous' | 'initializing'>('initializing');

  const fetchData = useCallback(async () => {
    try {
      const response = await axiosInstance.get('/transactions');
      const data = response.data.transactions || response.data;
      setTransactions(Array.isArray(data) ? data : []);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [axiosInstance]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const analyzeLang = i18n.resolvedLanguage ?? 'en';

  // Re-run AI analysis after a mutation so the AI service's per-user learner
  // and visit history stay current. The UFO's mood no longer comes from here:
  // the companion engine (Go) drives health and mood.
  const runAnalyze = useCallback(() => {
    axiosInstance.post(`/ai/analyze?language=${analyzeLang}`).catch(() => {});
  }, [axiosInstance, analyzeLang]);

  useEffect(() => { runAnalyze(); }, [runAnalyze]);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;
    const checkStatus = () => {
      axiosInstance.get('/ai/status')
        .then((res: { data: { mode: string } }) => {
          const mode = res.data.mode;
          if (mode === 'online') setAIServiceMode('online');
          else if (mode === 'autonomous') { setAIServiceMode('autonomous'); timerId = setTimeout(checkStatus, 5_000); }
          else timerId = setTimeout(checkStatus, 10_000);
        })
        .catch(() => { timerId = setTimeout(checkStatus, 15_000); });
    };
    checkStatus();
    return () => clearTimeout(timerId);
  }, [axiosInstance]);

  const prevModeRef = useRef<'online' | 'autonomous' | 'initializing'>('initializing');
  useEffect(() => {
    if (prevModeRef.current !== 'online' && aiServiceMode === 'online') {
      runAnalyze();
    }
    prevModeRef.current = aiServiceMode;
  }, [aiServiceMode, runAnalyze]);

  // The four summary cards' figures and actions (shared with Statistics).
  const summary = useSummaryModel({ transactions, refetch: fetchData, onMutated: runAnalyze });
  const { cycleStats, variableAllowance, cycleVariableExpenses } = summary;

  // ── Budget Health: (Variable Allowance - Variable Spent) / Variable Allowance ──
  const budgetMax       = variableAllowance;
  const budgetRemaining = Math.max(0, variableAllowance - cycleVariableExpenses);
  const budgetPercent   = budgetMax > 0 ? (cycleVariableExpenses / budgetMax) * 100 : 0;
  const budgetBarColor  = budgetPercent >= 100 ? '#ef4444' : budgetPercent >= 80 ? '#f59e0b' : '#38bdf8';

  const { message: ambientMessage, dismiss: dismissAmbient, animationHint } = useAIAssistant({
    aiAdviceEnabled,
    axiosInstance,
    language: analyzeLang,
    aiServiceMode,
  });

  // ── Companion: health, mood and contextual messages (server-decided) ─────
  // Refreshed when the figures change so "just happened" reactions are prompt.
  const companionRefreshKey = `${cycleStats?.cycle_variable_expenses}|${cycleStats?.cycle_income}|${cycleStats?.saved_money_balance}|${budgetWindow?.spent_this_window}|${transactions.length}`;
  const companion = useCompanion({ axiosInstance, language: analyzeLang, refreshKey: companionRefreshKey });
  const companionText = companion.message && aiAdviceEnabled
    ? messageText(companion.message, t, formatAmount, analyzeLang)
    : null;
  const companionReason = companion.state ? reasonText(companion.state.reason, t, formatAmount, analyzeLang) : '';

  // Health dropped since this viewer last saw it → say why, once.
  const [healthNote, setHealthNote] = useState<string | null>(null);
  const companionHealth = companion.state?.health;
  useEffect(() => {
    if (companionHealth === undefined || !user?.id) return;
    const key = `tama_health_seen_${user.id}`;
    let previous: number | null = null;
    try {
      const raw = localStorage.getItem(key);
      previous = raw === null ? null : Number(raw);
    } catch { /* storage unavailable — no note */ }
    if (previous !== null && Number.isFinite(previous) && companionHealth < previous - 0.5) {
      setHealthNote(healthChangeText(companionHealth, previous, companionReason, t));
    }
    try { localStorage.setItem(key, String(companionHealth)); } catch { /* ignore */ }
  // Only a new health value matters; the reason text follows it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionHealth, user?.id]);

  // A companion message (with 👍 / 👎 / neutral ✕) takes the bubble first.
  const shownMessage = companionText ?? ambientMessage;

  // Lite dashboard is content-short. Tag <body> so the shared layout can fit the
  // actual content instead of reserving full-viewport height (which produced a
  // scrollable empty band below the UFO). Removed when Lite turns off / on leave.
  useEffect(() => {
    if (!liteMode) return;
    document.body.classList.add('dashboard-lite');
    return () => document.body.classList.remove('dashboard-lite');
  }, [liteMode]);

  // Phone / tablet: with the four summary cards in Statistics, Home is short
  // too — let the layout fit it (Dashboard.css, ≤1024px only) so the page
  // ends just below the cosmos screen instead of scrolling into empty space.
  useEffect(() => {
    if (wideDesktop) return;
    document.body.classList.add('dashboard-compact');
    return () => document.body.classList.remove('dashboard-compact');
  }, [wideDesktop]);

  if (loading) return <div className="dashboard-wrapper">{t('dashboard.loading')}</div>;

  // Lite hides the stats grid, so the companion stays a full-width block there.
  const cosmosInGrid = wideDesktop && !liteMode;
  const companionWidget = (
    <TamagotchiWidget
      message={shownMessage}
      onDismiss={dismissAmbient}
      onMessageAction={companionText ? companion.act : undefined}
      mood={companion.state?.mood}
      animationHint={animationHint}
      aiServiceMode={aiServiceMode}
      health={companion.state?.health}
      reasonText={companionReason}
      healthNote={healthNote}
      questOpen={companion.state?.quest.open ?? false}
      onCatch={companion.catchEntity}
      layout={cosmosInGrid ? 'cell' : 'stack'}
    />
  );

  return (
    <div className={`dashboard-wrapper${liteMode ? ' dashboard-wrapper--lite' : ''}${wideDesktop ? '' : ' dashboard-wrapper--compact'}`}>
      <h1 className="dashboard-title">{t('dashboard.title')}</h1>

      {/* Lite mode hides all salary-cycle / analytics cards; only the budget
          card (and the UFO's jokes/facts) remain. Nothing is removed — turning
          Lite off restores everything. */}
      {!liteMode && <SalaryCycleCard onCycleStarted={summary.handleCycleStarted} />}

      {/* ── Stats grid ───────────────────────────────────────────────────── */}
      {!liteMode && (
      <div className="stats-grid">

        {/* Cards 1–4: variable budget, savings, income, expenses — on wide
            screens only (phone / tablet: Statistics tiles). */}
        {wideDesktop && SUMMARY_KINDS.map(kind => <SummaryCard key={kind} kind={kind} model={summary} />)}

        {/* Card 5: Budget Health */}
        <div className="stat-card">
          <div className="stat-icon budget-icon"><Target size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.budget_health')}</p>
            <p className="value" style={{ color: budgetBarColor }}>
              {formatAmount(budgetRemaining)} / {formatAmount(budgetMax)}
            </p>
            <div className="budget-health-bar-track">
              <div className="budget-health-bar-fill" style={{ width: `${Math.min(budgetPercent, 100)}%`, background: budgetBarColor }} />
            </div>
            <p className="stat-sublabel">{t('dashboard.since_payday')}</p>
          </div>
        </div>

        {/* Cell 6 (desktop): the companion — beside Budget health, or under Income. */}
        {cosmosInGrid && companionWidget}
      </div>
      )}

      {/* Savings Forecast relocated to the Statistics/Analytics section to
          de-duplicate the dashboard (see Statistics.tsx → savings-forecast-card). */}

      <WeeklyBudgetCard
        transactions={transactions}
        monthlyBudget={monthlySpendingGoal}
        formatAmount={formatAmount}
      />

      <SummaryModals model={summary} />

      {!cosmosInGrid && companionWidget}
    </div>
  );
};

export default Dashboard;
