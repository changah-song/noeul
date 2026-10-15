import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Startup must never replace the saved library with the empty startup state
// when the library could not be read (table init failure or corrupt JSON).

jest.mock('../Database', () => ({ initAllTables: jest.fn(() => Promise.resolve()) }));
jest.mock('../bookCloudSync', () => ({
  cloudBookToLocalBook: jest.fn((b) => b),
  fetchUserBooks: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../epubMetadata', () => ({
  persistCoverDataUri: jest.fn((v) => Promise.resolve(v)),
  stripInlineCoverForStorage: (book) => book,
}));
jest.mock('../preferencesCloudSync', () => ({
  fetchUserPreferences: jest.fn(() => Promise.resolve(null)),
  getTimestampMs: () => 0,
  updateUserPreferenceFields: jest.fn(() => Promise.resolve()),
}));
jest.mock('../publicDomainBooks', () => ({
  getPublicDomainBookByUri: () => null,
  isPublicDomainBookUri: () => false,
}));

const { initAllTables } = require('../Database');
const { makeScopedStorageKey } = require('../localDataScope');
const { default: useAppSetup, parseStoredBookList } = require('../../hooks/useAppSetup');

const OWNER = 'owner-1';
const booksKey = makeScopedStorageKey(OWNER, 'books');
const currentKey = makeScopedStorageKey(OWNER, 'current-book');

const flush = async () => {
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const mountHook = async () => {
  const result = {};
  const Probe = () => {
    Object.assign(result, useAppSetup({ ownerId: OWNER, ownerReady: true }));
    return null;
  };
  await act(async () => { renderer.create(<Probe />); });
  await flush();
  return result;
};

describe('parseStoredBookList', () => {
  it('returns an empty list for missing values', () => {
    expect(parseStoredBookList(null)).toEqual({ books: [], corrupt: false });
  });
  it('parses a stored array', () => {
    expect(parseStoredBookList('[{"uri":"a"}]')).toEqual({ books: [{ uri: 'a' }], corrupt: false });
  });
  it('flags unreadable or non-array values as corrupt', () => {
    expect(parseStoredBookList('{oops').corrupt).toBe(true);
    expect(parseStoredBookList('{"uri":"a"}').corrupt).toBe(true);
  });
});

describe('useAppSetup bootstrap', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    initAllTables.mockReset();
    initAllTables.mockImplementation(() => Promise.resolve());
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => console.error.mockRestore());

  it('loads the saved library normally', async () => {
    await AsyncStorage.setItem(booksKey, JSON.stringify([{ uri: 'file://a.epub', title: 'A' }]));
    await AsyncStorage.setItem(currentKey, 'file://a.epub');
    const result = await mountHook();
    expect(result.loading).toBe(false);
    expect(result.books.map((b) => b.uri)).toEqual(['file://a.epub']);
    expect(result.currentBook).toBe('file://a.epub');
  });

  it('keeps the saved library when table setup fails', async () => {
    const saved = JSON.stringify([{ uri: 'file://a.epub', title: 'A' }]);
    await AsyncStorage.setItem(booksKey, saved);
    await AsyncStorage.setItem(currentKey, 'file://a.epub');
    initAllTables.mockImplementation(() => Promise.reject(new Error('db down')));
    const result = await mountHook();
    expect(result.loading).toBe(false);
    expect(await AsyncStorage.getItem(booksKey)).toBe(saved);
    expect(await AsyncStorage.getItem(currentKey)).toBe('file://a.epub');
  });

  it('does not overwrite a corrupt stored library', async () => {
    await AsyncStorage.setItem(booksKey, '[{"uri":');
    const result = await mountHook();
    expect(result.loading).toBe(false);
    expect(result.books).toEqual([]);
    expect(await AsyncStorage.getItem(booksKey)).toBe('[{"uri":');
  });
});
