import { useState, useEffect } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { normalizeBookLanguage, normalizeInterfaceLanguageCode } from '../../constants/languages';
import { api } from './client';

const koreanDictionary = ({ query, language = 'ko', script = 'zh-Hans' }) => {
    const { interfaceLanguage } = useAppContext();
    const normalizedInterfaceLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);
    const targetLanguage = normalizeBookLanguage(language);
    const [dictionaryData, setDictionaryData] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchData = async () => {
        setIsLoading(true);
        setError(null);

        try {
            if (targetLanguage === 'en') {
                const results = await Promise.all(
                    query.map(async (stem) => {
                        const response = await api.get('/en_dict_search/', {
                            params: { stem, interface_language: normalizedInterfaceLanguage },
                            timeout: 10000,
                        });
                        const result = response.data?.result;
                        return result ? [result] : [];
                    })
                );
                setDictionaryData(results);
            } else if (targetLanguage === 'zh') {
                const results = await Promise.all(
                    query.map(async (stem) => {
                        const response = await api.get('/zh_dict_search/', {
                            params: { stem, interface_language: normalizedInterfaceLanguage, script },
                            timeout: 10000,
                        });
                        const resultList = response.data?.results;
                        if (Array.isArray(resultList)) {
                            return resultList;
                        }
                        const result = response.data?.result;
                        return result ? [result] : [];
                    })
                );
                setDictionaryData(results);
            } else {
                const response = await api.post('/krdict_search/', {
                    queries: query,
                    language: normalizedInterfaceLanguage,
                });
                const results = response.data?.results ?? [];
                setDictionaryData(results);
            }
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
    }, [JSON.stringify(query), normalizedInterfaceLanguage, script, targetLanguage]);

    return { dictionaryData, isLoading, error };
};

export default koreanDictionary;
