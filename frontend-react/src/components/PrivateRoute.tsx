// frontend-react/src/components/PrivateRoute.tsx
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext'; 

interface PrivateRouteProps {
  children: React.ReactNode;
}

const PrivateRoute: React.FC<PrivateRouteProps> = ({ children }) => {
  // 👈 НОВОЕ: Получаем isLoading
  const { isAuthenticated, isLoading } = useAuth(); 

  // 1. Если идет загрузка (проверка localStorage), показываем заглушку
  if (isLoading) {
    // Здесь можно отобразить красивый спиннер или просто пустой экран
    return <div className="min-h-screen flex items-center justify-center text-xl">Загрузка...</div>;
  }

  // 2. Если загрузка завершена и пользователь не аутентифицирован, перенаправляем
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // 3. Если загрузка завершена и пользователь аутентифицирован, показываем контент
  return <>{children}</>; 
};

export default PrivateRoute;