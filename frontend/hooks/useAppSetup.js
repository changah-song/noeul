import { useState, useEffect } from 'react';
import { createTable, deleteAllDataFromTable, getTableSchema, insertData, viewData } from '../services/Database';

const useAppSetup = () => {
    const [books, setBooks] = useState([]);
    const [currentBook, setCurrentBook] = useState(null);

    useEffect(() => {
        createTable()
            .then(() => deleteAllDataFromTable())
            .then(() => createTable())
            .then(() => getTableSchema())
            .then(() => insertData())
            .then(() => viewData())
            .then(() => {
                console.log('All functions completed.');
            })
            .catch((error) => {
                console.log('Error:', error);
            });
    }, []);

    return { books, setBooks, currentBook, setCurrentBook };
};

export default useAppSetup;