import { useState, useEffect } from 'react';
import axios from 'axios';
import { BASE_URL } from '../../config';

const koreanDictionary = ({ query }) => {
    const [dictionaryData, setDictionaryData] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchData = async () => {
        setIsLoading(true);

        try {
            const response = await axios.post(`${BASE_URL}/krdict_search/`, {
                queries: query,
            });
            const results = response.data?.results ?? [];
            setDictionaryData(results);
        } catch (fetchError) {
            setError(fetchError.message);
            setDictionaryData([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (query && query.length > 0) {
            fetchData();
        } else {
            setDictionaryData([]);
        }
    }, [JSON.stringify(query)]);

    return { dictionaryData, isLoading, error };
};

export default koreanDictionary;
