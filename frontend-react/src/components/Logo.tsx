import React from 'react';
import { Link } from 'react-router-dom';
import './Logo.css';

/**
 * Financer brand mark — a rounded-square tile in the app's blue accent containing
 * a stylized "F" integrated with an upward growth-arrow trendline. Hand-built SVG
 * (crisp at header sizes and high-DPI). Mark only; the "Financer" wordmark sits
 * beside it. Shared with the app icon so header and favicon match.
 */
export const LogoMark: React.FC<{ size?: number; className?: string }> = ({ size = 34, className }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none"
    xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="fin-tile" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#38bdf8" />
        <stop offset="1" stopColor="#0284c7" />
      </linearGradient>
    </defs>
    <rect width="40" height="40" rx="11" fill="url(#fin-tile)" />
    {/* Stylized F */}
    <path d="M14 28.5V12.5H24.5" stroke="#fff" strokeWidth="3.4"
      strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 20.5H21.5" stroke="#fff" strokeWidth="3.4"
      strokeLinecap="round" strokeLinejoin="round" />
    {/* Upward growth arrow / trendline */}
    <path d="M20 26.5L28 16.5" stroke="#bae6fd" strokeWidth="2.6"
      strokeLinecap="round" strokeLinejoin="round" />
    <path d="M23.4 16.5H28V21.1" stroke="#bae6fd" strokeWidth="2.6"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Logo: React.FC = () => (
  <Link to="/" className="logo-link" aria-label="Financer — Dashboard">
    <LogoMark className="logo-icon" />
    <span className="logo-wordmark">Financer</span>
  </Link>
);

export default Logo;
