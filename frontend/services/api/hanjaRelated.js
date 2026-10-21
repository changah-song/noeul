import { useState, useEffect } from 'react';

import { lookupHanjaCharacter } from '../hanjaDatabase';
import { isEnglishInterface, translateContentTexts } from '../contentTranslation';

const cleanValue = (value) => (typeof value === 'string' ? value.trim() : '');

const emptyResult = () => ({
    firstTableData: [],
    similarWordsTableData: [],
});

const relatedWordKey = (word) => [
    cleanValue(word?.hangul),
    cleanValue(word?.hanja),
].join('|');

const mapMeaningRow = (meaning) => {
    const hunKorean = cleanValue(meaning?.hun_korean);
    const hunEnglish = cleanValue(meaning?.hun_english);
    const hunDisplay = cleanValue(meaning?.hun_display);

    return {
        hanja: cleanValue(meaning?.char || meaning?.character),
        reading: cleanValue(meaning?.eum),
        meaning: hunDisplay,
        hun_korean: hunKorean,
        hun_english: hunEnglish,
        hun_display: hunDisplay,
    };
};

const mapRelatedWordRow = (word) => ({
    hanja: cleanValue(word?.hanja),
    korean: cleanValue(word?.hangul),
    meaning: cleanValue(word?.definition_display || word?.definition_english || word?.definition_korean),
    definition_english: cleanValue(word?.definition_english),
    definition_display: cleanValue(word?.definition_display),
    word_grade: cleanValue(word?.word_grade),
});

// Fill meanings hanja.db has no value for in the interface language (no
// column for ja/pt/zh-Hant/ko, cleared placeholder values) by machine-
// translating the English. What can't be translated stays English and is
// flagged: rows get meaning_language 'en', the result gets englishFallback
// ('offline' | 'unavailable') so the UI can say the text is English.
export const localizeHanjaResult = async (result, interfaceLanguage) => {
    const { firstTableData, similarWordsTableData } = result;
    if (isEnglishInterface(interfaceLanguage)) {
        return { ...result, englishFallback: null };
    }
    const meaningTexts = firstTableData
        .filter((row) => !row.hun_display && row.hun_english)
        .map((row) => row.hun_english);
    const definitionTexts = similarWordsTableData
        .filter((row) => !row.definition_display && row.definition_english)
        .map((row) => row.definition_english);
    if (meaningTexts.length === 0 && definitionTexts.length === 0) {
        return { ...result, englishFallback: null };
    }

    const [meanings, definitions] = await Promise.all([
        translateContentTexts(meaningTexts, interfaceLanguage, { kind: 'hanja_meaning' }),
        translateContentTexts(definitionTexts, interfaceLanguage, { kind: 'hanja_word_definition' }),
    ]);
    let usedEnglish = false;
    const localizedMeanings = firstTableData.map((row) => {
        if (row.hun_display || !row.hun_english) return row;
        const translated = meanings.translations.get(row.hun_english);
        if (translated) {
            return { ...row, meaning: translated, hun_display: translated, meaning_language: 'machine' };
        }
        usedEnglish = true;
        return { ...row, meaning: row.hun_english, hun_display: row.hun_english, meaning_language: 'en' };
    });
    const localizedWords = similarWordsTableData.map((row) => {
        if (row.definition_display || !row.definition_english) return row;
        const translated = definitions.translations.get(row.definition_english);
        if (translated) {
            return { ...row, meaning: translated, definition_display: translated, meaning_language: 'machine' };
        }
        usedEnglish = true;
        return { ...row, meaning: row.definition_english, meaning_language: 'en' };
    });
    const englishFallback = usedEnglish
        ? (meanings.fallback === 'offline' || definitions.fallback === 'offline' ? 'offline' : 'unavailable')
        : null;
    return {
        firstTableData: localizedMeanings,
        similarWordsTableData: localizedWords,
        englishFallback,
    };
};

const getUniqueRelatedWords = (meanings) => {
    const seen = new Set();
    const relatedWords = [];

    meanings.forEach((meaning) => {
        const words = Array.isArray(meaning?.related_words) ? meaning.related_words : [];

        words.forEach((word) => {
            const key = relatedWordKey(word);
            if (seen.has(key)) {
                return;
            }

            seen.add(key);
            relatedWords.push(mapRelatedWordRow(word));
        });
    });

    return relatedWords
        .filter(word => word.hanja || word.korean || word.meaning);
};

export const fetchHanjaRelated = async (query, options = {}) => {
    const cleanedQuery = cleanValue(query);

    if (!cleanedQuery) {
        return emptyResult();
    }

    const meanings = await lookupHanjaCharacter(cleanedQuery, {
        limit: options.limit ?? 'all',
        interfaceLanguage: options.interfaceLanguage,
    });

    if (!Array.isArray(meanings) || meanings.length === 0) {
        return emptyResult();
    }

    const firstTableData = meanings
        .map(mapMeaningRow)
        .filter(row => row.hanja || row.reading || row.meaning || row.hun_english);
    const similarWordsTableData = getUniqueRelatedWords(meanings);

    return localizeHanjaResult({ firstTableData, similarWordsTableData }, options.interfaceLanguage);
};

const hanjaRelated = ({ query, interfaceLanguage = 'en' }) => {
    const [firstTableData, setFirstTableData] = useState([]);
    const [similarWordsTableData, setSimilarWordsTableData] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchData = async () => {
        try {
            if (!query) {
                setFirstTableData([]);
                setSimilarWordsTableData([]);
                return;
            }

            setIsLoading(true);
            setError(null);
            const result = await fetchHanjaRelated(query, { interfaceLanguage });
            setFirstTableData(result.firstTableData);
            setSimilarWordsTableData(result.similarWordsTableData);
        } catch (error) {
            console.error(`[hanjaRelated] Error fetching data for "${query}":`, error);
            setError(error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [query, interfaceLanguage]);

    return { firstTableData, similarWordsTableData, isLoading, error };
};

export default hanjaRelated;
