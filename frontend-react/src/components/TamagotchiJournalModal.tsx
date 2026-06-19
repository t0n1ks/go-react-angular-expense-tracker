import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Scroll, Star } from 'lucide-react';
import {
  loadDiscoveries,
  loadFavorites,
  toggleFavorite,
  type SavedItem,
} from '../utils/tamaStorage';
import { resolveItemText } from '../data/tamaContent';
import './TamagotchiJournalModal.css';

interface Props {
  open: boolean;
  userId: string | number;
  onClose: () => void;
}

type Tab = 'discoveries' | 'favorites';

const TamagotchiJournalModal: React.FC<Props> = ({ open, userId, onClose }) => {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('discoveries');
  const [facts, setFacts] = useState<SavedItem[]>([]);
  const [jokes, setJokes] = useState<SavedItem[]>([]);
  const [favorites, setFavorites] = useState<SavedItem[]>([]);

  // Snapshot storage when the modal opens; default back to the daily tab.
  useEffect(() => {
    if (!open) return;
    const disc = loadDiscoveries(userId);
    setFacts(disc.facts);
    setJokes(disc.jokes);
    setFavorites(loadFavorites(userId));
    setTab('discoveries');
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const favIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);
  const lang = i18n.language;

  const handleToggleFav = useCallback(
    (item: SavedItem) => setFavorites(toggleFavorite(userId, item)),
    [userId],
  );

  const renderItem = (item: SavedItem) => {
    const text = resolveItemText(item, lang);
    if (!text) return null; // unresolved/empty — skip rather than render blank
    const fav = favIds.has(item.id);
    return (
      <li key={item.id} className="tama-journal-item">
        <span className="tama-journal-item-text">{text}</span>
        <button
          type="button"
          className={`tama-fav-btn${fav ? ' tama-fav-btn--active' : ''}`}
          onClick={() => handleToggleFav(item)}
          aria-pressed={fav}
          aria-label={fav ? t('dashboard.tama_fav_remove') : t('dashboard.tama_fav_add')}
          title={fav ? t('dashboard.tama_fav_remove') : t('dashboard.tama_fav_add')}
        >
          <Star size={15} fill={fav ? 'currentColor' : 'none'} />
        </button>
      </li>
    );
  };

  const section = (titleKey: string, items: SavedItem[], jokesStyle = false) =>
    items.length > 0 ? (
      <section>
        <h3 className={`tama-journal-section${jokesStyle ? ' tama-journal-section--jokes' : ''}`}>
          {t(titleKey)}
        </h3>
        <ul className={`tama-journal-list${jokesStyle ? ' tama-journal-list--jokes' : ''}`}>
          {items.map(renderItem)}
        </ul>
      </section>
    ) : null;

  const discEmpty = facts.length === 0 && jokes.length === 0;
  const favFacts = favorites.filter((f) => f.kind === 'fact');
  const favJokes = favorites.filter((f) => f.kind === 'joke');
  const favEmpty = favorites.length === 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="tama-journal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            className="tama-journal-card"
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.97 }}
            transition={{ type: 'spring', damping: 28, stiffness: 380 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tama-journal-header">
              <div className="tama-journal-icon">
                <Scroll size={16} />
              </div>
              <h2 className="tama-journal-title">{t('dashboard.tama_journal_title')}</h2>
              <button className="tama-journal-close" onClick={onClose} aria-label="Close">✕</button>
            </div>

            <div className="tama-journal-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'discoveries'}
                className={`tama-journal-tab${tab === 'discoveries' ? ' tama-journal-tab--active' : ''}`}
                onClick={() => setTab('discoveries')}
              >
                {t('dashboard.tama_tab_discoveries')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'favorites'}
                className={`tama-journal-tab${tab === 'favorites' ? ' tama-journal-tab--active' : ''}`}
                onClick={() => setTab('favorites')}
              >
                <Star size={13} className="tama-journal-tab-star" />
                {t('dashboard.tama_tab_favorites')}
                {favorites.length > 0 && <span className="tama-journal-tab-count">{favorites.length}</span>}
              </button>
            </div>

            {tab === 'discoveries' ? (
              discEmpty ? (
                <p className="tama-journal-empty">{t('dashboard.tama_journal_empty')}</p>
              ) : (
                <div className="tama-journal-body">
                  {section('dashboard.tama_journal_facts', facts)}
                  {section('dashboard.tama_journal_jokes', jokes, true)}
                </div>
              )
            ) : favEmpty ? (
              <p className="tama-journal-empty">{t('dashboard.tama_fav_empty')}</p>
            ) : (
              <div className="tama-journal-body">
                {section('dashboard.tama_journal_facts', favFacts)}
                {section('dashboard.tama_journal_jokes', favJokes, true)}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TamagotchiJournalModal;
