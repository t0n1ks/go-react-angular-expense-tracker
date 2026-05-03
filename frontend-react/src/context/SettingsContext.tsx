import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useAuth } from './AuthContext';

export type Currency = 'USD' | 'EUR' | 'UAH';

export interface UserSettings {
  currency: Currency;
  aiAdviceEnabled: boolean;
  aiHumorEnabled: boolean;
  monthlySpendingGoal: number;
  expectedSalary: number;
  paydayMode: 'smart' | 'fixed';
  fixedPayday: number;
  manualNextPayday: string;
}

interface SettingsContextType extends UserSettings {
  settings: UserSettings;
  isLoading: boolean;
  saveSettings: (s: UserSettings) => Promise<void>;
  formatAmount: (amount: number) => string;
  currencySymbol: string;
}

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: '$',
  EUR: '€',
  UAH: '₴',
};

const SETTINGS_KEY = 'user_settings';

const DEFAULT_SETTINGS: UserSettings = {
  currency: 'USD',
  aiAdviceEnabled: true,
  aiHumorEnabled: false,
  monthlySpendingGoal: 0,
  expectedSalary: 0,
  paydayMode: 'smart',
  fixedPayday: 0,
  manualNextPayday: '',
};

const loadFromStorage = (): UserSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
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

  useEffect(() => {
    if (!isAuthenticated) {
      setSettings(DEFAULT_SETTINGS);
      return;
    }
    let cancelled = false;
    const fetchProfile = async () => {
      setIsLoading(true);
      try {
        const res = await axiosInstance.get('/profile');
        if (cancelled) return;
        const d = res.data;
        const fetched: UserSettings = {
          currency: (d.currency as Currency) || 'USD',
          aiAdviceEnabled: d.ai_advice_enabled ?? true,
          aiHumorEnabled: d.ai_humor_enabled ?? false,
          monthlySpendingGoal: d.monthly_spending_goal ?? 0,
          expectedSalary: d.expected_salary ?? 0,
          paydayMode: (d.payday_mode === 'fixed' ? 'fixed' : 'smart'),
          fixedPayday: d.fixed_payday ?? 0,
          manualNextPayday: d.manual_next_payday ?? '',
        };
        setSettings(fetched);
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(fetched));
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
    `${currencySymbol}${Math.abs(amount).toLocaleString()}`;

  const value: SettingsContextType = {
    ...settings,
    settings,
    isLoading,
    saveSettings,
    formatAmount,
    currencySymbol,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};
