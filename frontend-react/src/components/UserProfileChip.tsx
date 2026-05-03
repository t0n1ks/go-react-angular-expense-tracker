import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import './UserProfileChip.css';

interface Props {
  variant: 'sidebar' | 'header';
}

const UserProfileChip: React.FC<Props> = ({ variant }) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const initial = (user?.username?.[0] ?? '?').toUpperCase();

  return (
    <div className={`upc-wrapper upc-wrapper--${variant}`} ref={wrapperRef}>
      <button
        className="upc-chip"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        type="button"
      >
        <span className="upc-avatar" translate="no">{initial}</span>
        <span className="upc-username" translate="no">{user?.username}</span>
      </button>

      {open && (
        <div className={`upc-dropdown upc-dropdown--${variant}`}>
          <div className="upc-dropdown-header">
            <span className="upc-dropdown-username" translate="no">{user?.username}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserProfileChip;
