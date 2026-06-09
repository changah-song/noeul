import { useState, useEffect } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { normalizeInterfaceLanguageCode } from '../../constants/languages';
import { api } from './client';

const koreanDictionary = ({ query }) => {
    const { interfaceLanguage } = useAppContext();
    const normalizedInterfaceLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);
    const [dictionaryData, setDictionaryData] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchData = async () => {
        setIsLoading(true);

        try {
            const response = await api.post('/krdict_search/', {
                queries: query,
                language: normalizedInterfaceLanguage,
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
    }, [JSON.stringify(query), normalizedInterfaceLanguage]);

    return { dictionaryData, isLoading, error };
};

export default koreanDictionary;
