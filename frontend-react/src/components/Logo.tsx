import React from 'react';
import { Link } from 'react-router-dom';
import './Logo.css';

/**
 * Financer brand mark — a rounded-square frame with a stylized "F" and an upward
 * growth-arrow that breaks out of the top-right corner. Hand-built single-colour
 * line art (stroke = currentColor) so it themes cleanly: accent blue on the light
 * header, white on the dark header. Mark only; the "Financer" wordmark sits beside
 * it. Shared with the app icon so header and favicon match.
 */
export const LogoMark: React.FC<{ size?: number; className?: string }> = ({ size = 34, className }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor"
    strokeWidth={4.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {/* Rounded-square frame, open at the top-right where the arrow breaks out */}
    <path d="M40 11H22A11 11 0 0 0 11 22V42A11 11 0 0 0 22 53H42A11 11 0 0 0 53 42V30" />
    {/* Stylized F: stem, hooked top arm, middle arm */}
    <path d="M22 19V45" />
    <path d="M22 19H38V25" />
    <path d="M22 31H33" />
    {/* Upward growth swoosh + arrowhead */}
    <path d="M18 46C23 43 27 40 31 36C37 30 43 24 49 19" />
    <path d="M45 16L57 11L54 23Z" fill="currentColor" stroke="none" />
  </svg>
);

const Logo: React.FC = () => (
  <Link to="/" className="logo-link" aria-label="Financer — Dashboard">
    <LogoMark className="logo-icon" />
    <span className="logo-wordmark">Financer</span>
  </Link>
);

export default Logo;
