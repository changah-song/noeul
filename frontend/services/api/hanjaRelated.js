import { useState, useEffect } from 'react';

import { lookupHanjaCharacter } from '../hanjaDatabase';

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
    word_grade: cleanValue(word?.word_grade),
});

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
        .filter(row => row.hanja || row.reading || row.meaning);
    const similarWordsTableData = getUniqueRelatedWords(meanings);

    return {
        firstTableData,
        similarWordsTableData,
    };
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
