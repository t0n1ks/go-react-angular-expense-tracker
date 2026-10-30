import { useCallback, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSettings, type CycleStats } from '../../context/SettingsContext';
import { txEventTime } from '../../utils/categoryWindow';

// The four financial-summary cards (variable budget, savings, income,
// expenses) and their modals, as ONE model: Home renders them on wide
// screens, Statistics renders them as tiles on phone/tablet — both from this
// hook and the same components, so figures and actions can never diverge.

export interface SummaryTransaction {
  id: number;
  amount: number;
  type: 'expense' | 'income' | 'savings_deposit' | 'savings_withdrawal' | 'budget_transfer';
  income_type?: string;
  date: string;
  created_at?: string;
  effective_at?: string;
  category?: { id: number; name: string };
}

export type SummaryModal = 'income' | 'expenses' | 'savings' | 'addIncome';

export type SummaryKind = 'allowance' | 'savings' | 'income' | 'expenses';
/** The cards' fixed order: variable budget, savings / income, expenses. */
export const SUMMARY_KINDS: SummaryKind[] = ['allowance', 'savings', 'income', 'expenses'];

interface Options {
  transactions: SummaryTransaction[];
  /** Re-reads the page's transactions after a change. */
  refetch: () => void;
  /** Extra work after money moved (e.g. refresh the AI analysis). */
  onMutated?: () => void;
}

export function useSummaryModel({ transactions, refetch, onMutated }: Options) {
  const { axiosInstance } = useAuth();
  const { currentCycle, cycleStats: serverCycleStats, cycleWindow, refreshCycle, expectedSalary } = useSettings();

  // Optimistically patched stats after a change, until the next refresh.
  const [localCycleStats, setLocalCycleStats] = useState<CycleStats | null>(null);
  const cycleStats = localCycleStats ?? serverCycleStats;
  const [open, setOpen] = useState<SummaryModal | null>(null);

  // ── Server-authoritative cycle aggregation ────────────────────────────────
  const hasCycle = !!(currentCycle && cycleStats);
  const fixedExpCatID = Number(currentCycle?.fixed_exp_category_id ?? 0);

  const savingsCatId = currentCycle?.saved_money_category_id ?? 0;
  // When a cycle exists (active OR stopped), scope the client-side fallback to
  // that cycle's own window — exactly as the server reports it, with each
  // transaction placed by its server effective_at. Otherwise stopping a cycle
  // would flip these figures to an ALL-TIME sum (inflating "Income" for
  // multi-cycle users). No cycle at all → all-time, as before.
  const inCycleWindow = (tx: SummaryTransaction): boolean => {
    if (!cycleWindow) return true;
    const ev = txEventTime(tx).getTime();
    if (ev < new Date(cycleWindow.start).getTime()) return false;
    if (cycleWindow.end && ev >= new Date(cycleWindow.end).getTime()) return false;
    return true;
  };
  const legacyIncome = transactions
    .filter(t => t.type === 'income' && !(savingsCatId > 0 && Number(t.category?.id) === savingsCatId) && inCycleWindow(t))
    .reduce((acc, t) => acc + Number(t.amount), 0);
  const legacyExpense = transactions
    .filter(t => t.type === 'expense' && inCycleWindow(t))
    .reduce((acc, t) => acc + Number(t.amount), 0);

  const cycleIncome        = hasCycle ? cycleStats!.cycle_income        : legacyIncome;
  const cycleExpenses      = hasCycle ? cycleStats!.cycle_expenses      : legacyExpense;
  const cycleFixedExpenses = hasCycle ? cycleStats!.cycle_fixed_expenses : 0;
  const cycleVariableExpenses = hasCycle ? cycleStats!.cycle_variable_expenses : Math.max(0, legacyExpense);

  // Variable Allowance = income − savings_allocation − fixed_expenses (server-computed).
  // For non-cycle users it falls back to the legacy balance.
  const variableAllowance = hasCycle ? (cycleStats!.variable_allowance ?? cycleStats!.net_discretionary_budget) : (legacyIncome - legacyExpense);
  const dynamicSavings    = hasCycle ? (cycleStats!.dynamic_savings ?? 0) : 0;
  const savedMoneyBalance = hasCycle ? (cycleStats!.saved_money_balance ?? 0) : 0;
  // Carry-over from the previous cycle — already part of variableAllowance;
  // shown so a higher-than-base budget is never a mystery.
  const carryOver        = hasCycle ? (cycleStats!.carry_over ?? 0) : 0;
  const carryMoved       = hasCycle ? (cycleStats!.carry_over_to_savings ?? 0) : 0;
  const carryMovable     = hasCycle ? (cycleStats!.carry_over_movable ?? 0) : 0;

  // ── Income progress (no-cycle only) ──────────────────────────────────────
  const salaryRef     = currentCycle ? currentCycle.total_income : expectedSalary;
  const incomePercent = salaryRef > 0 ? Math.min((cycleIncome / salaryRef) * 100, 100) : 0;
  const incomeOver    = salaryRef > 0 && cycleIncome >= salaryRef;

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleCycleStarted = useCallback(() => {
    setLocalCycleStats(null);
    refetch();
    refreshCycle();
  }, [refetch, refreshCycle]);

  const handleCycleDeleted = useCallback(() => {
    setOpen(null);
    setLocalCycleStats(null);
    refetch();
    refreshCycle();
  }, [refetch, refreshCycle]);

  const handleIncomeAdded = useCallback((updatedStats: CycleStats) => {
    setLocalCycleStats(updatedStats);
    // Full refresh in background to sync all data
    refetch();
    refreshCycle().then(() => setLocalCycleStats(null));
    onMutated?.(); // real-time AI prediction refresh
  }, [refetch, refreshCycle, onMutated]);

  const handleSavingsSaved = useCallback((stats: CycleStats) => {
    setLocalCycleStats(stats);
    refreshCycle().then(() => setLocalCycleStats(null));
    onMutated?.(); // real-time AI prediction refresh
  }, [refreshCycle, onMutated]);

  // Move the carried-over budget into savings (server applies the whole-unit
  // rule: whole euros move, cents stay spendable).
  const [movingCarry, setMovingCarry] = useState(false);
  const moveCarryOverToSavings = useCallback(async () => {
    setMovingCarry(true);
    try {
      const res = await axiosInstance.post('/salary-cycle/carry-over/savings');
      handleIncomeAdded(res.data.cycle_stats);
    } catch {
      refreshCycle(); // e.g. nothing left to move — resync the figures
    } finally {
      setMovingCarry(false);
    }
  }, [axiosInstance, handleIncomeAdded, refreshCycle]);

  return {
    transactions,
    currentCycle,
    cycleStats,
    hasCycle,
    fixedExpCatID,
    cycleIncome,
    cycleExpenses,
    cycleFixedExpenses,
    cycleVariableExpenses,
    variableAllowance,
    dynamicSavings,
    savedMoneyBalance,
    carryOver,
    carryMoved,
    carryMovable,
    salaryRef,
    incomePercent,
    incomeOver,
    open,
    setOpen,
    refreshCycle,
    movingCarry,
    moveCarryOverToSavings,
    handleCycleStarted,
    handleCycleDeleted,
    handleIncomeAdded,
    handleSavingsSaved,
  };
}

export type SummaryModel = ReturnType<typeof useSummaryModel>;
