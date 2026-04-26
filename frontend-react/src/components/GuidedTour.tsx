import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import './GuidedTour.css';

export const TOUR_KEY = 'tour_v1_done';

const UFO_W = 60;
const UFO_H = 42;
const HOVER_MS = 4500;
const DESKTOP_BUBBLE_W = 240;
const HIGHLIGHT_CLASS = 'tour-highlight-active';

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

function getTargetEl(step: Step, mob: boolean): HTMLElement | null {
  return document.querySelector<HTMLElement>(mob ? step.mobileSel : step.desktopSel);
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

  // Determined once at mount — stable for the component's lifetime
  const [mobile] = useState(() => window.matchMedia('(max-width: 1024px)').matches);

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [showBubble, setShowBubble] = useState(false);
  const [bubblePos, setBubblePos] = useState({ x: 0, y: 0 }); // desktop only

  const visibleRef = useRef(false);
  const stepRef = useRef(0);
  const ufoPosRef = useRef({ x: 0, y: 0 }); // desktop only
  const highlightedElRef = useRef<HTMLElement | null>(null);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const delayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setStepSync = (s: number) => { stepRef.current = s; setStep(s); };
  const setVisibleSync = (v: boolean) => { visibleRef.current = v; setVisible(v); };

  const clearHighlight = () => {
    highlightedElRef.current?.classList.remove(HIGHLIGHT_CLASS);
    highlightedElRef.current = null;
  };

  const finish = async () => {
    clearTimeout(stepTimer.current);
    clearTimeout(delayTimer.current);
    clearHighlight();
    setShowBubble(false);

    if (mobile) {
      // Give the bubble's AnimatePresence exit (0.18s) time to complete
      await new Promise<void>((res) => setTimeout(res, 220));
    } else {
      await controls.start({
        opacity: 0,
        y: ufoPosRef.current.y - 80,
        transition: { duration: 0.35, ease: 'easeIn' as const },
      });
    }

    setVisibleSync(false);
    localStorage.setItem(TOUR_KEY, '1');
  };

  const runStep = async (idx: number) => {
    if (!visibleRef.current) return;
    if (idx >= STEPS.length) { finish(); return; }

    clearTimeout(stepTimer.current);
    clearHighlight();
    setShowBubble(false);

    await new Promise<void>((res) => { delayTimer.current = setTimeout(res, idx === 0 ? 80 : 200); });
    if (!visibleRef.current) return;

    setStepSync(idx);

    // Apply glow to current target element
    const el = getTargetEl(STEPS[idx], mobile);
    if (el) { highlightedElRef.current = el; el.classList.add(HIGHLIGHT_CLASS); }

    if (mobile) {
      // UFO is static (CSS-positioned) — nothing to animate, just show the bubble
    } else {
      // Desktop: UFO spring-animates to hover above the highlighted element
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = el?.getBoundingClientRect();
      let ufoX: number, ufoY: number;

      if (rect && rect.width > 0) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        ufoX = clamp(8, cx - UFO_W / 2, vw - UFO_W - 8);
        ufoY = clamp(64, cy - UFO_H - 28, vh - 200);
      } else {
        ufoX = vw / 2 - UFO_W / 2;
        ufoY = vh / 2 - UFO_H / 2;
      }

      ufoPosRef.current = { x: ufoX, y: ufoY };

      const goRight = ufoX + UFO_W / 2 < vw * 0.55;
      setBubblePos({
        x: goRight ? ufoX + UFO_W + 12 : ufoX - DESKTOP_BUBBLE_W - 12,
        y: Math.max(64, ufoY - 8),
      });

      await controls.start({
        x: ufoX, y: ufoY, opacity: 1,
        transition: idx === 0
          ? { type: 'tween' as const, duration: 0.6, ease: 'easeOut' as const }
          : { type: 'spring' as const, stiffness: 120, damping: 18 },
      });
    }

    if (!visibleRef.current) return;
    setShowBubble(true);

    if (idx < STEPS.length - 1) {
      stepTimer.current = setTimeout(() => {
        if (visibleRef.current && stepRef.current === idx) runStep(idx + 1);
      }, HOVER_MS);
    }
  };

  const handleNext = () => {
    const nextIdx = stepRef.current + 1;
    if (nextIdx >= STEPS.length) finish(); else runStep(nextIdx);
  };

  useEffect(() => {
    if (localStorage.getItem(TOUR_KEY)) return;

    if (!mobile) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      controls.set({ x: vw / 2 - UFO_W / 2, y: vh + 60, opacity: 0 });
    }

    setVisibleSync(true);
    delayTimer.current = setTimeout(() => { runStep(0); }, 1500);

    return () => {
      clearTimeout(stepTimer.current);
      clearTimeout(delayTimer.current);
      clearHighlight();
    };
    // runStep / finish / mobile stable via closure — intentionally excluded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  const isLast = step === STEPS.length - 1;

  const BubbleContent = (
    <>
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
    </>
  );

  /* ── Mobile / Tablet: static side-by-side dock ──────────────────────────── */
  if (mobile) {
    return (
      <div className="guided-tour-root">
        <motion.div
          className="tour-mobile-dock"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {/* UFO — no positional animation, just the hover bob */}
          <motion.div
            className="tour-ufo-bob"
            animate={showBubble ? { y: [0, -5, 0] } : {}}
            transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
          >
            <UfoSvg />
          </motion.div>

          {/* Compact bubble to the right of the UFO */}
          <AnimatePresence>
            {showBubble && (
              <motion.div
                className="tour-bubble tour-bubble--compact"
                initial={{ opacity: 0, scale: 0.9, x: -6 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: -6 }}
                transition={{ duration: 0.18 }}
              >
                {BubbleContent}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    );
  }

  /* ── Desktop: UFO moves to each sidebar item ────────────────────────────── */
  return (
    <div className="guided-tour-root">
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
            {BubbleContent}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default GuidedTour;
