import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import './AIMessageBox.css';

interface AIMessageBoxProps {
  message: string;
  visible: boolean;
  onClose: () => void;
}

const MiniUfo: React.FC = () => (
  <svg width="32" height="22" viewBox="0 0 64 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="32" cy="20" rx="13" ry="10" fill="#475569" stroke="#64748b" strokeWidth="1.5" />
    <ellipse cx="32" cy="18" rx="7" ry="6" fill="#38bdf8" opacity="0.9" />
    <ellipse cx="32" cy="28" rx="29" ry="8.5" fill="#334155" stroke="#475569" strokeWidth="1.5" />
    <circle cx="16" cy="29" r="2.5" fill="#fbbf24" />
    <circle cx="32" cy="32" r="2.5" fill="#fbbf24" />
    <circle cx="48" cy="29" r="2.5" fill="#fbbf24" />
  </svg>
);

const AIMessageBox: React.FC<AIMessageBoxProps> = ({ message, visible, onClose }) => {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="ai-message-box"
          initial={{ opacity: 0, y: 60, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 60, scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 280, damping: 24 }}
        >
          <button className="ai-msg-close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>

          <div className="ai-msg-header">
            <motion.div
              animate={{ y: [0, -3, 0] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
            >
              <MiniUfo />
            </motion.div>
            <span className="ai-msg-label">AI Assistant</span>
          </div>

          <p className="ai-msg-text">{message}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AIMessageBox;
