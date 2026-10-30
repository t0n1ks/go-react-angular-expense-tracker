import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { avatarSrc, shownName } from '../utils/avatars';
import ProfileDialog from './ProfileDialog';
import './UserProfileChip.css';

interface Props {
  variant: 'sidebar' | 'header';
}

// The signed-in user's chip (sidebar on desktop, header on phone / tablet):
// the chosen avatar (or the first-letter circle) + the shown name. It opens
// the profile dialog; focus comes back here when that closes.
const UserProfileChip: React.FC<Props> = ({ variant }) => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);

  const name = shownName(user);
  const initial = (name[0] ?? '?').toUpperCase();
  const src = avatarSrc(user?.avatar);

  const close = useCallback(() => {
    setOpen(false);
    chipRef.current?.focus();
  }, []);

  return (
    <div className={`upc-wrapper upc-wrapper--${variant}`}>
      <button
        ref={chipRef}
        className="upc-chip"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('profile.open')}: ${name}`}
        type="button"
      >
        {src
          ? <img className="upc-avatar upc-avatar--img" src={src} alt="" />
          : <span className="upc-avatar" translate="no">{initial}</span>}
        <span className="upc-username" translate="no">{name}</span>
      </button>

      {open && <ProfileDialog onClose={close} />}
    </div>
  );
};

export default UserProfileChip;
