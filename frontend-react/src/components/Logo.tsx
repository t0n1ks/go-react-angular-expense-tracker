import React from 'react';
import { Link } from 'react-router-dom';
import LogoLight from '../assets/Logo_White.png'; // blue mark — shown in light theme
import LogoDark from '../assets/Logo_Dark.png';   // light mark — shown in dark theme
import './Logo.css';

/**
 * Header brand mark. Uses the provided PNG logos (rendered scaled to the header
 * logo box, like the cow PNG). Both images are always in the DOM and toggled by
 * theme via CSS, so switching themes is instant with no wrong-image flash. Mark
 * only — the "Financer" wordmark sits beside it.
 */
const Logo: React.FC = () => (
  <Link to="/" className="logo-link" aria-label="Financer — Dashboard">
    <img src={LogoLight} alt="" aria-hidden="true" width={22} height={22}
      className="logo-icon logo-icon--light" />
    <img src={LogoDark} alt="" aria-hidden="true" width={22} height={22}
      className="logo-icon logo-icon--dark" />
    <span className="logo-wordmark">Financer</span>
  </Link>
);

export default Logo;
