import { api } from './client';
import { getRuntimeInterfaceLanguage } from '../interfaceLanguage';

export const assessEntry = async ({
  body,
  category,
  language,
  prompt = '',
  sandboxWords = [],
  // Feedback (explanations, notes, patterns, vocab meanings) comes back in this
  // language; corrections stay in the target language. Defaults to the app's
  // current interface language.
  interfaceLanguage = getRuntimeInterfaceLanguage(),
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
      interface_language: interfaceLanguage,
    },
    {
      timeout,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  return response.data;
};
