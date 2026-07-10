import { api } from './client';

export const explainInContext = async ({
  word,
  sentence,
  language,
  interfaceLanguage,
  timeout = 30000,
} = {}) => {
  const response = await api.post(
    '/explain_in_context/',
    {
      word,
      sentence,
      language,
      interface_language: interfaceLanguage,
    },
    {
      timeout,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  return response.data;
};
