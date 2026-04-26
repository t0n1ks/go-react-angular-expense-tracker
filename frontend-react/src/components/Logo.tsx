import React from 'react';
import { Link } from 'react-router-dom';
import './Logo.css';

const Logo: React.FC = () => (
  <Link to="/" className="logo-link" aria-label="Financer — Dashboard">
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg" className="logo-icon">
      <rect width="34" height="34" rx="8" fill="#0ea5e9"/>
      {/* F letterform */}
      <path d="M10 26V8h14M10 17h9" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Growth arrow */}
      <path d="M21 12l3.5-3.5M24.5 8.5h-3M24.5 8.5v3" stroke="rgba(186,230,253,0.85)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
    <span className="logo-wordmark">Financer</span>
  </Link>
);

export default Logo;
