import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';
import './Layout.css';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { logout, user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-logo">{t('nav.app_title')}</div>

        <nav className="nav-links">
          <NavLink to="/" className="nav-item" end>{t('nav.home')}</NavLink>
          <NavLink to="/categories" className="nav-item">{t('nav.categories')}</NavLink>
          <NavLink to="/transactions" className="nav-item">{t('nav.transactions')}</NavLink>
          <NavLink to="/statistics" className="nav-item">{t('nav.statistics')}</NavLink>
        </nav>

        <LanguageSwitcher />

        <div className="user-info">
          <span className="user-info-label">{t('nav.user_label')}</span>
          <span className="user-info-name">{user?.username}</span>
        </div>

        <button onClick={handleLogout} className="logout-button">
          {t('nav.logout')}
        </button>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
};

export default Layout;
