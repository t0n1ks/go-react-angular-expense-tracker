import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Settings, LayoutDashboard, Tag, ArrowLeftRight, BarChart2 } from 'lucide-react';
import './Layout.css';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { logout, user } = useAuth();
  const { toggleTheme, isDark } = useTheme();
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
          <NavLink to="/settings" className="nav-item">
            <Settings size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
            {t('nav.settings')}
          </NavLink>
        </nav>

        <button
          onClick={toggleTheme}
          className="theme-toggle-btn"
          title={isDark ? t('theme.toggle_light') : t('theme.toggle_dark')}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
          {isDark ? t('theme.toggle_light') : t('theme.toggle_dark')}
        </button>

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

      <span className="mobile-logo" aria-hidden="true">F-SET</span>

      <nav className="bottom-nav">
        <NavLink to="/" end className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <LayoutDashboard size={20} />
          <span>{t('nav.home')}</span>
        </NavLink>
        <NavLink to="/categories" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <Tag size={20} />
          <span>{t('nav.categories')}</span>
        </NavLink>
        <NavLink to="/transactions" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <ArrowLeftRight size={20} />
          <span>{t('nav.transactions')}</span>
        </NavLink>
        <NavLink to="/statistics" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <BarChart2 size={20} />
          <span>{t('nav.statistics')}</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <Settings size={20} />
          <span>{t('nav.settings')}</span>
        </NavLink>
      </nav>
    </div>
  );
};

export default Layout;
