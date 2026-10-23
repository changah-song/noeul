import { useState, useEffect } from 'react';
import {
  getRuntimeInterfaceLanguage,
  getRuntimeTargetLanguage,
} from '../interfaceLanguage';
import { api } from './client';

export const normalizeTranslationLanguageCode = (language, fallback) => {
  const raw = String(language || fallback || '').trim().toLowerCase().replace('_', '-');

  // Google Translate distinguishes scripts for Chinese; keep Traditional intact.
  if (['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo'].includes(raw)) {
    return 'zh-TW';
  }

  const normalized = raw.split(/[-_]/)[0];

  return normalized || fallback;
};

// Translate text and, for Chinese source text, also return tone-marked pinyin so
// the panels can show the reading above the translation. Returns
// { translatedText, pinyin } — pinyin is null for non-Chinese source.
export const translateWithPinyin = async ({
  query,
  source = 'ko',
  target = 'en',
  timeout = 8000,
} = {}) => {
  const cleanedQuery = typeof query === 'string' ? query.trim() : '';
  const sourceLanguage = normalizeTranslationLanguageCode(source, 'ko');
  const targetLanguage = normalizeTranslationLanguageCode(target, 'en');

  if (!cleanedQuery) {
    return { translatedText: '', pinyin: null };
  }

  if (sourceLanguage === targetLanguage) {
    return { translatedText: cleanedQuery, pinyin: null };
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

  return {
    translatedText: response.data?.translatedText?.trim?.() ?? '',
    pinyin: response.data?.pinyin?.trim?.() ?? null,
  };
};

// Many sentences in one request (a chapter's worth, in chunks): returns a list
// aligned to `texts`, null where a sentence couldn't be translated. The server
// caches each sentence, so text already translated once costs nothing.
export const translateSentences = async ({
  texts = [],
  source = 'ko',
  target = 'en',
  timeout = 45000,
} = {}) => {
  const response = await api.post('/translate_sentences/', {
    texts,
    source: normalizeTranslationLanguageCode(source, 'ko'),
    target: normalizeTranslationLanguageCode(target, 'en'),
  }, { timeout });
  const translations = Array.isArray(response.data?.translations) ? response.data.translations : [];
  return texts.map((_, index) => {
    const value = translations[index];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  });
};

export const translateText = async (params = {}) => {
  const { translatedText } = await translateWithPinyin(params);
  return translatedText;
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
