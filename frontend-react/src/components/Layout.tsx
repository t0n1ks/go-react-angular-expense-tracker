import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Settings, LayoutDashboard, Tag, ArrowLeftRight, BarChart2, HelpCircle } from 'lucide-react';
import Logo from './Logo';
import GuidedTour, { TOUR_KEY } from './GuidedTour';
import { TourProvider } from '../context/TourContext';
import './Layout.css';

const ThemeBtn: React.FC = () => {
  const { toggleTheme, isDark } = useTheme();
  const { t } = useTranslation();
  return (
    <button
      onClick={toggleTheme}
      className="theme-icon-btn"
      aria-label={isDark ? t('theme.toggle_light') : t('theme.toggle_dark')}
      title={isDark ? t('theme.toggle_light') : t('theme.toggle_dark')}
    >
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { logout, user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tourKey, setTourKey] = React.useState(0);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleStartTour = () => {
    localStorage.removeItem(TOUR_KEY);
    setTourKey(k => k + 1);
  };

  return (
    <div className="app-container">

      {/* ── Desktop sidebar ──────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <Logo />
          <ThemeBtn />
        </div>

        <nav className="nav-links">
          <NavLink to="/" className="nav-item" end data-tour-id="home">{t('nav.home')}</NavLink>
          <NavLink to="/categories" className="nav-item" data-tour-id="categories">{t('nav.categories')}</NavLink>
          <NavLink to="/transactions" className="nav-item" data-tour-id="transactions">{t('nav.transactions')}</NavLink>
          <NavLink to="/statistics" className="nav-item" data-tour-id="statistics">{t('nav.statistics')}</NavLink>
          <NavLink to="/settings" className="nav-item" data-tour-id="settings">
            <Settings size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
            {t('nav.settings')}
          </NavLink>
        </nav>

        <button className="tour-trigger-btn" onClick={handleStartTour} title="App Tour">
          <HelpCircle size={16} />
        </button>

        <div className="user-info">
          <span className="user-info-label">{t('nav.user_label')}</span>
          <span className="user-info-name">{user?.username}</span>
        </div>

        <button onClick={handleLogout} className="logout-button">
          {t('nav.logout')}
        </button>
      </aside>

      {/* ── Mobile / tablet top header ───────────────────────────────────── */}
      <header className="mobile-header">
        <Logo />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button className="tour-trigger-btn" onClick={handleStartTour} title="App Tour">
            <HelpCircle size={16} />
          </button>
          <ThemeBtn />
        </div>
      </header>

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <TourProvider startTour={handleStartTour}>
        <main className="main-content">
          {children}
        </main>
      </TourProvider>

      {/* ── Mobile bottom navigation ─────────────────────────────────────── */}
      <nav className="bottom-nav">
        <NavLink to="/" end data-tour-id="home-m" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <LayoutDashboard size={20} />
          <span>{t('nav.home')}</span>
        </NavLink>
        <NavLink to="/categories" data-tour-id="categories-m" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <Tag size={20} />
          <span>{t('nav.categories')}</span>
        </NavLink>
        <NavLink to="/transactions" data-tour-id="transactions-m" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <ArrowLeftRight size={20} />
          <span>{t('nav.transactions')}</span>
        </NavLink>
        <NavLink to="/statistics" data-tour-id="statistics-m" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <BarChart2 size={20} />
          <span>{t('nav.statistics')}</span>
        </NavLink>
        <NavLink to="/settings" data-tour-id="settings-m" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <Settings size={20} />
          <span>{t('nav.settings')}</span>
        </NavLink>
      </nav>

      <GuidedTour key={tourKey} />
    </div>
  );
};

export default Layout;
