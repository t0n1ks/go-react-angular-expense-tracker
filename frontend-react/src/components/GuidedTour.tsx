import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import './GuidedTour.css';

export const TOUR_KEY = 'tour_v1_done';

const UFO_W = 60;
const UFO_H = 42;
const HOVER_MS = 4500;
const BUBBLE_W = 240;
const BUBBLE_EST_H = 160;

interface Step {
  desktopSel: string;
  mobileSel: string;
  titleKey: string;
  textKey: string;
}

const STEPS: Step[] = [
  { desktopSel: '[data-tour-id="home"]',         mobileSel: '[data-tour-id="home-m"]',         titleKey: 'tour.home_title',         textKey: 'tour.home_text' },
  { desktopSel: '[data-tour-id="categories"]',   mobileSel: '[data-tour-id="categories-m"]',   titleKey: 'tour.categories_title',   textKey: 'tour.categories_text' },
  { desktopSel: '[data-tour-id="transactions"]', mobileSel: '[data-tour-id="transactions-m"]', titleKey: 'tour.transactions_title', textKey: 'tour.transactions_text' },
  { desktopSel: '[data-tour-id="statistics"]',   mobileSel: '[data-tour-id="statistics-m"]',   titleKey: 'tour.statistics_title',   textKey: 'tour.statistics_text' },
  { desktopSel: '[data-tour-id="settings"]',     mobileSel: '[data-tour-id="settings-m"]',     titleKey: 'tour.settings_title',     textKey: 'tour.settings_text' },
];

function clamp(min: number, val: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function getTargetCenter(step: Step): { x: number; y: number } | null {
  const isMobile = window.matchMedia('(max-width: 1024px)').matches;
  const sel = isMobile ? step.mobileSel : step.desktopSel;
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

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

const GuidedTour: React.FC = () => {
  const { t } = useTranslation();
  const controls = useAnimation();

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [showBubble, setShowBubble] = useState(false);
  const [bubblePos, setBubblePos] = useState({ x: 0, y: 0 });

  const visibleRef = useRef(false);
  const stepRef = useRef(0);
  const ufoPosRef = useRef({ x: 0, y: 0 });
  const stepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const delayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setStepSync = (s: number) => {
    stepRef.current = s;
    setStep(s);
  };

  const setVisibleSync = (v: boolean) => {
    visibleRef.current = v;
    setVisible(v);
  };

  const finish = async () => {
    clearTimeout(stepTimer.current);
    clearTimeout(delayTimer.current);
    setShowBubble(false);
    await controls.start({
      opacity: 0,
      y: ufoPosRef.current.y - 80,
      transition: { duration: 0.4, ease: 'easeIn' },
    });
    setVisibleSync(false);
    localStorage.setItem(TOUR_KEY, '1');
  };

  const runStep = async (idx: number) => {
    if (!visibleRef.current) return;
    if (idx >= STEPS.length) {
      finish();
      return;
    }

    clearTimeout(stepTimer.current);
    setShowBubble(false);

    const delay = idx === 0 ? 80 : 200;
    await new Promise<void>((res) => {
      delayTimer.current = setTimeout(res, delay);
    });

    if (!visibleRef.current) return;

    setStepSync(idx);

    const center = getTargetCenter(STEPS[idx]);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let targetX: number;
    let targetY: number;

    if (center) {
      targetX = clamp(8, center.x - UFO_W / 2, vw - UFO_W - 8);
      targetY = clamp(64, center.y - UFO_H - 28, vh - 200);
    } else {
      targetX = vw / 2 - UFO_W / 2;
      targetY = vh / 2 - UFO_H / 2;
    }

    ufoPosRef.current = { x: targetX, y: targetY };

    const isMobile = window.matchMedia('(max-width: 1024px)').matches;
    let bx: number;
    let by: number;

    if (isMobile) {
      bx = clamp(8, targetX + UFO_W / 2 - BUBBLE_W / 2, vw - BUBBLE_W - 8);
      by = Math.max(60, targetY - BUBBLE_EST_H - 14);
    } else {
      const goRight = targetX + UFO_W / 2 < vw * 0.55;
      bx = goRight ? targetX + UFO_W + 12 : targetX - BUBBLE_W - 12;
      by = Math.max(64, targetY - 8);
    }

    setBubblePos({ x: bx, y: by });

    const transitionConfig =
      idx === 0
        ? { type: 'tween' as const, duration: 0.6, ease: 'easeOut' as const }
        : { type: 'spring' as const, stiffness: 120, damping: 18 };

    await controls.start({
      x: targetX,
      y: targetY,
      opacity: 1,
      transition: transitionConfig,
    });

    if (!visibleRef.current) return;
    setShowBubble(true);

    if (idx < STEPS.length - 1) {
      stepTimer.current = setTimeout(() => {
        if (visibleRef.current && stepRef.current === idx) {
          runStep(idx + 1);
        }
      }, HOVER_MS);
    }
  };

  const handleNext = () => {
    const nextIdx = stepRef.current + 1;
    if (nextIdx >= STEPS.length) {
      finish();
    } else {
      runStep(nextIdx);
    }
  };

  useEffect(() => {
    if (localStorage.getItem(TOUR_KEY)) return;

    controls.set({ x: window.innerWidth / 2, y: window.innerHeight + 60, opacity: 0 });
    setVisibleSync(true);

    delayTimer.current = setTimeout(() => {
      runStep(0);
    }, 1500);

    return () => {
      clearTimeout(stepTimer.current);
      clearTimeout(delayTimer.current);
    };
    // finish / runStep intentionally excluded — stable via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  const isLast = step === STEPS.length - 1;

  return (
    <div className="guided-tour-root">
      <div className="guided-tour-overlay" onClick={finish} />

      <motion.div
        className="tour-ufo-wrap"
        style={{ position: 'fixed', top: 0, left: 0 }}
        animate={controls}
      >
        <motion.div
          animate={showBubble ? { y: [0, -5, 0] } : {}}
          transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
        >
          <UfoSvg />
        </motion.div>
        <div className="tour-spotlight" />
      </motion.div>

      <AnimatePresence>
        {showBubble && (
          <motion.div
            className="tour-bubble"
            style={{ position: 'fixed', left: bubblePos.x, top: bubblePos.y }}
            initial={{ opacity: 0, scale: 0.88, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: 6 }}
            transition={{ duration: 0.2 }}
          >
            <p className="tour-bubble-title">{t(STEPS[step].titleKey)}</p>
            <p className="tour-bubble-text">{t(STEPS[step].textKey)}</p>
            <footer className="tour-bubble-footer">
              <span className="tour-dots">
                {STEPS.map((_, i) => (
                  <span key={i} className={`tour-dot${i === step ? ' active' : ''}`} />
                ))}
              </span>
              <div className="tour-actions">
                <button className="tour-btn-skip" onClick={finish}>{t('tour.skip')}</button>
                <button className="tour-btn-next" onClick={handleNext}>
                  {isLast ? t('tour.done') : t('tour.next')}
                </button>
              </div>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default GuidedTour;
