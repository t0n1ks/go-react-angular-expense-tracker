import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './DeleteSnackbar.css';

interface Props {
  message: string | null;
  onUndo: () => void;
  onClose: () => void;
}

const DeleteSnackbar: React.FC<Props> = ({ message, onUndo, onClose }) => {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="delete-snackbar"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        >
          <span className="snackbar-msg">{message}</span>
          <button className="snackbar-undo" onClick={onUndo}>{t('common.undo')}</button>
          <button className="snackbar-close" onClick={onClose} aria-label="Dismiss">
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default DeleteSnackbar;
