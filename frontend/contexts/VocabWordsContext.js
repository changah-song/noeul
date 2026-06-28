import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAppContext } from './AppContext';
import { useLocalOwner } from './LocalOwnerContext';
import { viewData } from '../services/Database';

const VocabWordsContext = createContext([]);

export const useVocabWords = () => useContext(VocabWordsContext);

const getNextReviewTimestamp = (word) => {
  if (!word?.next_review_at) return null;
  const ts = new Date(word.next_review_at).getTime();
  return Number.isFinite(ts) ? ts : null;
};

const isReviewDue = (word) => {
  const nextReviewAt = getNextReviewTimestamp(word);
  const now = Date.now();
  return nextReviewAt !== null && nextReviewAt <= now && word?.level !== 'unorganized';
};

const normalizeWord = (row) => ({
  ...row,
  word: row.word ?? '',
  def: row.def ?? row.definition ?? '',
  next_review_at: row.next_review_at ?? null,
  level: row.level ?? null,
});

export const VocabWordsProvider = ({ children }) => {
  const { targetLanguage } = useAppContext();
  const { activeOwnerId } = useLocalOwner();
  const [dueVocabWords, setDueVocabWords] = useState([]);

  const loadWords = useCallback(async () => {
    if (!activeOwnerId || !targetLanguage) {
      setDueVocabWords([]);
      return;
    }

    try {
      const rows = await viewData({ ownerId: activeOwnerId, language: targetLanguage });
      const normalized = (rows ?? []).map(normalizeWord);
      const due = normalized.filter(isReviewDue);
      // Fall back to all saved words if nothing is due
      setDueVocabWords(due.length > 0 ? due : normalized);
    } catch {
      setDueVocabWords([]);
    }
  }, [activeOwnerId, targetLanguage]);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  return (
    <VocabWordsContext.Provider value={dueVocabWords}>
      {children}
    </VocabWordsContext.Provider>
  );
};
