import { StyleSheet, Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { GOOGLE_TRANSLATE_RAPIDAPI_KEY } from '@env';

const googleTranslate = ( {query} ) => {
  const [translatedData, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const options = {
    method: 'POST',
    url: 'https://google-translator9.p.rapidapi.com/v2',
    headers: {
        'content-type': 'application/json',
        'X-RapidAPI-Key': GOOGLE_TRANSLATE_RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'google-translator9.p.rapidapi.com'
    },
    data: {
        q: query,
        source: 'ko',
        target: 'en-US',
        format: 'text'
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    console.log(`[googleTranslate] Translating: "${query}"`);
    try {
      const response = await axios.request(options);
      const translated = response.data.data.translations[0].translatedText;
      console.log(`[googleTranslate] Result: "${translated}"`);
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

const styles = StyleSheet.create({})
