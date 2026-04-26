import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './PasswordField.css';

interface Props {
  id: string;
  className?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
}

const PasswordField: React.FC<Props> = ({ id, className = '', value, onChange, placeholder, required }) => {
  const [show, setShow] = useState(false);
  const { t } = useTranslation();

  return (
    <div className="pw-wrap">
      <input
        id={id}
        className={`pw-input ${className}`}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
      />
      <button
        type="button"
        className={`pw-toggle${show ? ' pw-toggle--active' : ''}`}
        onClick={() => setShow(v => !v)}
        aria-label={show ? t('auth.hide_password') : t('auth.show_password')}
        tabIndex={-1}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
};

export default PasswordField;
