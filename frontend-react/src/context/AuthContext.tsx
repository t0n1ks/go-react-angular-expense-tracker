import React, { createContext, useCallback, useContext, useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL as string || 'http://localhost:8080/api';

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

interface User {
  id: number;
  username: string;
  /** Shown instead of the username when set ("" = show the username). */
  displayName: string;
  /** One of utils/avatars.ts ids; "" = the first-letter circle. */
  avatar: string;
}

export interface Identity {
  displayName: string;
  avatar: string;
}

// The identity is cached so the header paints at once; the server value
// (GET /profile, on every load) wins, which keeps devices in sync.
const DISPLAY_NAME_KEY = 'user_display_name';
const AVATAR_KEY = 'user_avatar';

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, username: string, userId: number, identity?: Partial<Identity>) => void;
  /** Apply a saved / fetched display name and avatar to the signed-in user. */
  updateIdentity: (identity: Partial<Identity>) => void;
  logout: () => void;
  // Используем any, так как axiosInstance часто ведет себя капризно в типах
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  axiosInstance: any;
}

// eslint-disable-next-line react-refresh/only-export-components
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true);

  // Stable ref so the interceptor always calls the latest logout without being recreated
  const logoutRef = useRef<() => void>(() => {});

  const axiosInstance = useMemo(() => {
    const instance = axios.create({
      baseURL: API_BASE_URL,
    });

    instance.interceptors.request.use(
      (config) => {
        const currentToken = localStorage.getItem('token');
        if (currentToken && config.headers) {
          config.headers.set('Authorization', `Bearer ${currentToken}`);
        }
        // The device's IANA timezone, read per request so travelling takes
        // effect immediately: the server evaluates cycle boundaries (payday,
        // "today") in the user's local time.
        if (config.headers) {
          try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (tz) config.headers.set('X-User-Timezone', tz);
          } catch { /* no Intl timezone → server falls back to the remembered zone / UTC */ }
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Auto-logout on 401 — only when a token exists (avoids triggering on bad login attempts)
    instance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401 && localStorage.getItem('token')) {
          logoutRef.current();
        }
        return Promise.reject(error);
      }
    );

    return instance;
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    const storedUserId = localStorage.getItem('userId');

    if (storedToken && storedUser && storedUserId) {
      if (isTokenExpired(storedToken)) {
        // Token is in localStorage but already expired — clean up silently
        // so the user lands on /login instead of a broken dashboard.
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('userId');
      } else {
        setToken(storedToken);
        setUser({
          id: parseInt(storedUserId, 10),
          username: storedUser,
          displayName: localStorage.getItem(DISPLAY_NAME_KEY) ?? '',
          avatar: localStorage.getItem(AVATAR_KEY) ?? '',
        });
        setIsAuthenticated(true);
      }
    }
    setIsLoading(false);
  }, []);

  const login = (newToken: string, username: string, userId: number, identity?: Partial<Identity>) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', username);
    localStorage.setItem('userId', userId.toString());
    const displayName = identity?.displayName ?? '';
    const avatar = identity?.avatar ?? '';
    localStorage.setItem(DISPLAY_NAME_KEY, displayName);
    localStorage.setItem(AVATAR_KEY, avatar);
    setToken(newToken);
    setUser({ id: userId, username, displayName, avatar });
    setIsAuthenticated(true);
  };

  const updateIdentity = useCallback((identity: Partial<Identity>) => {
    if (identity.displayName !== undefined) localStorage.setItem(DISPLAY_NAME_KEY, identity.displayName);
    if (identity.avatar !== undefined) localStorage.setItem(AVATAR_KEY, identity.avatar);
    setUser(u => (u ? {
      ...u,
      displayName: identity.displayName ?? u.displayName,
      avatar: identity.avatar ?? u.avatar,
    } : u));
  }, []);

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('userId');
    localStorage.removeItem(DISPLAY_NAME_KEY);
    localStorage.removeItem(AVATAR_KEY);
    localStorage.removeItem('ufo_intro_seen');
    localStorage.removeItem('user_settings');
    localStorage.removeItem('ai_shown_items');
    sessionStorage.removeItem('ai_advice_session');
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
  };

  // Keep the interceptor ref pointing at the latest logout without recreating axiosInstance
  logoutRef.current = logout;

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, token, isLoading, login, logout, updateIdentity, axiosInstance }}>
      {children}
    </AuthContext.Provider>
  );
};