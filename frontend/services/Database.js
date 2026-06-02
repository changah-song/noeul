import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeHanjaDatabase } from './hanjaDatabase';
import {
  getHighlightTone,
  getMaturityForVocab,
  getMaturityMeta,
  isDueForReview,
  isLongTailWord,
  normalizeVocabLearningFields,
  shouldRecordImplicitReview,
} from './vocabLearning';

// ─── Database Setup ───────────────────────────────────────────────────────────
// NOTE: Change the db filename here if you ever need to reset all tables by
// wiping the old database (e.g., rename to 'app_v2.db' to start fresh).
const db = SQLite.openDatabase('temp.db');
const BOOK_INDEX_MIGRATION_KEY = 'book_index_migration_v2';
const DICTIONARY_CACHE_MIGRATION_KEY = 'dictionary_cache_migration_v1';

const formatLocalDay = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};


// ─── Table Creation ───────────────────────────────────────────────────────────

/**
 * createTable
 * Creates the `vocab` table if it doesn't exist.
 * This stores words the user has explicitly saved (their personal word list).
 */
export const createTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS vocab (
          id    INTEGER PRIMARY KEY AUTOINCREMENT,
          word  TEXT,
          hanja TEXT,
          def   TEXT,
          level TEXT,
          context_sentence TEXT,
          related_known_words TEXT DEFAULT '[]'
        )`,
        [],
        () => {
          console.log("[Database] vocab table created/confirmed");
          resolve();
        },
        (_, error) => {
          console.error("[Database] Error creating vocab table:", error);
          reject(error);
        }
      );
    });
  });
};

const getTableColumns = (tableName) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `PRAGMA table_info(${tableName})`,
        [],
        (_, result) => resolve(result.rows._array.map((row) => row.name)),
        (_, error) => {
          console.error(`[Database] Error reading schema for ${tableName}:`, error);
          reject(error);
        }
      );
    });
  });
};

export const migrateVocabTable = async () => {
  const columns = await getTableColumns('vocab');
  const alterations = [];

  if (!columns.includes('source_book_uri')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN source_book_uri TEXT');
  }

  if (!columns.includes('source_book_title')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN source_book_title TEXT');
  }

  if (!columns.includes('context_sentence')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN context_sentence TEXT');
  }

  if (!columns.includes('related_known_words')) {
    alterations.push(`ALTER TABLE vocab ADD COLUMN related_known_words TEXT DEFAULT '[]'`);
  }

  if (!columns.includes('is_favorite')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN is_favorite INTEGER DEFAULT 0');
  }

  if (!columns.includes('priority')) {
    alterations.push(`ALTER TABLE vocab ADD COLUMN priority TEXT DEFAULT 'normal'`);
  }

  if (!columns.includes('created_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN created_at TEXT');
  }

  if (!columns.includes('last_reviewed_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN last_reviewed_at TEXT');
  }

  if (!columns.includes('next_review_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN next_review_at TEXT');
  }

  if (!columns.includes('correct_count')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN correct_count INTEGER DEFAULT 0');
  }

  if (!columns.includes('wrong_count')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN wrong_count INTEGER DEFAULT 0');
  }

  if (!columns.includes('encounter_count')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN encounter_count INTEGER DEFAULT 0');
  }

  if (!columns.includes('last_encountered_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN last_encountered_at TEXT');
  }

  if (!columns.includes('last_encounter_source_uri')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN last_encounter_source_uri TEXT');
  }

  if (!columns.includes('last_encounter_source_title')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN last_encounter_source_title TEXT');
  }

  if (!columns.includes('maturity')) {
    alterations.push(`ALTER TABLE vocab ADD COLUMN maturity TEXT DEFAULT 'new'`);
  }

  if (!columns.includes('graduated_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN graduated_at TEXT');
  }

  if (!columns.includes('implicit_review_count')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN implicit_review_count INTEGER DEFAULT 0');
  }

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        alterations.forEach((statement) => tx.executeSql(statement));
        tx.executeSql(`UPDATE vocab SET priority = 'normal' WHERE priority IS NULL`);
        tx.executeSql(`UPDATE vocab SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL`);
        tx.executeSql(`UPDATE vocab SET correct_count = 0 WHERE correct_count IS NULL`);
        tx.executeSql(`UPDATE vocab SET wrong_count = 0 WHERE wrong_count IS NULL`);
        tx.executeSql(`UPDATE vocab SET related_known_words = '[]' WHERE related_known_words IS NULL`);
        tx.executeSql(`UPDATE vocab SET encounter_count = 0 WHERE encounter_count IS NULL`);
        tx.executeSql(`UPDATE vocab SET maturity = 'new' WHERE maturity IS NULL`);
        tx.executeSql(`UPDATE vocab SET implicit_review_count = 0 WHERE implicit_review_count IS NULL`);
      },
      (error) => {
        console.error('[Database] Error migrating vocab table:', error);
        reject(error);
      },
      () => {
        if (alterations.length === 0) {
          console.log('[Database] vocab migration already complete');
        } else {
          console.log(`[Database] vocab migration complete (${alterations.length} column(s) added)`);
        }
        resolve();
      }
    );
  });
};

export const createVocabEncountersTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS vocab_encounters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vocab_id INTEGER NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'unknown',
          source_uri TEXT NOT NULL DEFAULT '',
          source_title TEXT,
          location_key TEXT NOT NULL DEFAULT '',
          encounter_day TEXT NOT NULL,
          encountered_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(vocab_id, source_uri, location_key, encounter_day)
        )`,
        [],
        () => {
          console.log('[Database] vocab_encounters table created/confirmed');
          resolve();
        },
        (_, error) => {
          console.error('[Database] Error creating vocab_encounters table:', error);
          reject(error);
        }
      );
    });
  });
};

export const migrateVocabEncountersTable = async () => {
  await createVocabEncountersTable();

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_encounters_vocab_id
           ON vocab_encounters(vocab_id)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_encounters_day
           ON vocab_encounters(encounter_day)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_encounters_source
           ON vocab_encounters(source_uri)`
        );
      },
      (error) => {
        console.error('[Database] Error migrating vocab_encounters table:', error);
        reject(error);
      },
      () => {
        console.log('[Database] vocab_encounters migration complete');
        resolve();
      }
    );
  });
};

/**
 * createDictionaryCacheTable
 * Creates the `dictionary_cache` table if it doesn't exist.
 *
 * This is the "Local Cache" — every stem that has been looked up via KRDICT
 * (either during book preprocessing or from a live single-word fetch) gets stored
 * here so we never hit the API for the same word twice.
 *
 * Schema:
 *   stem        — Korean dictionary base form (e.g. "달리다", "사랑")
 *   definition  — primary English definition from KRDICT
 *   hanja       — Hanja characters (e.g. "愛情"), or "N/A"
 *   pos         — part of speech (Noun, Verb, Adjective, Adverb)
 *   domain      — subject domain from KRDICT (e.g. "Law", "Science") — optional
 *   last_updated — auto-set on insert; helps purge stale data in the future
 */
export const createDictionaryCacheTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS dictionary_cache (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          stem         TEXT UNIQUE NOT NULL,
          definition   TEXT,
          hanja        TEXT,
          pos          TEXT,
          domain       TEXT,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        [],
        () => {
          console.log("[Database] dictionary_cache table created/confirmed");
          resolve();
        },
        (_, error) => {
          console.error("[Database] Error creating dictionary_cache table:", error);
          reject(error);
        }
      );
    });
  });
};

export const migrateDictionaryCache = async () => {
  const migrationState = await AsyncStorage.getItem(DICTIONARY_CACHE_MIGRATION_KEY);
  if (migrationState === 'done') {
    console.log('[Database] dictionary_cache migration already complete');
    return;
  }

  await new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql('DROP TABLE IF EXISTS dictionary_cache_new');
      tx.executeSql(
        `CREATE TABLE dictionary_cache_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          stem         TEXT UNIQUE NOT NULL,
          definition   TEXT,
          hanja        TEXT,
          pos          TEXT,
          domain       TEXT,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        [],
        () => {},
        (_, error) => {
          console.error('[Database] Error creating dictionary_cache_new:', error);
          reject(error);
          return false;
        }
      );

      tx.executeSql(
        `INSERT OR IGNORE INTO dictionary_cache_new (stem, definition, hanja, pos, domain, last_updated)
         SELECT stem, definition, hanja, pos, domain, last_updated
         FROM dictionary_cache
         WHERE stem IS NOT NULL AND TRIM(stem) != ''
         ORDER BY id ASC`,
        [],
        () => {},
        (_, error) => {
          const isMissingTable = typeof error?.message === 'string' && error.message.includes('no such table');
          if (isMissingTable) {
            return true;
          }
          console.error('[Database] Error copying dictionary_cache rows:', error);
          reject(error);
          return false;
        }
      );

      tx.executeSql('DROP TABLE IF EXISTS dictionary_cache');
      tx.executeSql('ALTER TABLE dictionary_cache_new RENAME TO dictionary_cache');
      tx.executeSql(
        'CREATE INDEX IF NOT EXISTS idx_dictionary_cache_stem ON dictionary_cache(stem)',
        [],
        () => {
          console.log('[Database] dictionary_cache migration complete');
          resolve();
        },
        (_, error) => {
          console.error('[Database] Error finalizing dictionary_cache migration:', error);
          reject(error);
          return false;
        }
      );
    });
  });

  await AsyncStorage.setItem(DICTIONARY_CACHE_MIGRATION_KEY, 'done');
};

/**
 * createBookIndexTable
 * Creates the `book_index` table if it doesn't exist.
 *
 * After a book is preprocessed, we store a lightweight index mapping every
 * raw surface word (as it appears in text) to the stem_id in dictionary_cache.
 * This lets us jump straight to the cached definition without re-stemming.
 *
 * Schema:
 *   book_uri — file URI of the book (identifies which book this row belongs to)
 *   surface  — the word as it appears in text (e.g. "달렸다")
 *   stem_id  — FK → dictionary_cache.id for the base form (e.g. row for "달리다")
 */
export const createBookIndexTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS book_index (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          book_uri TEXT NOT NULL,
          surface  TEXT NOT NULL,
          stem_id  INTEGER NOT NULL,
          UNIQUE(book_uri, surface, stem_id)
        )`,
        [],
        () => {
          console.log("[Database] book_index table created/confirmed");
          resolve();
        },
        (_, error) => {
          console.error("[Database] Error creating book_index table:", error);
          reject(error);
        }
      );
    });
  });
};

export const migrateBookIndex = async () => {
  const migrationState = await AsyncStorage.getItem(BOOK_INDEX_MIGRATION_KEY);
  if (migrationState === 'done') {
    console.log('[Database] book_index migration already complete');
    return;
  }

  await new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'DROP TABLE IF EXISTS book_index',
        [],
        () => {
          console.log('[Database] Dropped legacy book_index table');
          resolve();
        },
        (_, error) => {
          console.error('[Database] Error dropping legacy book_index table:', error);
          reject(error);
        }
      );
    });
  });

  await createBookIndexTable();
  await AsyncStorage.setItem(BOOK_INDEX_MIGRATION_KEY, 'done');
  console.log('[Database] book_index migration complete');
};

/**
 * initAllTables
 * Convenience function: creates all tables in the correct order.
 * Call this once at app startup (in App.js or useAppSetup.js).
 */
const deduplicateCacheTable = () => {
  return new Promise((resolve) => {
    db.transaction(tx => {
      // Keep only the lowest-id row per stem, deleting any extras
      tx.executeSql(
        `DELETE FROM dictionary_cache
         WHERE id NOT IN (
           SELECT MIN(id) FROM dictionary_cache GROUP BY stem
         )`,
        [],
        (_, result) => {
          if (result.rowsAffected > 0) {
            console.log(`[Database] Removed ${result.rowsAffected} duplicate cache row(s)`);
          }
          resolve();
        },
        (_, error) => {
          console.warn('[Database] deduplicateCacheTable failed (non-fatal):', error);
          resolve(); // non-fatal
        }
      );
    });
  });
};

export const initAllTables = async () => {
  console.log("[Database] Initializing all tables...");
  await createTable();
  await migrateVocabTable();
  await createVocabEncountersTable();
  await migrateVocabEncountersTable();
  await createDictionaryCacheTable();
  await migrateDictionaryCache();
  await migrateBookIndex();
  await createBookIndexTable();
  await deduplicateCacheTable();
  await initializeHanjaDatabase();
  console.log("[Database] All tables ready");
};


// ─── Vocab Table Operations ───────────────────────────────────────────────────

export const insertData = (word, hanja, definition, levelOrOptions) => {
  const options = typeof levelOrOptions === 'object' && levelOrOptions !== null
    ? levelOrOptions
    : { level: levelOrOptions };

  const {
    level = 'unorganized',
    sourceBookUri = null,
    sourceBookTitle = null,
    contextSentence = null,
    isFavorite = 0,
    priority = 'normal',
    createdAt = new Date().toISOString(),
    lastReviewedAt = null,
    nextReviewAt = null,
    correctCount = 0,
    wrongCount = 0,
    relatedKnownWords = [],
    encounterCount = 0,
    maturity = 'new',
    implicitReviewCount = 0,
    graduatedAt = null,
    lastEncounteredAt = null,
    lastEncounterSourceUri = null,
    lastEncounterSourceTitle = null,
  } = options;
  const relatedKnownWordsJson = JSON.stringify(Array.isArray(relatedKnownWords) ? relatedKnownWords : []);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `INSERT INTO vocab (
          word, hanja, def, level, source_book_uri, source_book_title, context_sentence, is_favorite,
          priority, created_at, last_reviewed_at, next_review_at, correct_count, wrong_count,
          related_known_words, encounter_count, last_encountered_at, last_encounter_source_uri,
          last_encounter_source_title, maturity, graduated_at, implicit_review_count
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          word,
          hanja,
          definition,
          level,
          sourceBookUri,
          sourceBookTitle,
          contextSentence,
          isFavorite ? 1 : 0,
          priority,
          createdAt,
          lastReviewedAt,
          nextReviewAt,
          correctCount,
          wrongCount,
          relatedKnownWordsJson,
          encounterCount,
          lastEncounteredAt,
          lastEncounterSourceUri,
          lastEncounterSourceTitle,
          maturity,
          graduatedAt,
          implicitReviewCount,
        ],
        () => {
          console.log(`[Database] Inserted vocab word: "${word}" | hanja: "${hanja}" | level: "${level}"`);
          resolve();
        },
        (_, error) => {
          console.error(`[Database] Error inserting vocab word "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const vocabEntryExists = (word, hanja, definition) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT COUNT(*) AS count FROM vocab WHERE word = ? AND hanja IS ? AND def IS ?',
        [word, hanja ?? null, definition ?? null],
        (_, result) => {
          const { count } = result.rows.item(0);
          resolve(count > 0);
        },
        (_, error) => {
          console.error(`[Database] Error checking vocab entry for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const insertDataIfMissing = async (word, hanja, definition, levelOrOptions) => {
  const exists = await vocabEntryExists(word, hanja, definition);
  if (exists) {
    console.log(`[Database] Skipping existing vocab entry "${word}"`);
    return false;
  }

  await insertData(word, hanja, definition, levelOrOptions);
  return true;
};

const VOCAB_LEARNING_UPDATE_COLUMNS = {
  level: 'level',
  source_book_uri: 'source_book_uri',
  source_book_title: 'source_book_title',
  context_sentence: 'context_sentence',
  is_favorite: 'is_favorite',
  priority: 'priority',
  created_at: 'created_at',
  last_reviewed_at: 'last_reviewed_at',
  next_review_at: 'next_review_at',
  correct_count: 'correct_count',
  wrong_count: 'wrong_count',
  encounter_count: 'encounter_count',
  last_encountered_at: 'last_encountered_at',
  last_encounter_source_uri: 'last_encounter_source_uri',
  last_encounter_source_title: 'last_encounter_source_title',
  maturity: 'maturity',
  graduated_at: 'graduated_at',
  implicit_review_count: 'implicit_review_count',
};

export const updateVocabLearningState = (word, hanja, definition, updates = {}) => {
  const entries = Object.entries(updates).filter(([key, value]) => (
    Object.prototype.hasOwnProperty.call(VOCAB_LEARNING_UPDATE_COLUMNS, key) &&
    value !== undefined
  ));

  if (entries.length === 0) {
    return Promise.resolve();
  }

  const assignments = entries.map(([key]) => `${VOCAB_LEARNING_UPDATE_COLUMNS[key]} = ?`).join(', ');
  const values = entries.map(([, value]) => value);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE vocab SET ${assignments} WHERE word = ? AND hanja IS ? AND def IS ?`,
        [...values, word, hanja ?? null, definition ?? null],
        (_, result) => {
          console.log(`[Database] Updated learning state for "${word}" (${result.rowsAffected} row(s))`);
          resolve(result);
        },
        (_, error) => {
          console.error(`[Database] Error updating learning state for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const clearVocabEncountersForEntry = (word, hanja, definition) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT id FROM vocab WHERE word = ? AND hanja IS ? AND def IS ?',
        [word, hanja ?? null, definition ?? null],
        (_, result) => {
          const ids = result.rows._array.map((row) => row.id);

          if (ids.length === 0) {
            resolve({ rowsAffected: 0 });
            return;
          }

          tx.executeSql(
            `DELETE FROM vocab_encounters WHERE vocab_id IN (${ids.map(() => '?').join(', ')})`,
            ids,
            (_, deleteResult) => {
              console.log(`[Database] Cleared ${deleteResult.rowsAffected} encounter row(s) for "${word}"`);
              resolve(deleteResult);
            },
            (_, error) => {
              console.error(`[Database] Error clearing encounters for "${word}":`, error);
              reject(error);
            }
          );
        },
        (_, error) => {
          console.error(`[Database] Error finding vocab ids for encounter reset "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

const parseRelatedKnownWords = (value) => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const relatedKnownWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;

export const getRelatedKnownWords = (word) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT related_known_words FROM vocab WHERE word = ? ORDER BY id ASC LIMIT 1',
        [word],
        (_, result) => {
          const row = result.rows.length > 0 ? result.rows.item(0) : null;
          resolve(parseRelatedKnownWords(row?.related_known_words));
        },
        (_, error) => {
          console.error(`[Database] Error reading related known words for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const addRelatedKnownWord = (word, relatedWord) => {
  const normalizedEntry = {
    korean: relatedWord?.korean ?? '',
    hanja: relatedWord?.hanja ?? '',
    meaning: relatedWord?.meaning ?? '',
    sourceHanja: relatedWord?.sourceHanja ?? '',
    markedAt: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT id, related_known_words FROM vocab WHERE word = ?',
        [word],
        (_, result) => {
          if (result.rows.length === 0) {
            console.log(`[Database] No vocab row found for related known word target "${word}"`);
            resolve([]);
            return;
          }

          const firstKnownWords = parseRelatedKnownWords(result.rows.item(0).related_known_words);
          const existingKeys = new Set(firstKnownWords.map(relatedKnownWordKey));
          const nextKnownWords = existingKeys.has(relatedKnownWordKey(normalizedEntry))
            ? firstKnownWords
            : [...firstKnownWords, normalizedEntry];
          const nextJson = JSON.stringify(nextKnownWords);

          for (let index = 0; index < result.rows.length; index += 1) {
            tx.executeSql(
              'UPDATE vocab SET related_known_words = ? WHERE id = ?',
              [nextJson, result.rows.item(index).id]
            );
          }

          console.log(`[Database] Added related known word "${normalizedEntry.korean}" for "${word}"`);
          resolve(nextKnownWords);
        },
        (_, error) => {
          console.error(`[Database] Error adding related known word for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const removeRelatedKnownWord = (word, relatedWord) => {
  const keyToRemove = relatedKnownWordKey(relatedWord);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT id, related_known_words FROM vocab WHERE word = ?',
        [word],
        (_, result) => {
          if (result.rows.length === 0) {
            console.log(`[Database] No vocab row found for related known word removal target "${word}"`);
            resolve([]);
            return;
          }

          const firstKnownWords = parseRelatedKnownWords(result.rows.item(0).related_known_words);
          const nextKnownWords = firstKnownWords.filter(
            (entry) => relatedKnownWordKey(entry) !== keyToRemove
          );
          const nextJson = JSON.stringify(nextKnownWords);

          for (let index = 0; index < result.rows.length; index += 1) {
            tx.executeSql(
              'UPDATE vocab SET related_known_words = ? WHERE id = ?',
              [nextJson, result.rows.item(index).id]
            );
          }

          console.log(`[Database] Removed related known word "${relatedWord?.korean ?? ''}" for "${word}"`);
          resolve(nextKnownWords);
        },
        (_, error) => {
          console.error(`[Database] Error removing related known word for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const updateLevel = (word, hanja, definition, newLevel) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'UPDATE vocab SET level = ? WHERE word = ? AND hanja IS ? AND def IS ?',
        [newLevel, word, hanja, definition],
        () => {
          console.log(`[Database] Updated level for "${word}" → "${newLevel}"`);
          resolve();
        },
        (_, error) => {
          console.error(`[Database] Error updating level for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const updateFavorite = (word, hanja, definition, isFavorite) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'UPDATE vocab SET is_favorite = ? WHERE word = ? AND hanja IS ? AND def IS ?',
        [isFavorite ? 1 : 0, word, hanja, definition],
        () => {
          console.log(`[Database] Updated favorite for "${word}" → ${isFavorite ? 1 : 0}`);
          resolve();
        },
        (_, error) => {
          console.error(`[Database] Error updating favorite for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const updatePriority = (word, hanja, definition, priority) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'UPDATE vocab SET priority = ? WHERE word = ? AND hanja IS ? AND def IS ?',
        [priority, word, hanja, definition],
        () => {
          console.log(`[Database] Updated priority for "${word}" → ${priority}`);
          resolve();
        },
        (_, error) => {
          console.error(`[Database] Error updating priority for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

const addDays = (days, fromDate = new Date()) => {
  const date = new Date(fromDate);
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

export const recordReviewOutcome = (word, hanja, definition, currentLevel, outcome) => {
  const reviewMap = {
    bad: {
      level: 'bad',
      nextReviewAt: addDays(1),
      correctInc: 0,
      wrongInc: 1,
    },
    mid: {
      level: 'mid',
      nextReviewAt: addDays(3),
      correctInc: 1,
      wrongInc: 0,
    },
    good: {
      level: 'good',
      nextReviewAt: currentLevel === 'good' ? addDays(21) : currentLevel === 'mid' ? addDays(7) : addDays(5),
      correctInc: 1,
      wrongInc: 0,
    },
  };

  const config = reviewMap[outcome];
  if (!config) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE vocab
         SET level = ?,
             last_reviewed_at = ?,
             next_review_at = ?,
             correct_count = COALESCE(correct_count, 0) + ?,
             wrong_count = COALESCE(wrong_count, 0) + ?
         WHERE word = ? AND hanja IS ? AND def IS ?`,
        [
          config.level,
          new Date().toISOString(),
          config.nextReviewAt,
          config.correctInc,
          config.wrongInc,
          word,
          hanja,
          definition,
        ],
        () => {
          console.log(`[Database] Recorded review outcome for "${word}" → ${outcome}`);
          resolve();
        },
        (_, error) => {
          console.error(`[Database] Error recording review outcome for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const removeData = (word, hanja, definition) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'DELETE FROM vocab WHERE word = ? AND hanja IS ? AND def IS ?',
        [word, hanja, definition],
        (_, result) => {
          console.log(`[Database] Removed vocab word "${word}" (hanja: "${hanja}")`);
          resolve(result);
        },
        (_, error) => {
          console.error(`[Database] Error removing vocab word "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const wordExists = (word) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT COUNT(*) AS count FROM vocab WHERE word = ?',
        [word],
        (_, result) => {
          const { count } = result.rows.item(0);
          console.log(`[Database] wordExists("${word}"): ${count > 0}`);
          resolve(count > 0);
        },
        (_, error) => {
          console.error(`[Database] Error checking vocab existence for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

const getVocabRowsByIds = (vocabIds) => {
  const uniqueIds = [...new Set(
    vocabIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];

  if (uniqueIds.length === 0) {
    return Promise.resolve([]);
  }

  const placeholders = uniqueIds.map(() => '?').join(',');

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT * FROM vocab WHERE id IN (${placeholders})`,
        uniqueIds,
        (_, result) => resolve(result.rows._array),
        (_, error) => {
          console.error('[Database] Error fetching vocab rows by id:', error);
          reject(error);
        }
      );
    });
  });
};

const getVocabRowById = async (vocabId) => {
  const rows = await getVocabRowsByIds([vocabId]);
  return rows[0] ?? null;
};

const updateMaturityForVocabIds = async (vocabIds) => {
  const rows = await getVocabRowsByIds(vocabIds);

  if (rows.length === 0) {
    return;
  }

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        rows.forEach((row) => {
          const maturity = getMaturityForVocab(row);

          if (maturity === 'graduated' && !row.graduated_at) {
            tx.executeSql(
              'UPDATE vocab SET maturity = ?, graduated_at = ? WHERE id = ?',
              [maturity, new Date().toISOString(), row.id]
            );
            return;
          }

          tx.executeSql(
            'UPDATE vocab SET maturity = ? WHERE id = ?',
            [maturity, row.id]
          );
        });
      },
      (error) => {
        console.error('[Database] Error updating vocab maturity:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const getSavedWords = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT DISTINCT word FROM vocab',
        [],
        (_, result) => {
          const words = result.rows._array.map(row => row.word).filter(Boolean);
          console.log(`[Database] getSavedWords: ${words.length} unique word(s):`, words);
          resolve(words);
        },
        (_, error) => {
          console.error('[Database] Error fetching saved words:', error);
          reject(error);
        }
      );
    });
  });
};

export const getSavedVocabForHighlights = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, word, hanja, def, level, encounter_count, implicit_review_count,
                correct_count, wrong_count, maturity, graduated_at, last_encountered_at,
                next_review_at, last_reviewed_at, is_favorite
         FROM vocab`,
        [],
        (_, result) => {
          const rows = result.rows._array.map((row) => {
            const normalized = normalizeVocabLearningFields(row);

            return {
              id: normalized.id,
              word: normalized.word,
              hanja: normalized.hanja,
              def: normalized.def,
              maturity: normalized.maturity,
              encounter_count: normalized.encounter_count,
              last_encountered_at: normalized.last_encountered_at,
              graduated_at: normalized.graduated_at,
              highlightTone: getHighlightTone(normalized),
            };
          });

          console.log(`[Database] getSavedVocabForHighlights: ${rows.length} row(s)`);
          resolve(rows);
        },
        (_, error) => {
          console.error('[Database] Error fetching saved vocab for highlights:', error);
          reject(error);
        }
      );
    });
  });
};

const normalizeEncounterInput = (encounter) => {
  const vocabId = Number(encounter?.vocabId);

  if (!Number.isInteger(vocabId) || vocabId <= 0) {
    return null;
  }

  const fallbackDate = new Date();
  const providedDate = encounter?.encounteredAt ? new Date(encounter.encounteredAt) : fallbackDate;
  const encounteredDate = Number.isNaN(providedDate.getTime()) ? fallbackDate : providedDate;
  const encounteredAt = encounteredDate.toISOString();

  return {
    vocabId,
    sourceType: encounter?.sourceType || 'unknown',
    sourceUri: encounter?.sourceUri ?? '',
    sourceTitle: encounter?.sourceTitle ?? null,
    locationKey: encounter?.locationKey ?? '',
    encounteredAt,
    encounterDay: formatLocalDay(encounteredDate),
  };
};

export const recordVocabEncounterBatch = async (encounters) => {
  const normalizedEncounters = Array.isArray(encounters)
    ? encounters.map(normalizeEncounterInput).filter(Boolean)
    : [];

  if (normalizedEncounters.length === 0) {
    return { insertedCount: 0, affectedVocabIds: [] };
  }

  const result = await new Promise((resolve, reject) => {
    const affectedVocabIds = new Set();
    let insertedCount = 0;

    db.transaction(
      tx => {
        normalizedEncounters.forEach((encounter) => {
          tx.executeSql(
            `INSERT OR IGNORE INTO vocab_encounters (
              vocab_id, source_type, source_uri, source_title, location_key, encounter_day, encountered_at
            )
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              encounter.vocabId,
              encounter.sourceType,
              encounter.sourceUri,
              encounter.sourceTitle,
              encounter.locationKey,
              encounter.encounterDay,
              encounter.encounteredAt,
            ],
            (_, insertResult) => {
              if (insertResult.rowsAffected <= 0) {
                return;
              }

              insertedCount += insertResult.rowsAffected;
              affectedVocabIds.add(encounter.vocabId);
              tx.executeSql(
                `UPDATE vocab
                 SET encounter_count = COALESCE(encounter_count, 0) + 1,
                     last_encountered_at = ?,
                     last_encounter_source_uri = ?,
                     last_encounter_source_title = ?
                 WHERE id = ?`,
                [
                  encounter.encounteredAt,
                  encounter.sourceUri,
                  encounter.sourceTitle,
                  encounter.vocabId,
                ]
              );
            }
          );
        });
      },
      (error) => {
        console.error('[Database] Error recording vocab encounter batch:', error);
        reject(error);
      },
      () => {
        resolve({
          insertedCount,
          affectedVocabIds: [...affectedVocabIds],
        });
      }
    );
  });

  if (result.affectedVocabIds.length > 0) {
    await updateMaturityForVocabIds(result.affectedVocabIds);
  }

  console.log(
    `[Database] recordVocabEncounterBatch: ${result.insertedCount} new encounter(s) across ${result.affectedVocabIds.length} vocab row(s)`
  );

  return result;
};

export const recordImplicitReadingReview = async (vocabId) => {
  const numericVocabId = Number(vocabId);

  if (!Number.isInteger(numericVocabId) || numericVocabId <= 0) {
    return { reviewed: false };
  }

  const row = await getVocabRowById(numericVocabId);

  if (!row) {
    return { reviewed: false };
  }

  const now = new Date();
  const normalized = normalizeVocabLearningFields(row);

  if (!shouldRecordImplicitReview(normalized, now)) {
    return { reviewed: false };
  }

  const level = normalized.level || 'unorganized';
  const reviewMap = {
    bad: { level: 'mid', days: 3 },
    mid: { level: 'mid', days: 7 },
    good: { level: 'good', days: 21 },
    unorganized: { level: 'unorganized', days: 5 },
  };
  const config = reviewMap[level] || { level, days: 5 };
  const nextReviewAt = addDays(config.days, now);
  const reviewedAt = now.toISOString();
  const maturity = getMaturityForVocab({
    ...normalized,
    level: config.level,
  });

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          `UPDATE vocab
           SET level = ?,
               last_reviewed_at = ?,
               next_review_at = ?,
               implicit_review_count = COALESCE(implicit_review_count, 0) + 1,
               maturity = ?
           WHERE id = ?`,
          [config.level, reviewedAt, nextReviewAt, maturity, numericVocabId]
        );
      },
      (error) => {
        console.error('[Database] Error recording implicit reading review:', error);
        reject(error);
      },
      () => resolve()
    );
  });

  console.log(`[Database] Recorded implicit reading review for vocab id ${numericVocabId}`);
  return { reviewed: true, nextReviewAt };
};

export const getVocabularyHomeData = () => {
  return new Promise((resolve, reject) => {
    const now = new Date();

    db.transaction(tx => {
      tx.executeSql(
        `SELECT
           v.*,
           COUNT(DISTINCT ve.encounter_day) AS encounter_day_count,
           COUNT(DISTINCT ve.source_uri) AS encounter_source_count
         FROM vocab v
         LEFT JOIN vocab_encounters ve ON ve.vocab_id = v.id
         GROUP BY v.id
         ORDER BY
           v.is_favorite DESC,
           v.last_encountered_at DESC,
           v.created_at DESC`,
        [],
        (_, result) => {
          const rows = result.rows._array.map((row) => {
            const normalized = normalizeVocabLearningFields(row);
            const homeRow = {
              ...normalized,
              encounter_day_count: Number(row.encounter_day_count) || 0,
              encounter_source_count: Number(row.encounter_source_count) || 0,
            };

            return {
              ...homeRow,
              maturityMeta: getMaturityMeta(homeRow.maturity),
              highlightTone: getHighlightTone(homeRow),
              isDue: isDueForReview(homeRow, now),
              isLongTail: isLongTailWord(homeRow, now),
            };
          });

          console.log(`[Database] getVocabularyHomeData: fetched ${rows.length} row(s)`);
          resolve(rows);
        },
        (_, error) => {
          console.error('[Database] Error fetching vocabulary home data:', error);
          reject(error);
        }
      );
    });
  });
};

export const viewData = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT * FROM vocab',
        [],
        (_, result) => {
          const data = result.rows._array;
          console.log(`[Database] viewData: fetched ${data.length} row(s):`, data);
          resolve(data);
        },
        (_, error) => {
          console.error('[Database] Error fetching vocab data:', error);
          reject(error);
        }
      );
    });
  });
};

export const getDictionaryCacheCount = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT COUNT(*) AS count FROM dictionary_cache',
        [],
        (_, result) => {
          resolve(result.rows.item(0).count);
        },
        (_, error) => {
          console.error('[Database] Error fetching dictionary_cache count:', error);
          reject(error);
        }
      );
    });
  });
};

export const getTableSchema = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `PRAGMA table_info(vocab)`,
        [],
        (_, result) => {
          console.log(`[Database] Schema for vocab table:`, result.rows._array);
          resolve(result.rows._array);
        },
        (_, error) => {
          console.error(`[Database] Error retrieving vocab schema:`, error);
          reject(error);
        }
      );
    });
  });
};

export const deleteAllDataFromTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `DELETE FROM vocab`,
        [],
        () => {
          console.log(`[Database] All data deleted from vocab table`);
          resolve();
        },
        (_, error) => {
          console.error(`[Database] Error deleting all vocab data:`, error);
          reject(error);
        }
      );
    });
  });
};


// ─── Dictionary Cache Operations ──────────────────────────────────────────────

/**
 * insertCacheEntries
 * Bulk-insert an array of {stem, definition, hanja, pos, domain?} objects
 * returned by the backend /preprocess_book/ endpoint.
 * Uses INSERT OR IGNORE so re-running preprocessing is safe (no duplicates).
 *
 * @param {Array<{stem, definition, hanja, pos, domain?}>} entries
 */
export const insertCacheEntries = (entries) => {
  return new Promise((resolve, reject) => {
    if (!entries || entries.length === 0) {
      console.log("[Database] insertCacheEntries: nothing to insert");
      return resolve();
    }
    db.transaction(
      tx => {
        entries.forEach(({ stem, definition, hanja, pos, domain }) => {
          tx.executeSql(
            `INSERT OR IGNORE INTO dictionary_cache (stem, definition, hanja, pos, domain)
             VALUES (?, ?, ?, ?, ?)`,
            [stem, definition ?? null, hanja ?? null, pos ?? null, domain ?? null]
          );
        });
      },
      (error) => {
        console.error(`[Database] Error bulk-inserting ${entries.length} cache entries:`, error);
        reject(error);
      },
      () => {
        console.log(`[Database] Inserted ${entries.length} cache entries (duplicates ignored)`);
        resolve();
      }
    );
  });
};

/**
 * lookupCacheByStems
 * Query dictionary_cache for one or more stems in a single SQL call.
 * Returns matching rows in the same order as the requested stems.
 *
 * This is the "instant lookup" path: called when a user taps a word,
 * before deciding whether a live API call is needed.
 *
 * @param {string[]} stems
 * @returns {Promise<Array<{id, stem, definition, hanja, pos, domain}>>}
 */
export const lookupCacheByStems = (stems) => {
  return new Promise((resolve, reject) => {
    if (!stems || stems.length === 0) return resolve([]);
    const placeholders = stems.map(() => '?').join(',');
    const stemOrder = new Map(stems.map((stem, index) => [stem, index]));
    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, stem, definition, hanja, pos, domain
         FROM dictionary_cache WHERE stem IN (${placeholders})`,
        stems,
        (_, result) => {
          const rows = [...result.rows._array].sort((a, b) => (
            (stemOrder.get(a.stem) ?? Number.MAX_SAFE_INTEGER)
            - (stemOrder.get(b.stem) ?? Number.MAX_SAFE_INTEGER)
          ));
          console.log(`[Database] lookupCacheByStems(${JSON.stringify(stems)}): ${rows.length} hit(s)`);
          resolve(rows);
        },
        (_, error) => {
          console.error('[Database] Error querying dictionary_cache:', error);
          reject(error);
        }
      );
    });
  });
};

/**
 * lookupCacheByStem
 * Single-stem convenience wrapper around lookupCacheByStems.
 * Returns the matching row or null if not cached.
 *
 * @param {string} stem
 * @returns {Promise<{id, stem, definition, hanja, pos, domain} | null>}
 */
export const lookupCacheByStem = (stem) => {
  return lookupCacheByStems([stem]).then(rows => {
    const result = rows[0] ?? null;
    console.log(`[Database] lookupCacheByStem("${stem}"):`, result ? "found" : "miss");
    return result;
  });
};

export const lookupBookIndexBySurface = (bookUri, surface) => {
  return new Promise((resolve, reject) => {
    if (!bookUri || !surface) {
      return resolve([]);
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT dc.id, dc.stem, dc.definition, dc.hanja, dc.pos, dc.domain
         FROM book_index bi
         JOIN dictionary_cache dc ON dc.id = bi.stem_id
         WHERE bi.book_uri = ? AND bi.surface = ?`,
        [bookUri, surface],
        (_, result) => {
          const rows = result.rows._array;
          console.log(
            `[Database] lookupBookIndexBySurface("${bookUri}", "${surface}"): ${rows.length} hit(s)`
          );
          resolve(rows);
        },
        (_, error) => {
          console.error('[Database] Error querying book_index by surface:', error);
          reject(error);
        }
      );
    });
  });
};

export const lookupBookHighlightSurfaces = (bookUri, savedStems) => {
  return new Promise((resolve, reject) => {
    if (!bookUri || !savedStems || savedStems.length === 0) {
      return resolve([]);
    }

    const uniqueStems = [...new Set(savedStems.filter(Boolean))];
    if (uniqueStems.length === 0) {
      return resolve([]);
    }

    const placeholders = uniqueStems.map(() => '?').join(',');

    db.transaction(tx => {
      tx.executeSql(
        `SELECT DISTINCT bi.surface, dc.stem
         FROM book_index bi
         JOIN dictionary_cache dc ON dc.id = bi.stem_id
         WHERE bi.book_uri = ? AND dc.stem IN (${placeholders})`,
        [bookUri, ...uniqueStems],
        (_, result) => {
          const rows = result.rows._array;
          console.log(
            `[Database] lookupBookHighlightSurfaces("${bookUri}"): ${rows.length} surface hit(s) for ${uniqueStems.length} saved stem(s)`
          );
          resolve(rows);
        },
        (_, error) => {
          console.error('[Database] Error querying highlight surfaces from book_index:', error);
          reject(error);
        }
      );
    });
  });
};

/**
 * isBookPreprocessed
 * Returns true if at least one book_index row exists for this book URI.
 * Used on book open to decide whether preprocessing needs to run.
 *
 * @param {string} bookUri
 * @returns {Promise<boolean>}
 */
export const isBookPreprocessed = (bookUri) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT COUNT(*) AS count FROM book_index WHERE book_uri = ?',
        [bookUri],
        (_, result) => {
          const { count } = result.rows.item(0);
          const preprocessed = count > 0;
          console.log(`[Database] isBookPreprocessed("${bookUri}"): ${preprocessed} (${count} rows)`);
          resolve(preprocessed);
        },
        (_, error) => {
          console.error('[Database] Error checking book_index:', error);
          reject(error);
        }
      );
    });
  });
};

/**
 * insertBookIndexEntries
 * Bulk-insert surface→stem_id mappings for a book after preprocessing completes.
 * Uses INSERT OR IGNORE so re-running on the same book is safe.
 *
 * @param {string} bookUri
 * @param {Array<{surface: string, stem_id: number}>} entries
 */
/**
 * logDatabaseSnapshot
 * Logs row counts and sample rows from all three tables to the console.
 * Call this after book preprocessing completes to inspect the DB state.
 *
 * @param {string} [bookUri] - If provided, scopes book_index sample to this book
 */
export const logDatabaseSnapshot = (bookUri) => {
  db.transaction(tx => {
    // ── Row counts ────────────────────────────────────────────────────────────
    tx.executeSql('SELECT COUNT(*) AS count FROM vocab', [], (_, r) => {
      console.log(`[DB Snapshot] vocab rows: ${r.rows.item(0).count}`);
    });
    tx.executeSql('SELECT COUNT(*) AS count FROM dictionary_cache', [], (_, r) => {
      console.log(`[DB Snapshot] dictionary_cache rows: ${r.rows.item(0).count}`);
    });
    tx.executeSql('SELECT COUNT(*) AS count FROM book_index', [], (_, r) => {
      console.log(`[DB Snapshot] book_index rows (total): ${r.rows.item(0).count}`);
    });
    if (bookUri) {
      tx.executeSql(
        'SELECT COUNT(*) AS count FROM book_index WHERE book_uri = ?',
        [bookUri],
        (_, r) => {
          console.log(`[DB Snapshot] book_index rows for current book: ${r.rows.item(0).count}`);
        }
      );
    }

    // ── Sample rows ───────────────────────────────────────────────────────────
    tx.executeSql(
      'SELECT stem, definition, hanja, pos FROM dictionary_cache LIMIT 10',
      [],
      (_, r) => {
        console.log(`[DB Snapshot] dictionary_cache sample (first ${r.rows._array.length} rows):`);
        r.rows._array.forEach((row, i) => {
          console.log(`  [${i + 1}] stem="${row.stem}" | pos=${row.pos} | hanja=${row.hanja ?? 'N/A'} | def=${row.definition?.slice(0, 60) ?? 'N/A'}`);
        });
      }
    );
    const bookIndexQuery = bookUri
      ? 'SELECT surface, stem_id FROM book_index WHERE book_uri = ? LIMIT 10'
      : 'SELECT book_uri, surface, stem_id FROM book_index LIMIT 10';
    const bookIndexArgs = bookUri ? [bookUri] : [];
    tx.executeSql(bookIndexQuery, bookIndexArgs, (_, r) => {
      console.log(`[DB Snapshot] book_index sample (first ${r.rows._array.length} rows):`);
      r.rows._array.forEach((row, i) => {
        const prefix = bookUri ? '' : `book="${row.book_uri?.slice(-20)}" | `;
        console.log(`  [${i + 1}] ${prefix}surface="${row.surface}" | stem_id=${row.stem_id}`);
      });
    });
  });
};

export const insertBookIndexEntries = (bookUri, entries) => {
  return new Promise((resolve, reject) => {
    if (!entries || entries.length === 0) {
      console.log("[Database] insertBookIndexEntries: nothing to insert");
      return resolve();
    }
    db.transaction(
      tx => {
        entries.forEach(({ surface, stem_id }) => {
          tx.executeSql(
            `INSERT OR IGNORE INTO book_index (book_uri, surface, stem_id) VALUES (?, ?, ?)`,
            [bookUri, surface, stem_id]
          );
        });
      },
      (error) => {
        console.error(`[Database] Error inserting book_index for "${bookUri}":`, error);
        reject(error);
      },
      () => {
        console.log(`[Database] Inserted ${entries.length} book_index rows for "${bookUri}"`);
        resolve();
      }
    );
  });
};

export const deleteBookIndexEntries = (bookUri) => {
  return new Promise((resolve, reject) => {
    if (!bookUri) {
      resolve();
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        'DELETE FROM book_index WHERE book_uri = ?',
        [bookUri],
        (_, result) => {
          console.log(`[Database] Deleted ${result.rowsAffected} book_index row(s) for "${bookUri}"`);
          resolve(result.rowsAffected);
        },
        (_, error) => {
          console.error(`[Database] Error deleting book_index rows for "${bookUri}":`, error);
          reject(error);
        }
      );
    });
  });
};
