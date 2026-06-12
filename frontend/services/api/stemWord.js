import { api } from './client';
import { normalizeBookLanguage } from '../../constants/languages';

const stemWord = async ({ query, language = 'ko' }) => {
  if (!query || query.trim() === "") return [];
  const targetLanguage = normalizeBookLanguage(language);
  const endpointByLanguage = {
      en: '/en_morphs/',
      zh: '/zh_morphs/',
  };
  const endpoint = endpointByLanguage[targetLanguage] ?? '/okt_morphs/';

  try {
      const response = await api.get(endpoint, {
          params: { text: query }
      });
      return response.data.result;

  } catch (error) {
      console.error("[stemWord] Error fetching morphs from Python API:", error);
      return [];
  }
};

export default stemWord;
