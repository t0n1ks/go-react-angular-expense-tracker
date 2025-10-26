// frontend-react/src/context/AuthContext.tsx

import React, { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import axios from 'axios';
// Navigate удален, так как не используется в этом файле, что устраняет ошибки ts(6133) и eslint

// Базовый URL для бэкенда
const API_BASE_URL = 'http://localhost:8080/api';

// Интерфейс для данных пользователя
interface User {
  id: number;
  username: string;
}

// Интерфейс для Auth Context
interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  isLoading: boolean; // 👈 Состояние загрузки
  login: (token: string, username: string, userId: number) => void;
  logout: () => void;
  // ФИНАЛЬНЫЙ ОБХОД TS2305: Используем 'any' для совместимости
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  axiosInstance: any; 
}

// Создаем контекст с заглушками
// eslint-disable-next-line react-refresh/only-export-components
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Функция для использования контекста
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth должен использоваться внутри AuthProvider');
  }
  // Утверждаем тип для удобства
  return context as AuthContextType;
};

interface AuthProviderProps {
  children: ReactNode;
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true); // 👈 Изначально true

  // 1. Создаем экземпляр Axios с помощью useMemo
  const axiosInstance = useMemo(() => {
    // Создаем экземпляр Axios с базовым URL
    const instance = axios.create({
      baseURL: API_BASE_URL,
    });

    // 2. Добавляем интерцептор (перехватчик) для автоматического добавления токена
    instance.interceptors.request.use(
      (config) => {
        const currentToken = localStorage.getItem('token');
        if (currentToken) {
          // ИСПРАВЛЕНИЕ: Проверяем, существует ли config.headers
          if (!config.headers) {
            config.headers = {};
          }
          config.headers.Authorization = `Bearer ${currentToken}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Утверждаем тип как any для обхода ошибок Axios
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return instance as any;
  }, []); // Создается один раз при монтировании

  // 3. Эффект для инициализации состояния из localStorage
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    const storedUserId = localStorage.getItem('userId');

    if (storedToken && storedUser && storedUserId) {
      setIsAuthenticated(true);
      setToken(storedToken);
      setUser({ id: parseInt(storedUserId, 10), username: storedUser });
    }

    // Устанавливаем isLoading в false после завершения проверки
    setIsLoading(false); 
  }, []);

  // 4. Функции login и logout
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
