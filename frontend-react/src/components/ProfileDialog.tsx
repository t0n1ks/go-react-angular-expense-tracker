import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Camera, Check, Pencil, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AVATARS, avatarSrc, shownName } from '../utils/avatars';
import './ProfileDialog.css';

// The profile window: a centred glass dialog (every screen size) to change the
// shown name and pick an avatar. Saves via PATCH /profile, which touches only
// these two fields; the server copy is what every device loads.

const MAX_NAME = 50;

interface Props {
  onClose: () => void;
}

const ProfileDialog: React.FC<Props> = ({ onClose }) => {
  const { t } = useTranslation();
  const { user, axiosInstance, updateIdentity } = useAuth();
  const [name, setName] = useState(shownName(user));
  const [avatar, setAvatar] = useState(user?.avatar ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Open: the page behind doesn't scroll; focus the name; Tab stays inside;
  // Escape closes.
  useEffect(() => {
    nameRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(closeTimer.current);
    };
  }, [onClose]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError(t('profile.error_empty')); nameRef.current?.focus(); return; }
    if ([...trimmed].length > MAX_NAME) { setError(t('profile.error_long')); nameRef.current?.focus(); return; }
    setSaving(true);
    setError('');
    try {
      const res = await axiosInstance.patch('/profile', { display_name: trimmed, avatar });
      updateIdentity({ displayName: res.data.display_name ?? trimmed, avatar: res.data.avatar ?? avatar });
      setSaved(true);
      closeTimer.current = setTimeout(onClose, 1100);
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      setError(code === 'name_empty' ? t('profile.error_empty')
        : code === 'name_too_long' ? t('profile.error_long')
        : t('profile.error_save'));
    } finally {
      setSaving(false);
    }
  };

  const initial = (name.trim()[0] ?? user?.username?.[0] ?? '?').toUpperCase();
  const previewSrc = avatarSrc(avatar);

  return createPortal(
    <div className="profile-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
        onClick={e => e.stopPropagation()}
      >
        <button type="button" className="profile-close" onClick={onClose} aria-label={t('profile.close')}>
          <X size={18} aria-hidden="true" />
        </button>
        <h2 id="profile-dialog-title" className="profile-title">{t('profile.title')}</h2>

        <form onSubmit={save} noValidate>
          {/* Large preview of the current choice */}
          <div className="profile-preview" aria-hidden="true">
            {previewSrc
              ? <img src={previewSrc} alt="" className="profile-preview-img" />
              : <span className="profile-letter profile-letter--large" translate="no">{initial}</span>}
            <span className="profile-preview-badge"><Camera size={14} /></span>
          </div>

          <label className="profile-label" htmlFor="profile-name">{t('profile.name')}</label>
          <div className={`profile-name-field${error ? ' profile-name-field--error' : ''}`}>
            <input
              ref={nameRef}
              id="profile-name"
              className="profile-name-input"
              type="text"
              value={name}
              maxLength={MAX_NAME}
              autoComplete="nickname"
              placeholder={t('profile.name_placeholder')}
              aria-invalid={!!error}
              aria-describedby={error ? 'profile-error' : undefined}
              onChange={e => { setName(e.target.value); setError(''); setSaved(false); }}
            />
            <Pencil size={16} className="profile-name-pencil" aria-hidden="true" />
          </div>

          <p className="profile-label profile-label--grid" id="profile-avatar-label">{t('profile.choose_avatar')}</p>
          <div className="profile-avatar-grid" role="group" aria-labelledby="profile-avatar-label">
            <button
              type="button"
              className={`profile-avatar-option${avatar === '' ? ' profile-avatar-option--selected' : ''}`}
              aria-pressed={avatar === ''}
              aria-label={t('profile.no_avatar')}
              title={t('profile.no_avatar')}
              onClick={() => { setAvatar(''); setSaved(false); }}
            >
              <span className="profile-letter" translate="no">{initial}</span>
            </button>
            {AVATARS.map(a => (
              <button
                key={a.id}
                type="button"
                className={`profile-avatar-option${avatar === a.id ? ' profile-avatar-option--selected' : ''}`}
                aria-pressed={avatar === a.id}
                aria-label={t(`profile.avatar_${a.id}`)}
                title={t(`profile.avatar_${a.id}`)}
                onClick={() => { setAvatar(a.id); setSaved(false); }}
              >
                <img src={a.src} alt="" loading="lazy" />
              </button>
            ))}
          </div>

          <p className="profile-message" role="status" aria-live="polite">
            {error && <span id="profile-error" className="profile-message--error">{error}</span>}
            {saved && !error && <span className="profile-message--ok"><Check size={14} aria-hidden="true" /> {t('profile.saved')}</span>}
          </p>

          <button type="submit" className="profile-save" disabled={saving}>
            {saving ? t('profile.saving') : t('profile.save')}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
};

export default ProfileDialog;
