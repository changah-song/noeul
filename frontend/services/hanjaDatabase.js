import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeInterfaceLanguageCode } from '../constants/languages';

const HANJA_DB_NAME = 'hanja.db';
const HANJA_DB_ASSET = require('../assets/data/hanja.db');
const HANJA_DB_MANIFEST = require('../assets/data/hanja_manifest.json');
const HANJA_DB_VERSION_KEY = '@ff/hanja-db-version';

const SQLITE_DIR = `${FileSystem.documentDirectory}SQLite`;
const HANJA_DB_PATH = `${SQLITE_DIR}/${HANJA_DB_NAME}`;
const DEFAULT_RELATED_WORD_LIMIT = 8;
const MULTILINGUAL_HANJA_LANGUAGES = new Set(['fr', 'es', 'zh', 'ar', 'mn', 'vi', 'th', 'id', 'ru']);

let hanjaDb = null;
let initializationPromise = null;

const normalizeString = (value) => (value == null ? '' : String(value).trim());

const getHanjaDisplayLanguage = (interfaceLanguage = 'en') => {
  const language = normalizeInterfaceLanguageCode(interfaceLanguage);
  return MULTILINGUAL_HANJA_LANGUAGES.has(language) ? language : 'en';
};

const getHunColumn = (interfaceLanguage = 'en') => {
  const language = getHanjaDisplayLanguage(interfaceLanguage);
  return language === 'en' ? 'hun_english' : `hun_${language}`;
};

const getDefinitionColumn = (interfaceLanguage = 'en') => {
  const language = getHanjaDisplayLanguage(interfaceLanguage);
  return language === 'en' ? 'definition_english' : `definition_${language}`;
};

const getDisplayExpression = (column, englishColumn, alias, interfaceLanguage = 'en') => (
  getHanjaDisplayLanguage(interfaceLanguage) === 'en'
    ? `${englishColumn} AS ${alias}`
    : `NULLIF(${column}, '') AS ${alias}`
);

const normalizeLimit = (limit) => {
  if (limit === 'all' || limit === null) {
    return null;
  }

  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RELATED_WORD_LIMIT;
  }
  return Math.min(parsed, 50);
};

const getManifestVersion = () => {
  const generatedAt = normalizeString(HANJA_DB_MANIFEST?.generated_at);
  const fileSize = normalizeString(HANJA_DB_MANIFEST?.db_file_size_bytes);
  return [generatedAt, fileSize].filter(Boolean).join(':') || 'unknown';
};

const isCjk = (char) => {
  const codePoint = char.codePointAt(0);
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4DBF) ||
    (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||
    (codePoint >= 0xF900 && codePoint <= 0xFAFF) ||
    (codePoint >= 0x20000 && codePoint <= 0x2A6DF) ||
    (codePoint >= 0x2A700 && codePoint <= 0x2B73F) ||
    (codePoint >= 0x2B740 && codePoint <= 0x2B81F) ||
    (codePoint >= 0x2B820 && codePoint <= 0x2CEAF) ||
    (codePoint >= 0x2CEB0 && codePoint <= 0x2EBEF) ||
    (codePoint >= 0x30000 && codePoint <= 0x3134F)
  );
};

const isHangulSyllable = (char) => {
  const codePoint = char.codePointAt(0);
  return codePoint >= 0xAC00 && codePoint <= 0xD7A3;
};

const extractHanjaChars = (value = '') => [...normalizeString(value)].filter(isCjk);

const extractHangulSyllables = (value = '') => (
  [...normalizeString(value)].filter(isHangulSyllable)
);

const inferEum = (hangul, charIndex) => {
  const syllables = extractHangulSyllables(hangul);
  return syllables[charIndex] || '';
};

const normalizeWordRow = (row = {}) => ({
  hangul: row.hangul || '',
  hanja: row.hanja || '',
  definition_korean: row.definition_korean || '',
  definition_english: row.definition_english || '',
  definition_display: row.definition_display || '',
  pos: row.pos || '',
  word_grade: row.word_grade || '',
});

const ensureSqliteDirectory = async () => {
  if (!FileSystem.documentDirectory) {
    throw new Error('FileSystem.documentDirectory is unavailable');
  }

  const directoryInfo = await FileSystem.getInfoAsync(SQLITE_DIR);
  if (!directoryInfo.exists) {
    await FileSystem.makeDirectoryAsync(SQLITE_DIR, { intermediates: true });
  }
};

const copyBundledDatabaseIfNeeded = async () => {
  await ensureSqliteDirectory();

  const currentVersion = getManifestVersion();
  const [dbInfo, storedVersion] = await Promise.all([
    FileSystem.getInfoAsync(HANJA_DB_PATH),
    AsyncStorage.getItem(HANJA_DB_VERSION_KEY),
  ]);

  if (dbInfo.exists && storedVersion === currentVersion) {
    return;
  }

  const asset = Asset.fromModule(HANJA_DB_ASSET);
  await asset.downloadAsync();

  const sourceUri = asset.localUri || asset.uri;
  if (!sourceUri) {
    throw new Error('Bundled Hanja database asset has no readable URI');
  }

  if (dbInfo.exists) {
    await FileSystem.deleteAsync(HANJA_DB_PATH, { idempotent: true });
  }

  await FileSystem.copyAsync({
    from: sourceUri,
    to: HANJA_DB_PATH,
  });
  await AsyncStorage.setItem(HANJA_DB_VERSION_KEY, currentVersion);
};

const openHanjaDatabase = () => {
  if (!hanjaDb) {
    hanjaDb = SQLite.openDatabase(HANJA_DB_NAME);
  }
  return hanjaDb;
};

const ensureInitialized = async () => {
  if (hanjaDb) {
    return hanjaDb;
  }
  await initializeHanjaDatabase();
  return hanjaDb;
};

const executeSql = async (sql, params = []) => {
  const db = await ensureInitialized();

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        sql,
        params,
        (_, result) => resolve(result.rows?._array || []),
        (_, error) => {
          reject(error);
          return false;
        }
      );
    });
  });
};

export const getRelatedHanjaWords = async (character, options = {}) => {
  const normalizedCharacter = normalizeString(character);
  if (!normalizedCharacter) {
    return [];
  }

  const definitionColumn = getDefinitionColumn(options.interfaceLanguage);
  const excludeHangul = normalizeString(options.excludeHangul);
  const limit = normalizeLimit(options.limit);
  const limitClause = limit == null ? '' : 'LIMIT ?';
  const params = limit == null
    ? [normalizedCharacter, excludeHangul]
    : [normalizedCharacter, excludeHangul, limit];

  const rows = await executeSql(
    `SELECT DISTINCT
       hw.hangul,
       hw.hanja,
       hw.definition_korean,
       hw.definition_english,
       ${getDisplayExpression(`hw.${definitionColumn}`, 'hw.definition_english', 'definition_display', options.interfaceLanguage)},
       hw.pos,
       hw.word_grade
     FROM hanja_word_characters hwc
     JOIN hanja_words hw ON hw.id = hwc.word_id
     WHERE hwc.character = ?
       AND hw.hangul != ?
     ORDER BY
      CASE hw.word_grade
        WHEN '초급' THEN 0
        WHEN '중급' THEN 1
        WHEN '고급' THEN 2
        ELSE 3
      END ASC,
      hw.hangul ASC
     ${limitClause}`,
    params
  );

  return rows.map(normalizeWordRow);
};

export const lookupHanjaCharacter = async (character, options = {}) => {
  const normalizedCharacter = normalizeString(character);
  if (!normalizedCharacter) {
    return [];
  }

  const hunColumn = getHunColumn(options.interfaceLanguage);
  const preferredEum = normalizeString(options.eum);
  const rows = await executeSql(
    `SELECT character, eum, hun_korean, hun_english,
            ${getDisplayExpression(hunColumn, 'hun_english', 'hun_display', options.interfaceLanguage)}
     FROM hanja_characters
     WHERE character = ?
     ORDER BY
       CASE WHEN eum = ? THEN 0 ELSE 1 END,
       eum ASC,
       hun_korean ASC`,
    [normalizedCharacter, preferredEum]
  );

  return Promise.all(
    rows.map(async (row) => ({
      char: row.character || normalizedCharacter,
      eum: row.eum || '',
      hun_korean: row.hun_korean || '',
      hun_english: row.hun_english || '',
      hun_display: row.hun_display || '',
      related_words: await getRelatedHanjaWords(normalizedCharacter, options),
    }))
  );
};

export const lookupHanjaWord = async (hangul, options = {}) => {
  const normalizedHangul = normalizeString(hangul);
  if (!normalizedHangul) {
    return null;
  }

  const definitionColumn = getDefinitionColumn(options.interfaceLanguage);
  const hunColumn = getHunColumn(options.interfaceLanguage);
  const rows = await executeSql(
    `SELECT id, hangul, hanja, definition_korean, definition_english,
            ${getDisplayExpression(definitionColumn, 'definition_english', 'definition_display', options.interfaceLanguage)},
            pos, word_grade
     FROM hanja_words
     WHERE hangul = ?
     ORDER BY hanja ASC, id ASC
     LIMIT 1`,
    [normalizedHangul]
  );

  const word = rows[0];
  if (!word) {
    return null;
  }

  const hanjaChars = extractHanjaChars(word.hanja);
  const characters = await Promise.all(
    hanjaChars.map(async (char, index) => {
      const eum = inferEum(word.hangul, index);
      const [characterInfo] = await executeSql(
        `SELECT character, eum, hun_korean, hun_english,
                ${getDisplayExpression(hunColumn, 'hun_english', 'hun_display', options.interfaceLanguage)}
         FROM hanja_characters
         WHERE character = ?
           AND eum = ?
         LIMIT 1`,
        [char, eum]
      );

      return {
        char,
        eum: characterInfo?.eum || eum,
        hun_korean: characterInfo?.hun_korean || '',
        hun_english: characterInfo?.hun_english || '',
        hun_display: characterInfo?.hun_display || '',
        related_words: await getRelatedHanjaWords(char, {
          excludeHangul: word.hangul,
          interfaceLanguage: options.interfaceLanguage,
        }),
      };
    })
  );

  return {
    hangul: word.hangul || normalizedHangul,
    hanja: word.hanja || '',
    definition_korean: word.definition_korean || '',
    definition_english: word.definition_english || '',
    definition_display: word.definition_display || '',
    pos: word.pos || '',
    word_grade: word.word_grade || '',
    characters,
  };
};

export const getHanjaDatabaseStats = async () => {
  const [characters, words, wordCharacters] = await Promise.all([
    executeSql('SELECT COUNT(*) AS count FROM hanja_characters'),
    executeSql('SELECT COUNT(*) AS count FROM hanja_words'),
    executeSql('SELECT COUNT(*) AS count FROM hanja_word_characters'),
  ]);

  return {
    characters: characters[0]?.count || 0,
    words: words[0]?.count || 0,
    wordCharacters: wordCharacters[0]?.count || 0,
  };
};

export const initializeHanjaDatabase = async () => {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    await copyBundledDatabaseIfNeeded();
    openHanjaDatabase();
    return getHanjaDatabaseStats();
  })().catch((error) => {
    hanjaDb = null;
    initializationPromise = null;
    console.error('[HanjaDatabase] initialization failed:', error);
    throw error;
  });

  return initializationPromise;
};
