import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { X } from 'lucide-react';
import './AiUfo.css';

interface Props {
  message: string | null;
  onDismiss: () => void;
}

type Phase = 'idle' | 'flying-in' | 'hovering' | 'flying-out';

const UfoSvg: React.FC = () => (
  <svg width="64" height="44" viewBox="0 0 64 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="32" cy="20" rx="13" ry="10" fill="#475569" stroke="#64748b" strokeWidth="1.5" />
    <ellipse cx="32" cy="18" rx="7" ry="6" fill="#38bdf8" opacity="0.9" />
    <ellipse cx="32" cy="28" rx="29" ry="8.5" fill="#334155" stroke="#475569" strokeWidth="1.5" />
    <circle cx="16" cy="29" r="2.5" fill="#fbbf24" />
    <circle cx="32" cy="32" r="2.5" fill="#fbbf24" />
    <circle cx="48" cy="29" r="2.5" fill="#fbbf24" />
  </svg>
);

const AiUfo: React.FC<Props> = ({ message, onDismiss }) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const ufoControls = useAnimation();
  const autoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setPhaseSync = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const flyOut = async () => {
    clearTimeout(autoTimer.current);
    setPhaseSync('flying-out');
    await ufoControls.start({
      x: 200,
      y: -200,
      opacity: 0,
      transition: { duration: 0.55, ease: 'easeIn' },
    });
    setPhaseSync('idle');
    onDismiss();
  };

  const handleClose = () => {
    flyOut();
  };

  useEffect(() => {
    if (!message || phaseRef.current !== 'idle') return;
    let cancelled = false;

    const run = async () => {
      setPhaseSync('flying-in');
      ufoControls.set({ x: 200, y: 200, opacity: 0 });
      await ufoControls.start({
        x: 0,
        y: 0,
        opacity: 1,
        transition: { type: 'spring', stiffness: 180, damping: 20 },
      });
      if (cancelled) return;
      setPhaseSync('hovering');
      autoTimer.current = setTimeout(() => {
        if (!cancelled && phaseRef.current === 'hovering') flyOut();
      }, 9000);
    };

    run();
    return () => {
      cancelled = true;
      clearTimeout(autoTimer.current);
    };
    // flyOut intentionally excluded — stable enough via phaseRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, ufoControls]);

  if (phase === 'idle') return null;

  return (
    <div className="ai-ufo-overlay">
      <AnimatePresence>
        {phase === 'hovering' && (
          <motion.div
            className="ai-ufo-bubble"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
          >
            <button className="ai-ufo-close" onClick={handleClose} aria-label="Close">
              <X size={13} />
            </button>
            <p className="ai-ufo-text">{message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div className="ai-ufo-ship" animate={ufoControls}>
        <motion.div
          animate={phase === 'hovering' ? { y: [0, -5, 0] } : {}}
          transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
        >
          <UfoSvg />
        </motion.div>
      </motion.div>
    </div>
  );
};

export default AiUfo;
