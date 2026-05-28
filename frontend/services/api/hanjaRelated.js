import { useState, useEffect } from 'react';
import axios from 'axios';
import 'react-xml-parser';

const hanjaRelated = ({ query }) => {
    // initialize hooks
    const [firstTableData, setFirstTableData] = useState([]);
    const [similarWordsTableData, setSimilarWordsTableData] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    // clean data response for definition where (<a href...)
    const cleanMeaning = (meaning) => {
        // Regular expression to remove anything from <a href onward
        const cleanString = meaning.replace(/\s*\(\s*<\s*a\s.*$/g, '');
        return cleanString;
    }

    const parseHeaderMeaning = (meaning) => {
        const cleaned = meaning.trim().replace(/\s*\(\d+\)$/, '');
        const [firstSegment, ...restSegments] = cleaned.split(',');
        const hasReading = /[\uAC00-\uD7A3]/.test(firstSegment) && restSegments.length > 0;

        return {
            reading: hasReading ? firstSegment.trim() : '',
            meaning: hasReading ? restSegments.join(',').trim() : cleaned,
        };
    }

    const fetchData = async () => {
        try {
            if (!query) {
                console.log('[hanjaRelated] No query provided, clearing data');
                setFirstTableData([]);
                setSimilarWordsTableData([]);
                return;
            }
            console.log(`[hanjaRelated] Fetching hanja data for: "${query}"`);
            let result = [];
            const response = await axios.put(`https://koreanhanja.app/${encodeURIComponent(query)}`);
            const htmlContent = response.data;
            var ReactXmlParser = require('react-xml-parser');
            const htmlDocument = new ReactXmlParser().parseFromString(htmlContent);

            // Extract data from the first table (header of Hanja)
            const firstTableRows = htmlDocument.getElementsByTagName('table')[0].getElementsByTagName('tr');
            const firstTableData = firstTableRows.map(row => {
                const parsedMeaning = parseHeaderMeaning(row.getElementsByTagName('td')[1].value);
                return {
                    hanja: row.getElementsByTagName('td')[0].getElementsByTagName('a')[0].value,
                    reading: parsedMeaning.reading,
                    meaning: parsedMeaning.meaning,
                };
            });
            console.log(`[hanjaRelated] "${query}" header table (${firstTableData.length} row(s)):`, firstTableData);
            setFirstTableData(firstTableData);

            // Extract data from the similar words table (related words of Hanja)
            const similarWordsTableRows = htmlDocument.getElementsByTagName('table')[1].getElementsByTagName('tr');
            const similarWordsTableData = similarWordsTableRows.map(row => ({
                hanja: row.getElementsByTagName('td')[0].getElementsByTagName('a')[0].value,
                korean: row.getElementsByTagName('td')[1].value.trim(),
                meaning: cleanMeaning(row.getElementsByTagName('td')[2].value.trim()),
            }));
            console.log(`[hanjaRelated] "${query}" similar words (${similarWordsTableData.length} row(s)):`, similarWordsTableData);

            setSimilarWordsTableData(similarWordsTableData);
        } catch(error) {
            console.error(`[hanjaRelated] Error fetching data for "${query}":`, error);
        }
    }

    useEffect(() => {
        fetchData();
    }, [query]);

    return { firstTableData, similarWordsTableData };
}

export default hanjaRelated
