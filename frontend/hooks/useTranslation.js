import { useCallback } from 'react';

import { normalizeInterfaceLanguageCode } from '../constants/languages';
import { useAppContext } from '../contexts/AppContext';
import { translate } from '../i18n/translations';

export const useTranslation = () => {
  const { interfaceLanguage } = useAppContext();
  const language = normalizeInterfaceLanguageCode(interfaceLanguage);

  const t = useCallback((key, params = {}) => (
    translate(language, key, params)
  ), [language]);

  return { t, language };
};
