import React, { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL as string || 'http://localhost:8080/api';

interface User {
  id: number;
  username: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, username: string, userId: number) => void;
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
        return config;
      },
      (error) => Promise.reject(error)
    );

    return instance;
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    const storedUserId = localStorage.getItem('userId');

    if (storedToken && storedUser && storedUserId) {
      setToken(storedToken);
      setUser({ id: parseInt(storedUserId, 10), username: storedUser });
      setIsAuthenticated(true);
    }
    setIsLoading(false);
  }, []);

  const login = (newToken: string, username: string, userId: number) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', username);
    localStorage.setItem('userId', userId.toString());
    setToken(newToken);
    setUser({ id: userId, username });
    setIsAuthenticated(true);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('userId');
    localStorage.removeItem('ufo_intro_seen');
    localStorage.removeItem('user_settings');
    localStorage.removeItem('ai_shown_items');
    sessionStorage.removeItem('ai_advice_session');
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, token, isLoading, login, logout, axiosInstance }}>
      {children}
    </AuthContext.Provider>
  );
};