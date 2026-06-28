import { api } from './client';

export const assessEntry = async ({
  body,
  category,
  language,
  prompt = '',
  sandboxWords = [],
  timeout = 60000,
} = {}) => {
  const response = await api.post(
    '/assess_entry/',
    {
      body,
      category,
      language,
      prompt,
      sandbox_words: sandboxWords,
    },
    {
      timeout,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  return response.data;
};
