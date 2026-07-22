import { useState, useEffect } from 'react';
import {
  getRuntimeInterfaceLanguage,
  getRuntimeTargetLanguage,
} from '../interfaceLanguage';
import { api } from './client';

const normalizeTranslationLanguageCode = (language, fallback) => {
  const raw = String(language || fallback || '').trim().toLowerCase().replace('_', '-');

  // Google Translate distinguishes scripts for Chinese; keep Traditional intact.
  if (['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo'].includes(raw)) {
    return 'zh-TW';
  }

  const normalized = raw.split(/[-_]/)[0];

  return normalized || fallback;
};

export const translateText = async ({
  query,
  source = 'ko',
  target = 'en',
  timeout = 8000,
} = {}) => {
  const cleanedQuery = typeof query === 'string' ? query.trim() : '';
  const sourceLanguage = normalizeTranslationLanguageCode(source, 'ko');
  const targetLanguage = normalizeTranslationLanguageCode(target, 'en');

  if (!cleanedQuery) {
    return '';
  }

  if (sourceLanguage === targetLanguage) {
    return cleanedQuery;
  }

  const response = await api.post('/translate/', {
    query: cleanedQuery,
    source: sourceLanguage,
    target: targetLanguage,
  }, {
    timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return response.data?.translatedText?.trim?.() ?? '';
};

const googleTranslate = ({ query, source = null, target = null } = {}) => {
  const [translatedData, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const translated = await translateText({
        query,
        source: source ?? getRuntimeTargetLanguage(),
        target: target ?? getRuntimeInterfaceLanguage(),
      });
      setData(translated);
    } catch(error) {
      console.error('[googleTranslate] Error translating:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [query, source, target]);

  return { translatedData };
}

export default googleTranslate
