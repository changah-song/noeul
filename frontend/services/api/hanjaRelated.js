import { useState, useEffect } from 'react';
import axios from 'axios';
import 'react-xml-parser';

const cleanMeaning = (meaning = '') => {
    const cleanString = String(meaning).replace(/\s*\(\s*<\s*a\s.*$/g, '');
    return cleanString;
};

const parseHeaderMeaning = (meaning = '') => {
    const cleaned = String(meaning).trim().replace(/\s*\(\d+\)$/, '');
    const [firstSegment, ...restSegments] = cleaned.split(',');
    const hasReading = /[\uAC00-\uD7A3]/.test(firstSegment) && restSegments.length > 0;

    return {
        reading: hasReading ? firstSegment.trim() : '',
        meaning: hasReading ? restSegments.join(',').trim() : cleaned,
    };
};

const getTableRows = (htmlDocument, tableIndex) => {
    const tables = htmlDocument?.getElementsByTagName('table') ?? [];
    return tables[tableIndex]?.getElementsByTagName('tr') ?? [];
};

const getCell = (row, cellIndex) => row?.getElementsByTagName('td')?.[cellIndex];

const getCellValue = (row, cellIndex) => getCell(row, cellIndex)?.value ?? '';

const getCellLinkValue = (row, cellIndex) => {
    const links = getCell(row, cellIndex)?.getElementsByTagName('a') ?? [];
    return links[0]?.value ?? '';
};

export const fetchHanjaRelated = async (query) => {
    const cleanedQuery = typeof query === 'string' ? query.trim() : '';

    if (!cleanedQuery) {
        return {
            firstTableData: [],
            similarWordsTableData: [],
        };
    }

    console.log(`[hanjaRelated] Fetching hanja data for: "${cleanedQuery}"`);
    const response = await axios.put(`https://koreanhanja.app/${encodeURIComponent(cleanedQuery)}`);
    const htmlContent = response.data;
    var ReactXmlParser = require('react-xml-parser');
    const htmlDocument = new ReactXmlParser().parseFromString(htmlContent);

    const firstTableData = getTableRows(htmlDocument, 0)
        .map(row => {
            const parsedMeaning = parseHeaderMeaning(getCellValue(row, 1));
            return {
                hanja: getCellLinkValue(row, 0),
                reading: parsedMeaning.reading,
                meaning: parsedMeaning.meaning,
            };
        })
        .filter(row => row.hanja || row.reading || row.meaning);
    console.log(`[hanjaRelated] "${cleanedQuery}" header table (${firstTableData.length} row(s)):`, firstTableData);

    const similarWordsTableData = getTableRows(htmlDocument, 1)
        .map(row => ({
            hanja: getCellLinkValue(row, 0),
            korean: getCellValue(row, 1).trim(),
            meaning: cleanMeaning(getCellValue(row, 2).trim()),
        }))
        .filter(row => row.hanja || row.korean || row.meaning);
    console.log(`[hanjaRelated] "${cleanedQuery}" similar words (${similarWordsTableData.length} row(s)):`, similarWordsTableData);

    return {
        firstTableData,
        similarWordsTableData,
    };
};

const hanjaRelated = ({ query }) => {
    // initialize hooks
    const [firstTableData, setFirstTableData] = useState([]);
    const [similarWordsTableData, setSimilarWordsTableData] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchData = async () => {
        try {
            if (!query) {
                console.log('[hanjaRelated] No query provided, clearing data');
                setFirstTableData([]);
                setSimilarWordsTableData([]);
                return;
            }

            setIsLoading(true);
            setError(null);
            const result = await fetchHanjaRelated(query);
            setFirstTableData(result.firstTableData);
            setSimilarWordsTableData(result.similarWordsTableData);
        } catch(error) {
            console.error(`[hanjaRelated] Error fetching data for "${query}":`, error);
            setError(error);
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        fetchData();
    }, [query]);

    return { firstTableData, similarWordsTableData, isLoading, error };
}

export default hanjaRelated
