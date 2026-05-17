import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Scroll } from 'lucide-react';
import { loadDiscoveries } from './TamagotchiWidget';
import './TamagotchiJournalModal.css';

interface Props {
  open: boolean;
  userId: string | number;
  onClose: () => void;
}

const TamagotchiJournalModal: React.FC<Props> = ({ open, userId, onClose }) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const disc = loadDiscoveries(userId);
  const isEmpty = disc.facts.length === 0 && disc.jokes.length === 0;

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
            onClick={e => e.stopPropagation()}
          >
            <div className="tama-journal-header">
              <div className="tama-journal-icon">
                <Scroll size={16} />
              </div>
              <h2 className="tama-journal-title">{t('dashboard.tama_journal_title')}</h2>
              <button className="tama-journal-close" onClick={onClose} aria-label="Close">✕</button>
            </div>

            {isEmpty ? (
              <p className="tama-journal-empty">{t('dashboard.tama_journal_empty')}</p>
            ) : (
              <div className="tama-journal-body">
                {disc.facts.length > 0 && (
                  <section>
                    <h3 className="tama-journal-section">{t('dashboard.tama_journal_facts')}</h3>
                    <ul className="tama-journal-list">
                      {disc.facts.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </section>
                )}
                {disc.jokes.length > 0 && (
                  <section>
                    <h3 className="tama-journal-section tama-journal-section--jokes">{t('dashboard.tama_journal_jokes')}</h3>
                    <ul className="tama-journal-list tama-journal-list--jokes">
                      {disc.jokes.map((j, i) => <li key={i}>{j}</li>)}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TamagotchiJournalModal;
