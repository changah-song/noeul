import { useState, useEffect } from 'react';
import axios from 'axios';
import { GOOGLE_TRANSLATE_RAPIDAPI_KEY } from '@env';

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

  if (!GOOGLE_TRANSLATE_RAPIDAPI_KEY) {
    throw new Error('Missing GOOGLE_TRANSLATE_RAPIDAPI_KEY');
  }

  const response = await axios.request({
    method: 'POST',
    url: 'https://google-translator9.p.rapidapi.com/v2',
    headers: {
      'content-type': 'application/json',
      'X-RapidAPI-Key': GOOGLE_TRANSLATE_RAPIDAPI_KEY,
      'X-RapidAPI-Host': 'google-translator9.p.rapidapi.com',
    },
    timeout,
    data: {
      q: cleanedQuery,
      source,
      target,
      format: 'text',
    },
  });

  return response.data?.data?.translations?.[0]?.translatedText?.trim?.() ?? '';
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
