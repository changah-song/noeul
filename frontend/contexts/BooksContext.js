import React, { createContext, useContext } from 'react';

const BooksContext = createContext({
  books: [],
  setBooks: () => {},
  currentBook: null,
  setCurrentBook: () => {},
  user: null,
  signOut: () => {},
  updateUsername: () => {},
  updateProfile: () => {},
  updateBookPreprocessed: () => {},
  preprocessOnOpen: false,
  setPreprocessOnOpen: () => {},
});

export const BooksProvider = ({
  books,
  setBooks,
  currentBook,
  setCurrentBook,
  user,
  signOut,
  updateUsername,
  updateProfile,
  updateBookPreprocessed,
  preprocessOnOpen,
  setPreprocessOnOpen,
  children,
}) => (
  <BooksContext.Provider value={{
    books,
    setBooks,
    currentBook,
    setCurrentBook,
    user,
    signOut,
    updateUsername,
    updateProfile,
    updateBookPreprocessed,
    preprocessOnOpen,
    setPreprocessOnOpen,
  }}>
    {children}
  </BooksContext.Provider>
);

export const useBooks = () => useContext(BooksContext);
