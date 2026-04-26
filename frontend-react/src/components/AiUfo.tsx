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
  <svg width="60" height="42" viewBox="0 0 64 44" fill="none" xmlns="http://www.w3.org/2000/svg">
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
      y: -110,
      opacity: 0,
      scale: 0.8,
      transition: { duration: 0.5, ease: 'easeIn' },
    });
    setPhaseSync('idle');
    onDismiss();
  };

  useEffect(() => {
    if (!message || phaseRef.current !== 'idle') return;
    let cancelled = false;

    const run = async () => {
      setPhaseSync('flying-in');

      // Parabolic arc entrance: from bottom-left, swinging up through center
      ufoControls.set({ x: -140, y: 130, opacity: 0, scale: 0.7 });
      await ufoControls.start({
        x: [-140, 18, 0],
        y: [130, -65, 0],
        opacity: [0, 1, 1],
        scale: [0.7, 1.08, 1],
        transition: {
          duration: 1.35,
          times: [0, 0.52, 1],
          ease: 'easeOut',
        },
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
    // flyOut intentionally excluded — stable via phaseRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, ufoControls]);

  if (phase === 'idle') return null;

  return (
    <div className="ai-ufo-overlay">
      <AnimatePresence>
        {phase === 'hovering' && (
          <motion.div
            className="ai-ufo-bubble"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.22 }}
          >
            <button className="ai-ufo-close" onClick={flyOut} aria-label="Close">
              <X size={13} />
            </button>
            <p className="ai-ufo-text">{message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div className="ai-ufo-ship" animate={ufoControls}>
        <motion.div
          animate={phase === 'hovering' ? { y: [0, -6, 0] } : {}}
          transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
        >
          <UfoSvg />
        </motion.div>
      </motion.div>
    </div>
  );
};

export default AiUfo;
