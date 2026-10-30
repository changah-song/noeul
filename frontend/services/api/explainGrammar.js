import { api } from './client';

/**
 * explainGrammar — the grammar pattern a selected sentence uses (the AI
 * panel's Grammar tab; backend /explain_grammar/). Resolves
 * { pattern_id ('none' when nothing tracked fits), title, form, level, rule,
 *   chunks: [{ text, label, pattern }], blank, options }.
 */
export const explainGrammar = async ({
  text,
  sentence,
  language,
  interfaceLanguage,
  timeout = 30000,
} = {}) => {
  const response = await api.post(
    '/explain_grammar/',
    {
      word: text,
      sentence: sentence || text,
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
