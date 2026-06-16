import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ZH_CHARACTER_DB_NAME = 'zh_characters.db';
const ZH_CHARACTER_DB_ASSET = require('../assets/data/zh_characters.db');
const ZH_CHARACTER_DB_MANIFEST = require('../assets/data/zh_characters_manifest.json');
const ZH_CHARACTER_DB_VERSION_KEY = '@ff/zh-character-db-version';

const SQLITE_DIR = `${FileSystem.documentDirectory}SQLite`;
const ZH_CHARACTER_DB_PATH = `${SQLITE_DIR}/${ZH_CHARACTER_DB_NAME}`;
const DEFAULT_RELATED_PHONETIC_LIMIT = 16;

let zhCharacterDb = null;
let initializationPromise = null;

const normalizeString = (value) => (value == null ? '' : String(value).trim());

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

const extractChineseCharacters = (value = '') => [...normalizeString(value)].filter(isCjk);

const getManifestVersion = () => (
  normalizeString(ZH_CHARACTER_DB_MANIFEST?.content_version) ||
  [
    normalizeString(ZH_CHARACTER_DB_MANIFEST?.generated_at),
    normalizeString(ZH_CHARACTER_DB_MANIFEST?.database_size_bytes),
  ].filter(Boolean).join(':') ||
  'unknown'
);

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
    FileSystem.getInfoAsync(ZH_CHARACTER_DB_PATH),
    AsyncStorage.getItem(ZH_CHARACTER_DB_VERSION_KEY),
  ]);

  if (dbInfo.exists && storedVersion === currentVersion) {
    return;
  }

  const asset = Asset.fromModule(ZH_CHARACTER_DB_ASSET);
  await asset.downloadAsync();

  const sourceUri = asset.localUri || asset.uri;
  if (!sourceUri) {
    throw new Error('Bundled Chinese character database asset has no readable URI');
  }

  if (dbInfo.exists) {
    await FileSystem.deleteAsync(ZH_CHARACTER_DB_PATH, { idempotent: true });
  }

  await FileSystem.copyAsync({
    from: sourceUri,
    to: ZH_CHARACTER_DB_PATH,
  });
  await AsyncStorage.setItem(ZH_CHARACTER_DB_VERSION_KEY, currentVersion);
};

const openChineseCharacterDatabase = () => {
  if (!zhCharacterDb) {
    zhCharacterDb = SQLite.openDatabase(ZH_CHARACTER_DB_NAME);
  }
  return zhCharacterDb;
};

export const initializeChineseCharacterDatabase = async () => {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    await copyBundledDatabaseIfNeeded();
    openChineseCharacterDatabase();
    return getChineseCharacterDatabaseStats();
  })().catch((error) => {
    zhCharacterDb = null;
    initializationPromise = null;
    console.error('[ChineseCharacterDatabase] initialization failed:', error);
    throw error;
  });

  return initializationPromise;
};

const ensureInitialized = async () => {
  if (zhCharacterDb) {
    return zhCharacterDb;
  }
  await initializeChineseCharacterDatabase();
  return zhCharacterDb;
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

const normalizeCharacterRow = (row = {}, fallbackCharacter = '') => ({
  character: row.character || fallbackCharacter,
  definition: row.definition || '',
  pinyin_json: row.pinyin_json || '[]',
  decomposition: row.decomposition || '',
  radical: row.radical || '',
  etymology_type: row.etymology_type || '',
  semantic: row.semantic || '',
  phonetic: row.phonetic || '',
  hint: row.hint || '',
  matches_json: row.matches_json || '[]',
  semantic_radical: row.semantic_radical || '',
  semantic_radical_number: row.semantic_radical_number || null,
  semantic_radical_english_name: row.semantic_radical_english_name || '',
  semantic_radical_korean_name: row.semantic_radical_korean_name || '',
  primary_radical: row.primary_radical || '',
  primary_radical_number: row.primary_radical_number || null,
  primary_radical_english_name: row.primary_radical_english_name || '',
  primary_radical_korean_name: row.primary_radical_korean_name || '',
  phonetic_pinyin_json: row.phonetic_pinyin_json || '[]',
  phonetic_definition: row.phonetic_definition || '',
  missingEtymology: false,
});

export const fetchChineseWordBreakdown = async (word) => {
  const characters = extractChineseCharacters(word);
  if (characters.length === 0) {
    return [];
  }

  const placeholders = characters.map(() => '?').join(',');
  const rows = await executeSql(
    `WITH radical_labels AS (
       SELECT
         rf.form,
         GROUP_CONCAT(DISTINCT kr.radical_number) AS radical_number,
         GROUP_CONCAT(DISTINCT kr.canonical_radical) AS canonical_radical,
         GROUP_CONCAT(DISTINCT kr.english_name) AS english_name,
         GROUP_CONCAT(DISTINCT kr.korean_name) AS korean_name
       FROM kangxi_radical_forms rf
       JOIN kangxi_radicals kr ON rf.radical_number = kr.radical_number
       GROUP BY rf.form
     )
     SELECT
       c.character,
       c.definition,
       c.pinyin_json,
       c.decomposition,
       c.radical,
       c.etymology_type,
       c.semantic,
       c.phonetic,
       c.hint,
       c.matches_json,
       sr.radical_number AS semantic_radical_number,
       sr.canonical_radical AS semantic_radical,
       sr.english_name AS semantic_radical_english_name,
       sr.korean_name AS semantic_radical_korean_name,
       pr.radical_number AS primary_radical_number,
       pr.canonical_radical AS primary_radical,
       pr.english_name AS primary_radical_english_name,
       pr.korean_name AS primary_radical_korean_name,
       pc.pinyin_json AS phonetic_pinyin_json,
       pc.definition AS phonetic_definition
     FROM zh_characters c
     LEFT JOIN radical_labels sr ON c.semantic = sr.form
     LEFT JOIN radical_labels pr ON c.radical = pr.form
     LEFT JOIN zh_characters pc ON c.phonetic = pc.character
     WHERE c.character IN (${placeholders})`,
    characters
  );

  return characters.map((character) => {
    const row = rows.find(item => item.character === character);
    return row
      ? normalizeCharacterRow(row, character)
      : { character, missingEtymology: true };
  });
};

export const fetchRelatedPhoneticChinese = async (phoneticComponent, options = {}) => {
  const normalizedPhonetic = normalizeString(phoneticComponent);
  if (!normalizedPhonetic) {
    return [];
  }

  const parsedLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 50)
    : DEFAULT_RELATED_PHONETIC_LIMIT;

  return executeSql(
    `SELECT character, definition, pinyin_json, decomposition, semantic, radical
     FROM zh_characters
     WHERE phonetic = ?
     ORDER BY character ASC
     LIMIT ?`,
    [normalizedPhonetic, limit]
  );
};

export const getChineseCharacterDatabaseStats = async () => {
  const [characters, radicals, forms] = await Promise.all([
    executeSql('SELECT COUNT(*) AS count FROM zh_characters'),
    executeSql('SELECT COUNT(*) AS count FROM kangxi_radicals'),
    executeSql('SELECT COUNT(*) AS count FROM kangxi_radical_forms'),
  ]);

  return {
    characters: characters[0]?.count || 0,
    kangxiRadicals: radicals[0]?.count || 0,
    kangxiRadicalForms: forms[0]?.count || 0,
  };
};
