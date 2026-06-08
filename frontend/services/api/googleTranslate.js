import { useState, useEffect } from 'react';
import { api } from './client';

export const translateText = async ({
  query,
  source = 'ko',
  target = 'en-US',
  timeout = 8000,
} = {}) => {
  const cleanedQuery = typeof query === 'string' ? query.trim() : '';

  if (!cleanedQuery) {
    return '';
  }

  const response = await api.post('/translate/', {
    query: cleanedQuery,
    source,
    target,
  }, {
    timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return response.data?.translatedText?.trim?.() ?? '';
};

const googleTranslate = ( {query} ) => {
  const [translatedData, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const translated = await translateText({ query });
      setData(translated);
    } catch(error) {
      console.error('[googleTranslate] Error translating:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [query]);

  return { translatedData };
}

export default googleTranslate
