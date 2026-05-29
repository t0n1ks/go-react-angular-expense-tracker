import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from './AuthContext';

export type Currency = 'USD' | 'EUR' | 'UAH';

export interface FixedExpenseItem {
  id: number;
  salary_cycle_id: number;
  amount: number;
  description: string;
  category_type: 'need' | 'want';
}

export interface SalaryCycle {
  id: number;
  user_id: number;
  base_salary: number;
  bonuses: number;
  total_income: number;
  needs_pct: number;
  wants_pct: number;
  savings_pct: number;
  needs_limit: number;
  wants_limit: number;
  savings_limit: number;
  fixed_needs_total: number;
  fixed_wants_total: number;
  var_needs_budget: number;
  var_wants_budget: number;
  fixed_exp_category_id: number;
  saved_money_category_id: number;
  cycle_start_at: string; // ISO timestamp
  next_payday_at: string | null;
  fixed_expenses: FixedExpenseItem[];
}

export interface UserSettings {
  currency: Currency;
  aiAdviceEnabled: boolean;
  aiHumorEnabled: boolean;
  monthlySpendingGoal: number;
  expectedSalary: number;
  paydayMode: 'smart' | 'fixed';
  fixedPayday: number;
  manualNextPayday: string;
  heartsCount: number;
  reputationScore: number;
}

// Server-authoritative cycle aggregation. The Go backend owns all the
// timestamp math; React renders these numbers directly (no client-side date
// parsing for cycle totals).
export interface CycleStats {
  cycle_income: number;
  cycle_expenses: number;
  cycle_fixed_expenses: number;
  cycle_variable_expenses: number;
  // Dynamic variable allowance = income − (income×savings_pct%) − fixed_expenses
  variable_allowance: number;
  // Portion of income earmarked for the savings pool this cycle
  dynamic_savings: number;
  // Cumulative all-time net balance of the savings pool
  saved_money_balance: number;
  previous_savings: number;
  net_discretionary_budget: number; // equals variable_allowance (backward-compat)
  days_total: number;
  days_elapsed: number;
  days_remaining: number;
  base_weekly_allowance: number;
  current_week_index: number;
  current_week_allowance: number;
  current_week_spent: number;
  rollover: number;
}

interface SettingsContextType extends UserSettings {
  settings: UserSettings;
  isLoading: boolean;
  saveSettings: (s: UserSettings) => Promise<void>;
  formatAmount: (amount: number) => string;
  currencySymbol: string;
  currentCycle: SalaryCycle | null;
  cycleStats: CycleStats | null;
  hasActiveCycle: boolean;
  refreshCycle: () => Promise<void>;
}

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: '$',
  EUR: '€',
  UAH: '₴',
};

const SETTINGS_KEY = 'user_settings';
const CYCLE_KEY = 'current_salary_cycle';

const DEFAULT_SETTINGS: UserSettings = {
  currency: 'USD',
  aiAdviceEnabled: true,
  aiHumorEnabled: true,
  monthlySpendingGoal: 0,
  expectedSalary: 0,
  paydayMode: 'smart',
  fixedPayday: 0,
  manualNextPayday: '',
  heartsCount: 3,
  reputationScore: 0,
};

const loadFromStorage = (): UserSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
};

const loadCycleFromStorage = (): SalaryCycle | null => {
  try {
    const raw = localStorage.getItem(CYCLE_KEY);
    if (raw) return JSON.parse(raw) as SalaryCycle;
  } catch { /* ignore */ }
  return null;
};

// eslint-disable-next-line react-refresh/only-export-components
const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
};

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { axiosInstance, isAuthenticated } = useAuth();
  const [settings, setSettings] = useState<UserSettings>(loadFromStorage);
  const [isLoading, setIsLoading] = useState(false);
  const [currentCycle, setCurrentCycle] = useState<SalaryCycle | null>(loadCycleFromStorage);
  const [cycleStats, setCycleStats] = useState<CycleStats | null>(null);
  const [hasActiveCycle, setHasActiveCycle] = useState<boolean>(false);

  const refreshCycle = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/salary-cycle/current');
      const cycle: SalaryCycle | null = res.data.cycle ?? null;
      setCurrentCycle(cycle);
      setCycleStats(res.data.cycle_stats ?? null);
      setHasActiveCycle(res.data.has_active_cycle ?? false);
      if (cycle) {
        localStorage.setItem(CYCLE_KEY, JSON.stringify(cycle));
      } else {
        localStorage.removeItem(CYCLE_KEY);
      }
    } catch { /* keep cached */ }
  }, [axiosInstance]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSettings(DEFAULT_SETTINGS);
      setCurrentCycle(null);
      setCycleStats(null);
      localStorage.removeItem(CYCLE_KEY);
      return;
    }
    let cancelled = false;
    const fetchProfile = async () => {
      setIsLoading(true);
      try {
        const [profileRes, cycleRes] = await Promise.all([
          axiosInstance.get('/profile'),
          axiosInstance.get('/salary-cycle/current'),
        ]);
        if (cancelled) return;
        const d = profileRes.data;
        const fetched: UserSettings = {
          currency: (d.currency as Currency) || 'USD',
          aiAdviceEnabled: d.ai_advice_enabled ?? true,
          aiHumorEnabled: d.ai_humor_enabled ?? true,
          monthlySpendingGoal: d.monthly_spending_goal ?? 0,
          expectedSalary: d.expected_salary ?? 0,
          paydayMode: (d.payday_mode === 'fixed' ? 'fixed' : 'smart'),
          fixedPayday: d.fixed_payday ?? 0,
          manualNextPayday: d.manual_next_payday ?? '',
          heartsCount: d.hearts_count ?? 3,
          reputationScore: d.reputation_score ?? 0,
        };
        setSettings(fetched);
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(fetched));

        const cycle: SalaryCycle | null = cycleRes.data.cycle ?? null;
        setCurrentCycle(cycle);
        setCycleStats(cycleRes.data.cycle_stats ?? null);
        setHasActiveCycle(cycleRes.data.has_active_cycle ?? false);
        if (cycle) {
          localStorage.setItem(CYCLE_KEY, JSON.stringify(cycle));
        } else {
          localStorage.removeItem(CYCLE_KEY);
        }
      } catch { /* keep cached/default */ } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchProfile();
    return () => { cancelled = true; };
  }, [isAuthenticated, axiosInstance]);

  const saveSettings = async (next: UserSettings) => {
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    await axiosInstance.put('/profile', {
      currency: next.currency,
      ai_advice_enabled: next.aiAdviceEnabled,
      ai_humor_enabled: next.aiHumorEnabled,
      monthly_spending_goal: next.monthlySpendingGoal,
      expected_salary: next.expectedSalary,
      payday_mode: next.paydayMode,
      fixed_payday: next.fixedPayday,
      manual_next_payday: next.manualNextPayday,
    });
  };

  const currencySymbol = CURRENCY_SYMBOLS[settings.currency] ?? '$';

  const formatAmount = (amount: number): string =>
    `${currencySymbol}${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const value: SettingsContextType = {
    ...settings,
    settings,
    isLoading,
    saveSettings,
    formatAmount,
    currencySymbol,
    currentCycle,
    cycleStats,
    hasActiveCycle,
    refreshCycle,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};
