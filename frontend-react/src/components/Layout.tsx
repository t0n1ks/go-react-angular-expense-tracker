// src/components/Layout.tsx
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Layout.css';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-logo">Expense Tracker</div>
        
        <nav className="nav-links">
          <NavLink to="/" className="nav-item">Главная</NavLink>
          <NavLink to="/categories" className="nav-item">Категории</NavLink>
          <NavLink to="/transactions" className="nav-item">Транзакции</NavLink>
          <NavLink to="/statistics" className="nav-item">Статистика</NavLink>
        </nav>

        <div className="user-info" style={{marginBottom: '20px', color: '#94a3b8', fontSize: '14px'}}>
            Пользователь: <span style={{color: 'white'}}>{user?.username}</span>
        </div>

        <button onClick={handleLogout} className="logout-button">
          Выйти
        </button>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
};

export default Layout;