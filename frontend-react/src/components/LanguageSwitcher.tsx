import React from 'react';
import { useTranslation } from 'react-i18next';

const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();

  return (
    <select
      value={i18n.language?.split('-')[0] ?? 'en'}
      onChange={e => i18n.changeLanguage(e.target.value)}
      className="language-switcher"
      aria-label="Select language"
    >
      <option value="en">EN</option>
      <option value="de">DE</option>
      <option value="ru">RU</option>
      <option value="uk">UK</option>
    </select>
  );
};

export default LanguageSwitcher;
