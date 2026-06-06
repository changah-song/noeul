import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeHanjaDatabase } from './hanjaDatabase';
import { GUEST_OWNER_ID } from './localDataScope';

// ─── Database Setup ───────────────────────────────────────────────────────────
// NOTE: Change the db filename here if you ever need to reset all tables by
// wiping the old database (e.g., rename to 'app_v2.db' to start fresh).
const db = SQLite.openDatabase('temp.db');
const BOOK_INDEX_MIGRATION_KEY = 'book_index_migration_v2';
const DICTIONARY_CACHE_MIGRATION_KEY = 'dictionary_cache_migration_v1';
const LOCAL_OWNER_SQLITE_MIGRATION_KEY = 'local_owner_sqlite_migration_v1';
export const PREPROCESS_VERSION = 1;

const resolveOwnerId = (value) => {
  if (typeof value === 'string') {
    const ownerId = value.trim();
    return ownerId || GUEST_OWNER_ID;
  }

  const ownerId = typeof value?.ownerId === 'string' ? value.ownerId.trim() : '';
  return ownerId || GUEST_OWNER_ID;
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
          owner_id TEXT NOT NULL DEFAULT 'guest',
          word  TEXT,
          hanja TEXT,
          def   TEXT,
          level TEXT,
          context_sentence TEXT,
          related_known_words TEXT DEFAULT '[]',
          updated_at TEXT,
          deleted_at TEXT,
          language TEXT DEFAULT 'ko'
        )`,
        [],
        () => resolve(),
        (_, error) => {
          console.error("[Database] Error creating vocab table:", error);
          reject(error);
        }
      );
    });
  });
};

export const createVocabContextTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS vocab_contexts (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id          TEXT NOT NULL DEFAULT 'guest',
          vocab_id          INTEGER,
          word              TEXT NOT NULL,
          hanja             TEXT,
          def               TEXT,
          source_book_uri   TEXT,
          source_book_title TEXT,
          sentence          TEXT NOT NULL,
          seen_at           TEXT DEFAULT CURRENT_TIMESTAMP,
          language          TEXT DEFAULT 'ko',
          updated_at        TEXT,
          deleted_at        TEXT
        )`,
        [],
        () => {
          tx.executeSql(
            `CREATE INDEX IF NOT EXISTS idx_vocab_contexts_vocab_seen
             ON vocab_contexts(vocab_id, seen_at DESC)`
          );
          tx.executeSql(
            `CREATE INDEX IF NOT EXISTS idx_vocab_contexts_word_seen
             ON vocab_contexts(word, seen_at DESC)`
          );
          resolve();
        },
        (_, error) => {
          console.error('[Database] Error creating vocab_contexts table:', error);
          reject(error);
        }
      );
    });
  });
};

export const migrateVocabContextTable = async () => {
  const columns = await getTableColumns('vocab_contexts');
  const alterations = [];

  if (!columns.includes('owner_id')) {
    alterations.push(`ALTER TABLE vocab_contexts ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
  }

  if (!columns.includes('language')) {
    alterations.push(`ALTER TABLE vocab_contexts ADD COLUMN language TEXT DEFAULT 'ko'`);
  }

  if (!columns.includes('updated_at')) {
    alterations.push('ALTER TABLE vocab_contexts ADD COLUMN updated_at TEXT');
  }

  if (!columns.includes('deleted_at')) {
    alterations.push('ALTER TABLE vocab_contexts ADD COLUMN deleted_at TEXT');
  }

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        alterations.forEach((statement) => tx.executeSql(statement));
        tx.executeSql(`UPDATE vocab_contexts SET owner_id = ? WHERE owner_id IS NULL OR TRIM(owner_id) = ''`, [GUEST_OWNER_ID]);
        tx.executeSql(`UPDATE vocab_contexts SET language = 'ko' WHERE language IS NULL OR TRIM(language) = ''`);
        tx.executeSql(`UPDATE vocab_contexts SET seen_at = COALESCE(seen_at, CURRENT_TIMESTAMP)`);
        tx.executeSql(`UPDATE vocab_contexts SET updated_at = COALESCE(updated_at, seen_at, CURRENT_TIMESTAMP)`);
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_contexts_identity
           ON vocab_contexts(language, word, hanja, def, source_book_uri, sentence)`
        );
        tx.executeSql(
          `INSERT INTO vocab_contexts (
            owner_id, vocab_id, word, hanja, def, source_book_uri, source_book_title, sentence,
            seen_at, language, updated_at, deleted_at
          )
           SELECT
            COALESCE(v.owner_id, ?),
            v.id,
            v.word,
            v.hanja,
            v.def,
            v.source_book_uri,
            v.source_book_title,
            v.context_sentence,
            COALESCE(v.created_at, CURRENT_TIMESTAMP),
            COALESCE(v.language, 'ko'),
            COALESCE(v.updated_at, v.created_at, CURRENT_TIMESTAMP),
            NULL
           FROM vocab v
           WHERE v.context_sentence IS NOT NULL
             AND TRIM(v.context_sentence) != ''
             AND v.deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1
               FROM vocab_contexts vc
               WHERE vc.owner_id = COALESCE(v.owner_id, ?)
                 AND vc.language = COALESCE(v.language, 'ko')
                 AND vc.word = v.word
                 AND vc.hanja IS v.hanja
                 AND vc.def IS v.def
                 AND COALESCE(vc.source_book_uri, '') = COALESCE(v.source_book_uri, '')
                 AND vc.sentence = v.context_sentence
                 AND vc.deleted_at IS NULL
             )`,
          [GUEST_OWNER_ID, GUEST_OWNER_ID]
        );
      },
      (error) => {
        console.error('[Database] Error migrating vocab_contexts table:', error);
        reject(error);
      },
      () => resolve()
    );
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

  if (!columns.includes('owner_id')) {
    alterations.push(`ALTER TABLE vocab ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
  }

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

  if (!columns.includes('updated_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN updated_at TEXT');
  }

  if (!columns.includes('deleted_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN deleted_at TEXT');
  }

  if (!columns.includes('language')) {
    alterations.push(`ALTER TABLE vocab ADD COLUMN language TEXT DEFAULT 'ko'`);
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
        tx.executeSql(`UPDATE vocab SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)`);
        tx.executeSql(`UPDATE vocab SET language = 'ko' WHERE language IS NULL OR TRIM(language) = ''`);
        tx.executeSql(`UPDATE vocab SET owner_id = ? WHERE owner_id IS NULL OR TRIM(owner_id) = ''`, [GUEST_OWNER_ID]);
      },
      (error) => {
        console.error('[Database] Error migrating vocab table:', error);
        reject(error);
      },
      () => resolve()
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
        () => resolve(),
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
  if (migrationState === 'done') return;

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
        () => resolve(),
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
          owner_id TEXT NOT NULL DEFAULT 'guest',
          book_uri TEXT NOT NULL,
          surface  TEXT NOT NULL,
          stem_id  INTEGER NOT NULL,
          UNIQUE(owner_id, book_uri, surface, stem_id)
        )`,
        [],
        () => resolve(),
        (_, error) => {
          console.error("[Database] Error creating book_index table:", error);
          reject(error);
        }
      );
    });
  });
};

export const createBookPreprocessTables = () => {
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          `CREATE TABLE IF NOT EXISTS book_preprocess_meta (
            owner_id           TEXT NOT NULL DEFAULT 'guest',
            book_uri           TEXT NOT NULL,
            status             TEXT,
            preprocess_version INTEGER DEFAULT ${PREPROCESS_VERSION},
            started_at         TEXT,
            completed_at       TEXT,
            surface_count      INTEGER DEFAULT 0,
            PRIMARY KEY (owner_id, book_uri, preprocess_version)
          )`,
          []
        );
        tx.executeSql(
          `CREATE TABLE IF NOT EXISTS book_preprocess_chapters (
            owner_id           TEXT NOT NULL DEFAULT 'guest',
            book_uri           TEXT NOT NULL,
            spine_index        INTEGER NOT NULL,
            status             TEXT,
            surface_count      INTEGER DEFAULT 0,
            completed_at       TEXT,
            preprocess_version INTEGER DEFAULT ${PREPROCESS_VERSION},
            PRIMARY KEY (owner_id, book_uri, spine_index, preprocess_version)
          )`,
          []
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_book_preprocess_chapters_book_status
           ON book_preprocess_chapters(owner_id, book_uri, preprocess_version, status)`,
          []
        );
      },
      (error) => {
        console.error('[Database] Error creating book preprocess tables:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const migrateBookIndex = async () => {
  const migrationState = await AsyncStorage.getItem(BOOK_INDEX_MIGRATION_KEY);
  if (migrationState === 'done') return;

  await new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'DROP TABLE IF EXISTS book_index',
        [],
        () => resolve(),
        (_, error) => {
          console.error('[Database] Error dropping legacy book_index table:', error);
          reject(error);
        }
      );
    });
  });

  await createBookIndexTable();
  await AsyncStorage.setItem(BOOK_INDEX_MIGRATION_KEY, 'done');
};

const createOwnerIndexes = () => {
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_owner_identity
           ON vocab(owner_id, language, word, hanja, def)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_contexts_owner_identity
           ON vocab_contexts(owner_id, language, word, hanja, def, source_book_uri, sentence)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_contexts_owner_vocab_seen
           ON vocab_contexts(owner_id, vocab_id, seen_at DESC)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_book_index_owner_surface
           ON book_index(owner_id, book_uri, surface)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_book_preprocess_meta_owner_book
           ON book_preprocess_meta(owner_id, book_uri, preprocess_version)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_book_preprocess_chapters_owner_book_status
           ON book_preprocess_chapters(owner_id, book_uri, preprocess_version, status)`
        );
      },
      (error) => {
        console.error('[Database] Error creating owner indexes:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const migrateLocalOwnerSqlite = async () => {
  const migrationState = await AsyncStorage.getItem(LOCAL_OWNER_SQLITE_MIGRATION_KEY);
  if (migrationState === 'done') {
    await createOwnerIndexes();
    return;
  }

  const [
    vocabColumns,
    contextColumns,
    bookIndexColumns,
    preprocessMetaColumns,
    preprocessChapterColumns,
  ] = await Promise.all([
    getTableColumns('vocab'),
    getTableColumns('vocab_contexts'),
    getTableColumns('book_index'),
    getTableColumns('book_preprocess_meta'),
    getTableColumns('book_preprocess_chapters'),
  ]);

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        if (!vocabColumns.includes('owner_id')) {
          tx.executeSql(`ALTER TABLE vocab ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
        }
        if (!contextColumns.includes('owner_id')) {
          tx.executeSql(`ALTER TABLE vocab_contexts ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
        }
        tx.executeSql(
          `UPDATE vocab SET owner_id = ? WHERE owner_id IS NULL OR TRIM(owner_id) = ''`,
          [GUEST_OWNER_ID]
        );
        tx.executeSql(
          `UPDATE vocab_contexts SET owner_id = ? WHERE owner_id IS NULL OR TRIM(owner_id) = ''`,
          [GUEST_OWNER_ID]
        );

        if (!bookIndexColumns.includes('owner_id')) {
          tx.executeSql(`ALTER TABLE book_index ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
        }
        tx.executeSql(`DROP TABLE IF EXISTS book_index_owner_new`);
        tx.executeSql(
          `CREATE TABLE book_index_owner_new (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id TEXT NOT NULL DEFAULT 'guest',
            book_uri TEXT NOT NULL,
            surface  TEXT NOT NULL,
            stem_id  INTEGER NOT NULL,
            UNIQUE(owner_id, book_uri, surface, stem_id)
          )`
        );
        tx.executeSql(
          `INSERT OR IGNORE INTO book_index_owner_new (owner_id, book_uri, surface, stem_id)
           SELECT COALESCE(owner_id, ?), book_uri, surface, stem_id
           FROM book_index
           WHERE book_uri IS NOT NULL AND surface IS NOT NULL AND stem_id IS NOT NULL`,
          [GUEST_OWNER_ID]
        );
        tx.executeSql(`DROP TABLE IF EXISTS book_index`);
        tx.executeSql(`ALTER TABLE book_index_owner_new RENAME TO book_index`);

        if (!preprocessMetaColumns.includes('owner_id')) {
          tx.executeSql(`ALTER TABLE book_preprocess_meta ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
        }
        tx.executeSql(`DROP TABLE IF EXISTS book_preprocess_meta_owner_new`);
        tx.executeSql(
          `CREATE TABLE book_preprocess_meta_owner_new (
            owner_id           TEXT NOT NULL DEFAULT 'guest',
            book_uri           TEXT NOT NULL,
            status             TEXT,
            preprocess_version INTEGER DEFAULT ${PREPROCESS_VERSION},
            started_at         TEXT,
            completed_at       TEXT,
            surface_count      INTEGER DEFAULT 0,
            PRIMARY KEY (owner_id, book_uri, preprocess_version)
          )`
        );
        tx.executeSql(
          `INSERT OR REPLACE INTO book_preprocess_meta_owner_new (
            owner_id, book_uri, status, preprocess_version, started_at, completed_at, surface_count
          )
           SELECT
            COALESCE(owner_id, ?),
            book_uri,
            status,
            COALESCE(preprocess_version, ?),
            started_at,
            completed_at,
            COALESCE(surface_count, 0)
           FROM book_preprocess_meta
           WHERE book_uri IS NOT NULL`,
          [GUEST_OWNER_ID, PREPROCESS_VERSION]
        );
        tx.executeSql(`DROP TABLE IF EXISTS book_preprocess_meta`);
        tx.executeSql(`ALTER TABLE book_preprocess_meta_owner_new RENAME TO book_preprocess_meta`);

        if (!preprocessChapterColumns.includes('owner_id')) {
          tx.executeSql(`ALTER TABLE book_preprocess_chapters ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
        }
        tx.executeSql(`DROP TABLE IF EXISTS book_preprocess_chapters_owner_new`);
        tx.executeSql(
          `CREATE TABLE book_preprocess_chapters_owner_new (
            owner_id           TEXT NOT NULL DEFAULT 'guest',
            book_uri           TEXT NOT NULL,
            spine_index        INTEGER NOT NULL,
            status             TEXT,
            surface_count      INTEGER DEFAULT 0,
            completed_at       TEXT,
            preprocess_version INTEGER DEFAULT ${PREPROCESS_VERSION},
            PRIMARY KEY (owner_id, book_uri, spine_index, preprocess_version)
          )`
        );
        tx.executeSql(
          `INSERT OR REPLACE INTO book_preprocess_chapters_owner_new (
            owner_id, book_uri, spine_index, status, surface_count, completed_at, preprocess_version
          )
           SELECT
            COALESCE(owner_id, ?),
            book_uri,
            spine_index,
            status,
            COALESCE(surface_count, 0),
            completed_at,
            COALESCE(preprocess_version, ?)
           FROM book_preprocess_chapters
           WHERE book_uri IS NOT NULL AND spine_index IS NOT NULL`,
          [GUEST_OWNER_ID, PREPROCESS_VERSION]
        );
        tx.executeSql(`DROP TABLE IF EXISTS book_preprocess_chapters`);
        tx.executeSql(`ALTER TABLE book_preprocess_chapters_owner_new RENAME TO book_preprocess_chapters`);
      },
      (error) => {
        console.error('[Database] Error migrating local owner SQLite tables:', error);
        reject(error);
      },
      () => resolve()
    );
  });

  await createOwnerIndexes();
  await AsyncStorage.setItem(LOCAL_OWNER_SQLITE_MIGRATION_KEY, 'done');
};

const SQLITE_USER_DATA_TABLES = [
  'vocab',
  'vocab_contexts',
  'book_index',
  'book_preprocess_meta',
  'book_preprocess_chapters',
];

export const hasSqliteUserData = async (ownerId = GUEST_OWNER_ID) => {
  const scopedOwnerId = resolveOwnerId(ownerId);

  return new Promise((resolve, reject) => {
    let pending = SQLITE_USER_DATA_TABLES.length;
    let hasData = false;
    let settled = false;

    const finishOne = () => {
      pending -= 1;
      if (pending === 0 && !settled) {
        settled = true;
        resolve(hasData);
      }
    };

    db.transaction(tx => {
      SQLITE_USER_DATA_TABLES.forEach((tableName) => {
        tx.executeSql(
          `SELECT 1 AS has_data FROM ${tableName} WHERE owner_id = ? LIMIT 1`,
          [scopedOwnerId],
          (_, result) => {
            hasData = hasData || result.rows.length > 0;
            finishOne();
          },
          (_, error) => {
            if (!settled) {
              settled = true;
              console.error(`[Database] Error checking owner data in ${tableName}:`, error);
              reject(error);
            }
            return false;
          }
        );
      });
    });
  });
};

export const clearSqliteUserData = async (ownerId = GUEST_OWNER_ID) => {
  const scopedOwnerId = resolveOwnerId(ownerId);

  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        SQLITE_USER_DATA_TABLES.forEach((tableName) => {
          tx.executeSql(`DELETE FROM ${tableName} WHERE owner_id = ?`, [scopedOwnerId]);
        });
      },
      (error) => {
        console.error(`[Database] Error clearing SQLite user data for "${scopedOwnerId}":`, error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const hasUnscopedSqliteUserData = async () => {
  return new Promise((resolve, reject) => {
    let pending = SQLITE_USER_DATA_TABLES.length;
    let hasData = false;
    let settled = false;

    const finishOne = () => {
      pending -= 1;
      if (pending === 0 && !settled) {
        settled = true;
        resolve(hasData);
      }
    };

    db.transaction(tx => {
      SQLITE_USER_DATA_TABLES.forEach((tableName) => {
        tx.executeSql(
          `SELECT 1 AS has_data FROM ${tableName}
           WHERE owner_id IS NULL OR TRIM(owner_id) = ''
           LIMIT 1`,
          [],
          (_, result) => {
            hasData = hasData || result.rows.length > 0;
            finishOne();
          },
          (_, error) => {
            if (!settled) {
              settled = true;
              console.error(`[Database] Error checking unscoped owner data in ${tableName}:`, error);
              reject(error);
            }
            return false;
          }
        );
      });
    });
  });
};

export const assignUnscopedSqliteUserDataToGuest = async () => {
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        SQLITE_USER_DATA_TABLES.forEach((tableName) => {
          tx.executeSql(
            `UPDATE ${tableName}
             SET owner_id = ?
             WHERE owner_id IS NULL OR TRIM(owner_id) = ''`,
            [GUEST_OWNER_ID]
          );
        });
      },
      (error) => {
        console.error('[Database] Error assigning unscoped SQLite user data to guest:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const clearUnscopedSqliteUserData = async () => {
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        SQLITE_USER_DATA_TABLES.forEach((tableName) => {
          tx.executeSql(
            `DELETE FROM ${tableName}
             WHERE owner_id IS NULL OR TRIM(owner_id) = ''`
          );
        });
      },
      (error) => {
        console.error('[Database] Error clearing unscoped SQLite user data:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const reassignSqliteUserData = async (fromOwnerId, toOwnerId) => {
  const sourceOwnerId = resolveOwnerId(fromOwnerId);
  const targetOwnerId = resolveOwnerId(toOwnerId);

  if (sourceOwnerId === targetOwnerId) {
    return;
  }

  if (await hasSqliteUserData(targetOwnerId)) {
    throw new Error('Refusing to reassign SQLite user data because target owner already has local rows');
  }

  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        SQLITE_USER_DATA_TABLES.forEach((tableName) => {
          tx.executeSql(
            `UPDATE ${tableName} SET owner_id = ? WHERE owner_id = ?`,
            [targetOwnerId, sourceOwnerId]
          );
        });
      },
      (error) => {
        console.error(`[Database] Error reassigning SQLite data from "${sourceOwnerId}" to "${targetOwnerId}":`, error);
        reject(error);
      },
      () => resolve()
    );
  });
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
        () => resolve(),
        (_, error) => {
          console.warn('[Database] deduplicateCacheTable failed (non-fatal):', error);
          resolve(); // non-fatal
        }
      );
    });
  });
};

export const initAllTables = async () => {
  await createTable();
  await migrateVocabTable();
  await createVocabContextTable();
  await migrateVocabContextTable();
  await createDictionaryCacheTable();
  await migrateDictionaryCache();
  await migrateBookIndex();
  await createBookIndexTable();
  await createBookPreprocessTables();
  await migrateLocalOwnerSqlite();
  await createOwnerIndexes();
  await deduplicateCacheTable();
  await initializeHanjaDatabase();
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
    updatedAt = createdAt,
    deletedAt = null,
    language = 'ko',
    ownerId = GUEST_OWNER_ID,
  } = options;
  const scopedOwnerId = resolveOwnerId(ownerId);
  const relatedKnownWordsJson = JSON.stringify(Array.isArray(relatedKnownWords) ? relatedKnownWords : []);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `INSERT INTO vocab (
          owner_id, word, hanja, def, level, source_book_uri, source_book_title, context_sentence, is_favorite,
          priority, created_at, last_reviewed_at, next_review_at, correct_count, wrong_count,
          related_known_words, updated_at, deleted_at, language
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scopedOwnerId,
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
          updatedAt ?? createdAt,
          deletedAt,
          language || 'ko',
        ],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error inserting vocab word "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const vocabEntryExists = (word, hanja, definition, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT COUNT(*) AS count
         FROM vocab
         WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ? AND deleted_at IS NULL`,
        [ownerId, word, hanja ?? null, definition ?? null, language],
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
  const options = typeof levelOrOptions === 'object' && levelOrOptions !== null
    ? levelOrOptions
    : { level: levelOrOptions };
  const language = options.language ?? 'ko';
  const ownerId = resolveOwnerId(options);
  const exists = await vocabEntryExists(word, hanja, definition, language, { ownerId });
  if (exists) {
    return false;
  }

  await insertData(word, hanja, definition, { ...options, ownerId });
  return true;
};

export const upsertVocabEntryFromCloud = (entry, options = {}) => {
  const now = new Date().toISOString();
  const word = entry.word;
  const hanja = entry.hanja ?? null;
  const definition = entry.definition ?? entry.def ?? null;
  const level = entry.status ?? entry.level ?? 'unorganized';
  const language = entry.language ?? 'ko';
  const createdAt = entry.created_at ?? entry.createdAt ?? now;
  const updatedAt = entry.updated_at ?? entry.updatedAt ?? createdAt;
  const ownerId = resolveOwnerId(options.ownerId ?? entry.owner_id ?? entry.ownerId);

  return new Promise((resolve, reject) => {
    if (!word) {
      resolve(false);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT id
         FROM vocab
         WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ?
         ORDER BY id ASC
         LIMIT 1`,
        [ownerId, word, hanja, definition, language],
        (_, result) => {
          const params = [
            ownerId,
            word,
            hanja,
            definition,
            level,
            entry.source_book_uri ?? entry.sourceBookUri ?? null,
            entry.source_book_title ?? entry.sourceBookTitle ?? null,
            entry.context_sentence ?? entry.contextSentence ?? null,
            entry.is_favorite || entry.isFavorite ? 1 : 0,
            entry.priority ?? 'normal',
            createdAt,
            entry.last_reviewed_at ?? entry.lastReviewedAt ?? null,
            entry.next_review_at ?? entry.nextReviewAt ?? null,
            Number(entry.correct_count ?? entry.correctCount ?? 0) || 0,
            Number(entry.wrong_count ?? entry.wrongCount ?? 0) || 0,
            Array.isArray(entry.related_known_words ?? entry.relatedKnownWords)
              ? JSON.stringify(entry.related_known_words ?? entry.relatedKnownWords)
              : (entry.related_known_words ?? entry.relatedKnownWords ?? '[]'),
            updatedAt,
            entry.deleted_at ?? entry.deletedAt ?? null,
            language,
          ];

          if (result.rows.length === 0) {
            tx.executeSql(
              `INSERT INTO vocab (
                owner_id, word, hanja, def, level, source_book_uri, source_book_title, context_sentence,
                is_favorite, priority, created_at, last_reviewed_at, next_review_at,
                correct_count, wrong_count, related_known_words, updated_at, deleted_at, language
              )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              params,
              () => resolve(true),
              (_, insertError) => {
                console.error(`[Database] Error inserting cloud vocab row "${word}":`, insertError);
                reject(insertError);
                return false;
              }
            );
            return;
          }

          tx.executeSql(
            `UPDATE vocab
             SET word = ?,
                 owner_id = ?,
                 hanja = ?,
                 def = ?,
                 level = ?,
                 source_book_uri = ?,
                 source_book_title = ?,
                 context_sentence = ?,
                 is_favorite = ?,
                 priority = ?,
                 created_at = ?,
                 last_reviewed_at = ?,
                 next_review_at = ?,
                 correct_count = ?,
                 wrong_count = ?,
                 related_known_words = ?,
                 updated_at = ?,
                 deleted_at = ?,
                 language = ?
             WHERE id = ?`,
            [
              word,
              ownerId,
              hanja,
              definition,
              level,
              entry.source_book_uri ?? entry.sourceBookUri ?? null,
              entry.source_book_title ?? entry.sourceBookTitle ?? null,
              entry.context_sentence ?? entry.contextSentence ?? null,
              entry.is_favorite || entry.isFavorite ? 1 : 0,
              entry.priority ?? 'normal',
              createdAt,
              entry.last_reviewed_at ?? entry.lastReviewedAt ?? null,
              entry.next_review_at ?? entry.nextReviewAt ?? null,
              Number(entry.correct_count ?? entry.correctCount ?? 0) || 0,
              Number(entry.wrong_count ?? entry.wrongCount ?? 0) || 0,
              Array.isArray(entry.related_known_words ?? entry.relatedKnownWords)
                ? JSON.stringify(entry.related_known_words ?? entry.relatedKnownWords)
                : (entry.related_known_words ?? entry.relatedKnownWords ?? '[]'),
              updatedAt,
              entry.deleted_at ?? entry.deletedAt ?? null,
              language,
              result.rows.item(0).id,
            ],
            () => resolve(true),
            (_, updateError) => {
              console.error(`[Database] Error updating cloud vocab row "${word}":`, updateError);
              reject(updateError);
              return false;
            }
          );
        },
        (_, selectError) => {
          console.error(`[Database] Error finding cloud vocab row "${word}":`, selectError);
          reject(selectError);
          return false;
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

const cleanValue = (value) => (typeof value === 'string' ? value.trim() : '');
const isMasteredLevel = (level) => cleanValue(level).toLowerCase() === 'good';

const resolveNullable = (value) => {
  const cleaned = cleanValue(value);
  return cleaned || null;
};

const relatedKnownWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;
const nowIso = () => new Date().toISOString();

const upsertContextForVocabRow = (tx, row, {
  ownerId = row?.owner_id ?? GUEST_OWNER_ID,
  sentence,
  sourceBookUri = null,
  sourceBookTitle = null,
  seenAt = new Date().toISOString(),
  language = row?.language ?? 'ko',
  updatedAt = nowIso(),
}, resolve, reject) => {
  const cleanedSentence = cleanValue(sentence);
  if (!row?.id || !cleanedSentence) {
    resolve(false);
    return;
  }

  const normalizedSourceUri = resolveNullable(sourceBookUri);
  const normalizedSourceTitle = resolveNullable(sourceBookTitle);
  const normalizedLanguage = language || row?.language || 'ko';
  const scopedOwnerId = resolveOwnerId(ownerId);
  const buildContextRow = (id) => ({
    id,
    owner_id: scopedOwnerId,
    ownerId: scopedOwnerId,
    vocab_id: row.id,
    word: row.word,
    hanja: row.hanja ?? null,
    def: row.def ?? null,
    definition: row.def ?? null,
    source_book_uri: normalizedSourceUri,
    source_book_title: normalizedSourceTitle,
    sentence: cleanedSentence,
    seen_at: seenAt,
    updated_at: updatedAt,
    deleted_at: null,
    language: normalizedLanguage,
  });

  tx.executeSql(
    `SELECT id
     FROM vocab_contexts
     WHERE owner_id = ?
       AND language = ?
       AND word = ?
       AND hanja IS ?
       AND def IS ?
       AND sentence = ?
       AND COALESCE(source_book_uri, '') = COALESCE(?, '')
       AND deleted_at IS NULL
     ORDER BY id ASC
     LIMIT 1`,
    [
      scopedOwnerId,
      normalizedLanguage,
      row.word,
      row.hanja ?? null,
      row.def ?? null,
      cleanedSentence,
      normalizedSourceUri,
    ],
    (_, existingResult) => {
      if (existingResult.rows.length > 0) {
        const contextId = existingResult.rows.item(0).id;
        tx.executeSql(
          `UPDATE vocab_contexts
           SET vocab_id = ?,
               seen_at = ?,
               updated_at = ?,
               source_book_title = COALESCE(?, source_book_title),
               language = ?
           WHERE id = ?`,
          [row.id, seenAt, updatedAt, normalizedSourceTitle, normalizedLanguage, contextId],
          () => resolve(buildContextRow(contextId)),
          (_, updateError) => {
            console.error('[Database] Error updating vocab context:', updateError);
            reject(updateError);
            return false;
          }
        );
        return;
      }

      tx.executeSql(
        `INSERT INTO vocab_contexts (
          owner_id, vocab_id, word, hanja, def, source_book_uri, source_book_title, sentence,
          seen_at, language, updated_at, deleted_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scopedOwnerId,
          row.id,
          row.word,
          row.hanja ?? null,
          row.def ?? null,
          normalizedSourceUri,
          normalizedSourceTitle,
          cleanedSentence,
          seenAt,
          normalizedLanguage,
          updatedAt,
          null,
        ],
        (_, insertResult) => resolve(buildContextRow(insertResult.insertId)),
        (_, insertError) => {
          console.error('[Database] Error inserting vocab context:', insertError);
          reject(insertError);
          return false;
        }
      );
    },
    (_, selectError) => {
      console.error('[Database] Error checking vocab context:', selectError);
      reject(selectError);
      return false;
    }
  );
};

export const recordVocabContext = ({
  word,
  hanja = null,
  definition = null,
  sentence = '',
  sourceBookUri = null,
  sourceBookTitle = null,
  seenAt = new Date().toISOString(),
  language = 'ko',
  force = false,
  ownerId = GUEST_OWNER_ID,
}) => {
  const cleanedWord = cleanValue(word);
  const cleanedSentence = cleanValue(sentence);
  const scopedOwnerId = resolveOwnerId(ownerId);

  return new Promise((resolve, reject) => {
    if (!cleanedWord || !cleanedSentence) {
      resolve(false);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, owner_id, word, hanja, def, level, language
         FROM vocab
         WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ? AND deleted_at IS NULL
         ORDER BY id ASC
         LIMIT 1`,
        [scopedOwnerId, cleanedWord, hanja ?? null, definition ?? null, language],
        (_, result) => {
          if (result.rows.length === 0) {
            resolve(false);
            return;
          }

          const row = result.rows.item(0);
          if (!force && isMasteredLevel(row.level)) {
            resolve(false);
            return;
          }

          upsertContextForVocabRow(tx, row, {
            sentence: cleanedSentence,
            sourceBookUri,
            sourceBookTitle,
            seenAt,
            language,
            ownerId: scopedOwnerId,
          }, resolve, reject);
        },
        (_, error) => {
          console.error(`[Database] Error finding vocab row for context "${cleanedWord}":`, error);
          reject(error);
          return false;
        }
      );
    });
  });
};

export const recordVocabContextForSurface = ({
  surface,
  sentence = '',
  sourceBookUri = null,
  sourceBookTitle = null,
  seenAt = new Date().toISOString(),
  language = 'ko',
  ownerId = GUEST_OWNER_ID,
}) => {
  const cleanedSurface = cleanValue(surface);
  const cleanedSentence = cleanValue(sentence);
  const scopedOwnerId = resolveOwnerId(ownerId);

  return new Promise((resolve, reject) => {
    if (!cleanedSurface || !cleanedSentence) {
      resolve(false);
      return;
    }

    db.transaction(tx => {
      const recordFirstAvailableRow = (rows) => {
        const row = rows.find((candidate) => !isMasteredLevel(candidate.level));
        if (!row) {
          resolve(false);
          return;
        }

        upsertContextForVocabRow(tx, row, {
          sentence: cleanedSentence,
            sourceBookUri,
            sourceBookTitle,
            seenAt,
            language,
          }, resolve, reject);
      };

      tx.executeSql(
        `SELECT id, owner_id, word, hanja, def, level, language
         FROM vocab
         WHERE owner_id = ? AND word = ? AND language = ? AND deleted_at IS NULL
         ORDER BY id ASC`,
        [scopedOwnerId, cleanedSurface, language],
        (_, exactResult) => {
          const exactRows = exactResult.rows._array ?? [];
          if (exactRows.length > 0) {
            recordFirstAvailableRow(exactRows);
            return;
          }

          if (!sourceBookUri) {
            resolve(false);
            return;
          }

          tx.executeSql(
            `SELECT v.id, v.owner_id, v.word, v.hanja, v.def, v.level, v.language
             FROM book_index bi
             JOIN dictionary_cache dc ON dc.id = bi.stem_id
             JOIN vocab v ON v.word = dc.stem
             WHERE bi.owner_id = ?
               AND v.owner_id = ?
               AND bi.book_uri = ?
               AND bi.surface = ?
               AND v.language = ?
               AND v.deleted_at IS NULL
             ORDER BY v.id ASC`,
            [scopedOwnerId, scopedOwnerId, sourceBookUri, cleanedSurface, language],
            (_, indexResult) => {
              recordFirstAvailableRow(indexResult.rows._array ?? []);
            },
            (_, indexError) => {
              console.error(`[Database] Error resolving context surface "${cleanedSurface}":`, indexError);
              reject(indexError);
              return false;
            }
          );
        },
        (_, exactError) => {
          console.error(`[Database] Error finding context surface "${cleanedSurface}":`, exactError);
          reject(exactError);
          return false;
        }
      );
    });
  });
};

export const getVocabContexts = (word, hanja, definition, limit = 12, language = 'ko', options = {}) => {
  const cleanedWord = cleanValue(word);
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    if (!cleanedWord) {
      resolve([]);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, owner_id, word, hanja, def, source_book_uri, source_book_title, context_sentence, created_at, language
         FROM vocab
         WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ? AND deleted_at IS NULL
         ORDER BY id ASC
         LIMIT 1`,
        [ownerId, cleanedWord, hanja ?? null, definition ?? null, language],
        (_, vocabResult) => {
          if (vocabResult.rows.length === 0) {
            resolve([]);
            return;
          }

          const vocabRow = vocabResult.rows.item(0);
          tx.executeSql(
            `SELECT sentence, source_book_uri, source_book_title, seen_at
             FROM vocab_contexts
             WHERE owner_id = ? AND vocab_id = ? AND language = ? AND deleted_at IS NULL
             ORDER BY datetime(seen_at) DESC, id DESC
             LIMIT ?`,
            [ownerId, vocabRow.id, language, limit],
            (_, contextResult) => {
              const rows = contextResult.rows._array ?? [];
              const contexts = rows.map((row) => ({
                sentence: row.sentence,
                sourceBookUri: row.source_book_uri,
                sourceBookTitle: row.source_book_title,
                seenAt: row.seen_at,
              }));

              const fallbackSentence = cleanValue(vocabRow.context_sentence);
              const hasFallback = fallbackSentence
                && !contexts.some((context) => cleanValue(context.sentence) === fallbackSentence);

              if (hasFallback && contexts.length < limit) {
                contexts.push({
                  sentence: fallbackSentence,
                  sourceBookUri: vocabRow.source_book_uri,
                  sourceBookTitle: vocabRow.source_book_title,
                  seenAt: vocabRow.created_at,
                });
              }

              contexts.sort((a, b) => (
                new Date(b.seenAt ?? 0).getTime() - new Date(a.seenAt ?? 0).getTime()
              ));

              resolve(contexts.slice(0, limit));
            },
            (_, contextError) => {
              console.error(`[Database] Error reading contexts for "${cleanedWord}":`, contextError);
              reject(contextError);
              return false;
            }
          );
        },
        (_, vocabError) => {
          console.error(`[Database] Error reading vocab row for contexts "${cleanedWord}":`, vocabError);
          reject(vocabError);
          return false;
        }
      );
    });
  });
};

export const getAllVocabContexts = (options = {}) => {
  const { includeDeleted = false } = options;
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, vocab_id, word, hanja, def, source_book_uri, source_book_title,
                sentence, seen_at, language, updated_at, deleted_at
         FROM vocab_contexts
         WHERE owner_id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}
         ORDER BY datetime(seen_at) DESC, id DESC`,
        [ownerId],
        (_, result) => resolve(result.rows._array ?? []),
        (_, error) => {
          console.error('[Database] Error reading all vocab contexts:', error);
          reject(error);
          return false;
        }
      );
    });
  });
};

export const insertVocabContextIfMissing = (context, options = {}) => {
  const cleanedWord = cleanValue(context?.word);
  const cleanedSentence = cleanValue(context?.sentence);
  const language = context?.language ?? 'ko';
  const definition = context?.def ?? context?.definition ?? null;
  const hanja = context?.hanja ?? null;
  const seenAt = context?.seen_at ?? context?.seenAt ?? new Date().toISOString();
  const updatedAt = context?.updated_at ?? context?.updatedAt ?? seenAt;
  const ownerId = resolveOwnerId(options.ownerId ?? context?.owner_id ?? context?.ownerId);

  return new Promise((resolve, reject) => {
    if (!cleanedWord || !cleanedSentence || context?.deleted_at || context?.deletedAt) {
      resolve(false);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, owner_id, word, hanja, def, level, language
         FROM vocab
         WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ? AND deleted_at IS NULL
         ORDER BY id ASC
         LIMIT 1`,
        [ownerId, cleanedWord, hanja, definition, language],
        (_, result) => {
          if (result.rows.length === 0) {
            resolve(false);
            return;
          }

          upsertContextForVocabRow(tx, result.rows.item(0), {
            sentence: cleanedSentence,
            sourceBookUri: context.source_book_uri ?? context.sourceBookUri ?? null,
            sourceBookTitle: context.source_book_title ?? context.sourceBookTitle ?? null,
            seenAt,
            updatedAt,
            language,
            ownerId,
          }, resolve, reject);
        },
        (_, error) => {
          console.error(`[Database] Error finding vocab row for cloud context "${cleanedWord}":`, error);
          reject(error);
          return false;
        }
      );
    });
  });
};

export const softDeleteVocabContextsForWord = (word, hanja, definition, language = 'ko', options = {}) => {
  const deletedAt = nowIso();
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE vocab_contexts
         SET deleted_at = ?, updated_at = ?
         WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ? AND deleted_at IS NULL`,
        [deletedAt, deletedAt, ownerId, word, hanja ?? null, definition ?? null, language],
        (_, result) => resolve(result.rowsAffected ?? 0),
        (_, error) => {
          console.error(`[Database] Error soft-deleting vocab contexts for "${word}":`, error);
          reject(error);
          return false;
        }
      );
    });
  });
};

export const getRelatedKnownWords = (word, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT related_known_words
         FROM vocab
         WHERE owner_id = ? AND word = ? AND language = ? AND deleted_at IS NULL
         ORDER BY id ASC
         LIMIT 1`,
        [ownerId, word, language],
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

export const addRelatedKnownWord = (word, relatedWord, options = {}) => {
  const markedAt = relatedWord?.markedAt ?? new Date().toISOString();
  const normalizedEntry = {
    korean: relatedWord?.korean ?? '',
    hanja: relatedWord?.hanja ?? '',
    meaning: relatedWord?.meaning ?? '',
    sourceHanja: relatedWord?.sourceHanja ?? '',
    markedAt,
    updatedAt: relatedWord?.updatedAt ?? markedAt,
  };
  const {
    createIfMissing = false,
    mainWord = {},
    language = mainWord.language ?? 'ko',
    ownerId = GUEST_OWNER_ID,
  } = options;
  const scopedOwnerId = resolveOwnerId(ownerId);
  const shouldScopeToEntry = (
    Object.prototype.hasOwnProperty.call(options, 'mainHanja')
    || Object.prototype.hasOwnProperty.call(options, 'mainDefinition')
    || Object.prototype.hasOwnProperty.call(mainWord, 'hanja')
    || Object.prototype.hasOwnProperty.call(mainWord, 'definition')
  );
  const mainHanja = options.mainHanja ?? mainWord.hanja ?? null;
  const mainDefinition = options.mainDefinition ?? mainWord.definition ?? null;

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        shouldScopeToEntry
          ? `SELECT id, related_known_words
             FROM vocab
             WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ? AND deleted_at IS NULL`
          : 'SELECT id, related_known_words FROM vocab WHERE owner_id = ? AND word = ? AND language = ? AND deleted_at IS NULL',
        shouldScopeToEntry
          ? [scopedOwnerId, word, mainHanja, mainDefinition, language]
          : [scopedOwnerId, word, language],
        (_, result) => {
          if (result.rows.length === 0) {
            if (!createIfMissing) {
              resolve([]);
              return;
            }

            const relatedKnownWordsJson = JSON.stringify([normalizedEntry]);
            tx.executeSql(
              `INSERT INTO vocab (
                owner_id, word, hanja, def, level, source_book_uri, source_book_title, context_sentence, is_favorite,
                priority, created_at, last_reviewed_at, next_review_at, correct_count, wrong_count,
                related_known_words, updated_at, deleted_at, language
              )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                scopedOwnerId,
                word,
                mainWord.hanja ?? null,
                mainWord.definition ?? null,
                mainWord.level ?? 'unorganized',
                mainWord.sourceBookUri ?? null,
                mainWord.sourceBookTitle ?? null,
                mainWord.contextSentence ?? null,
                mainWord.isFavorite ? 1 : 0,
                mainWord.priority ?? 'normal',
                mainWord.createdAt ?? new Date().toISOString(),
                mainWord.lastReviewedAt ?? null,
                mainWord.nextReviewAt ?? null,
                mainWord.correctCount ?? 0,
                mainWord.wrongCount ?? 0,
                relatedKnownWordsJson,
                mainWord.updatedAt ?? nowIso(),
                mainWord.deletedAt ?? null,
                language,
              ],
              () => resolve([normalizedEntry]),
              (_, insertError) => {
                console.error(`[Database] Error auto-saving vocab word "${word}" for related known word:`, insertError);
                reject(insertError);
                return false;
              }
            );
            return;
          }

          const firstKnownWords = parseRelatedKnownWords(result.rows.item(0).related_known_words);
          const normalizedKey = relatedKnownWordKey(normalizedEntry);
          const existingIndex = firstKnownWords.findIndex((entry) => relatedKnownWordKey(entry) === normalizedKey);
          const nextKnownWords = existingIndex >= 0
            ? firstKnownWords.map((entry, index) => (
                index === existingIndex ? { ...entry, ...normalizedEntry } : entry
              ))
            : [...firstKnownWords, normalizedEntry];
          const nextJson = JSON.stringify(nextKnownWords);

          for (let index = 0; index < result.rows.length; index += 1) {
            tx.executeSql(
              'UPDATE vocab SET related_known_words = ?, updated_at = ? WHERE id = ?',
              [nextJson, nowIso(), result.rows.item(index).id]
            );
          }

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

export const removeRelatedKnownWord = (word, relatedWord, language = 'ko', options = {}) => {
  const keyToRemove = relatedKnownWordKey(relatedWord);
  const ownerId = resolveOwnerId(options);
  const shouldScopeToEntry = (
    Object.prototype.hasOwnProperty.call(options, 'mainHanja')
    || Object.prototype.hasOwnProperty.call(options, 'mainDefinition')
  );
  const mainHanja = options.mainHanja ?? null;
  const mainDefinition = options.mainDefinition ?? null;

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        shouldScopeToEntry
          ? `SELECT id, related_known_words
             FROM vocab
             WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ? AND deleted_at IS NULL`
          : 'SELECT id, related_known_words FROM vocab WHERE owner_id = ? AND word = ? AND language = ? AND deleted_at IS NULL',
        shouldScopeToEntry
          ? [ownerId, word, mainHanja, mainDefinition, language]
          : [ownerId, word, language],
        (_, result) => {
          if (result.rows.length === 0) {
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
              'UPDATE vocab SET related_known_words = ?, updated_at = ? WHERE id = ?',
              [nextJson, nowIso(), result.rows.item(index).id]
            );
          }

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

export const getAllRelatedKnownWords = (options = {}) => {
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT word, hanja, def, related_known_words, language, updated_at
         FROM vocab
         WHERE owner_id = ?
           AND related_known_words IS NOT NULL
           AND related_known_words != ''
           AND related_known_words != '[]'
           AND deleted_at IS NULL`,
        [ownerId],
        (_, result) => {
          const relations = [];
          const rows = result.rows._array ?? [];

          rows.forEach((row) => {
            parseRelatedKnownWords(row.related_known_words).forEach((entry) => {
              const relatedWord = cleanValue(entry?.korean);
              if (!relatedWord) {
                return;
              }

              const markedAt = entry?.markedAt ?? row.updated_at ?? new Date().toISOString();
              relations.push({
                language: row.language ?? 'ko',
                mainWord: row.word,
                mainHanja: row.hanja ?? null,
                mainDefinition: row.def ?? null,
                relatedWord,
                relatedHanja: entry?.hanja ?? null,
                relatedDefinition: entry?.meaning ?? null,
                sourceHanja: entry?.sourceHanja ?? null,
                markedAt,
                updatedAt: entry?.updatedAt ?? markedAt,
              });
            });
          });

          resolve(relations);
        },
        (_, error) => {
          console.error('[Database] Error reading all related known words:', error);
          reject(error);
          return false;
        }
      );
    });
  });
};

export const addRelatedKnownWordForEntry = ({
  mainWord,
  mainHanja = null,
  mainDefinition = null,
  relatedWord,
  relatedHanja = null,
  relatedDefinition = null,
  sourceHanja = null,
  markedAt = new Date().toISOString(),
  updatedAt = markedAt,
  language = 'ko',
  ownerId = GUEST_OWNER_ID,
}) => {
  if (!mainWord || !relatedWord) {
    return Promise.resolve([]);
  }

  return addRelatedKnownWord(
    mainWord,
    {
      korean: relatedWord,
      hanja: relatedHanja,
      meaning: relatedDefinition,
      sourceHanja,
      markedAt,
      updatedAt,
    },
    {
      createIfMissing: true,
      ownerId,
      language,
      mainWord: {
        hanja: mainHanja,
        definition: mainDefinition,
        level: 'unorganized',
        language,
        createdAt: markedAt,
        updatedAt,
      },
    }
  );
};

export const removeRelatedKnownWordForEntry = ({
  mainWord,
  mainHanja = null,
  mainDefinition = null,
  relatedWord,
  relatedHanja = null,
  language = 'ko',
  ownerId = GUEST_OWNER_ID,
}) => {
  if (!mainWord || !relatedWord) {
    return Promise.resolve([]);
  }

  return removeRelatedKnownWord(
    mainWord,
    {
      korean: relatedWord,
      hanja: relatedHanja,
    },
    language,
    {
      ownerId,
      mainHanja,
      mainDefinition,
    }
  );
};

export const updateLevel = (word, hanja, definition, newLevel, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    const updatedAt = nowIso();
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE vocab
         SET level = ?, updated_at = ?
         WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ? AND deleted_at IS NULL`,
        [newLevel, updatedAt, ownerId, word, hanja, definition, language],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error updating level for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const updateFavorite = (word, hanja, definition, isFavorite, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    const updatedAt = nowIso();
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE vocab
         SET is_favorite = ?, updated_at = ?
         WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ? AND deleted_at IS NULL`,
        [isFavorite ? 1 : 0, updatedAt, ownerId, word, hanja, definition, language],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error updating favorite for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const updatePriority = (word, hanja, definition, priority, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    const updatedAt = nowIso();
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE vocab
         SET priority = ?, updated_at = ?
         WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ? AND deleted_at IS NULL`,
        [priority, updatedAt, ownerId, word, hanja, definition, language],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error updating priority for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

const addDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

export const recordReviewOutcome = (word, hanja, definition, currentLevel, outcome, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);
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
    const reviewedAt = nowIso();
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE vocab
         SET level = ?,
             last_reviewed_at = ?,
             next_review_at = ?,
             correct_count = COALESCE(correct_count, 0) + ?,
             wrong_count = COALESCE(wrong_count, 0) + ?,
             updated_at = ?
         WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ? AND deleted_at IS NULL`,
        [
          config.level,
          reviewedAt,
          config.nextReviewAt,
          config.correctInc,
          config.wrongInc,
          reviewedAt,
          ownerId,
          word,
          hanja,
          definition,
          language,
        ],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error recording review outcome for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const removeData = (word, hanja, definition, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'DELETE FROM vocab_contexts WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ?',
        [ownerId, word, hanja, definition, language]
      );
      tx.executeSql(
        'DELETE FROM vocab WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ?',
        [ownerId, word, hanja, definition, language],
        (_, result) => resolve(result),
        (_, error) => {
          console.error(`[Database] Error removing vocab word "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const wordExists = (word, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT COUNT(*) AS count FROM vocab WHERE owner_id = ? AND word = ? AND language = ? AND deleted_at IS NULL',
        [ownerId, word, language],
        (_, result) => {
          const { count } = result.rows.item(0);
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

export const getSavedWords = (options = {}) => {
  const normalizedOptions = typeof options === 'string' || options === null
    ? { language: options }
    : options;
  const { language = 'ko' } = normalizedOptions ?? {};
  const ownerId = resolveOwnerId(normalizedOptions);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      const sql = language == null
        ? 'SELECT DISTINCT word FROM vocab WHERE owner_id = ? AND deleted_at IS NULL'
        : 'SELECT DISTINCT word FROM vocab WHERE owner_id = ? AND language = ? AND deleted_at IS NULL';

      tx.executeSql(
        sql,
        language == null ? [ownerId] : [ownerId, language],
        (_, result) => {
          const words = result.rows._array.map(row => row.word).filter(Boolean);
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

export const viewData = (options = {}) => {
  const normalizedOptions = typeof options === 'string' || options === null
    ? { language: options }
    : options;
  const { includeDeleted = false, language = null } = normalizedOptions;
  const ownerId = resolveOwnerId(normalizedOptions);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      const whereClauses = ['owner_id = ?'];
      const params = [ownerId];

      if (!includeDeleted) {
        whereClauses.push('deleted_at IS NULL');
      }

      if (language != null) {
        whereClauses.push('language = ?');
        params.push(language);
      }

      tx.executeSql(
        `SELECT * FROM vocab WHERE ${whereClauses.join(' AND ')}`,
        params,
        (_, result) => {
          const data = result.rows._array;
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
        (_, result) => resolve(result.rows._array),
        (_, error) => {
          console.error(`[Database] Error retrieving vocab schema:`, error);
          reject(error);
        }
      );
    });
  });
};

export const deleteAllDataFromTable = (options = {}) => {
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(`DELETE FROM vocab_contexts WHERE owner_id = ?`, [ownerId]);
      tx.executeSql(
        `DELETE FROM vocab WHERE owner_id = ?`,
        [ownerId],
        () => resolve(),
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
      () => resolve()
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
    return rows[0] ?? null;
  });
};

export const lookupBookIndexBySurface = (ownerId, bookUri, surface) => {
  const scopedOwnerId = resolveOwnerId(ownerId);

  return new Promise((resolve, reject) => {
    if (!bookUri || !surface) {
      return resolve([]);
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT dc.id, dc.stem, dc.definition, dc.hanja, dc.pos, dc.domain
         FROM book_index bi
         JOIN dictionary_cache dc ON dc.id = bi.stem_id
         WHERE bi.owner_id = ? AND bi.book_uri = ? AND bi.surface = ?`,
        [scopedOwnerId, bookUri, surface],
        (_, result) => {
          resolve(result.rows._array);
        },
        (_, error) => {
          console.error('[Database] Error querying book_index by surface:', error);
          reject(error);
        }
      );
    });
  });
};

export const lookupBookHighlightSurfaces = (ownerId, bookUri, savedStems) => {
  const scopedOwnerId = resolveOwnerId(ownerId);

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
         WHERE bi.owner_id = ? AND bi.book_uri = ? AND dc.stem IN (${placeholders})`,
        [scopedOwnerId, bookUri, ...uniqueStems],
        (_, result) => {
          resolve(result.rows._array);
        },
        (_, error) => {
          console.error('[Database] Error querying highlight surfaces from book_index:', error);
          reject(error);
        }
      );
    });
  });
};

export const getBookPreprocessMeta = (ownerId, bookUri, preprocessVersion = PREPROCESS_VERSION) => {
  const scopedOwnerId = resolveOwnerId(ownerId);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      resolve(null);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT owner_id, book_uri, status, preprocess_version, started_at, completed_at, surface_count
         FROM book_preprocess_meta
         WHERE owner_id = ? AND book_uri = ? AND preprocess_version = ?
         LIMIT 1`,
        [scopedOwnerId, bookUri, preprocessVersion],
        (_, result) => {
          resolve(result.rows.length > 0 ? result.rows.item(0) : null);
        },
        (_, error) => {
          console.error(`[Database] Error reading preprocess meta for "${bookUri}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const markBookPreprocessMeta = ({
  ownerId = GUEST_OWNER_ID,
  bookUri,
  status = 'partial',
  surfaceCount = 0,
  preprocessVersion = PREPROCESS_VERSION,
  startedAt = new Date().toISOString(),
  completedAt = null,
}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      resolve();
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `INSERT OR REPLACE INTO book_preprocess_meta (
          owner_id, book_uri, status, preprocess_version, started_at, completed_at, surface_count
        )
         VALUES (?, ?, ?, ?, COALESCE(
           (SELECT started_at FROM book_preprocess_meta WHERE owner_id = ? AND book_uri = ? AND preprocess_version = ?),
           ?
         ), ?, ?)`,
        [
          scopedOwnerId,
          bookUri,
          status,
          preprocessVersion,
          scopedOwnerId,
          bookUri,
          preprocessVersion,
          startedAt,
          completedAt,
          surfaceCount,
        ],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error marking preprocess meta for "${bookUri}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const getBookPreprocessChapter = (
  ownerId,
  bookUri,
  spineIndex,
  preprocessVersion = PREPROCESS_VERSION
) => {
  const scopedOwnerId = resolveOwnerId(ownerId);

  return new Promise((resolve, reject) => {
    if (!bookUri || !Number.isInteger(spineIndex)) {
      resolve(null);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT owner_id, book_uri, spine_index, status, surface_count, completed_at, preprocess_version
         FROM book_preprocess_chapters
         WHERE owner_id = ? AND book_uri = ? AND spine_index = ? AND preprocess_version = ?
         LIMIT 1`,
        [scopedOwnerId, bookUri, spineIndex, preprocessVersion],
        (_, result) => {
          resolve(result.rows.length > 0 ? result.rows.item(0) : null);
        },
        (_, error) => {
          console.error(
            `[Database] Error reading preprocess chapter ${spineIndex} for "${bookUri}":`,
            error
          );
          reject(error);
        }
      );
    });
  });
};

export const getBookPreprocessChapters = (ownerId, bookUri, preprocessVersion = PREPROCESS_VERSION) => {
  const scopedOwnerId = resolveOwnerId(ownerId);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      resolve([]);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT owner_id, book_uri, spine_index, status, surface_count, completed_at, preprocess_version
         FROM book_preprocess_chapters
         WHERE owner_id = ? AND book_uri = ? AND preprocess_version = ?
         ORDER BY spine_index ASC`,
        [scopedOwnerId, bookUri, preprocessVersion],
        (_, result) => {
          resolve(result.rows._array);
        },
        (_, error) => {
          console.error(`[Database] Error reading preprocess chapters for "${bookUri}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const markBookPreprocessChapter = ({
  ownerId = GUEST_OWNER_ID,
  bookUri,
  spineIndex,
  status,
  surfaceCount = 0,
  preprocessVersion = PREPROCESS_VERSION,
  completedAt = null,
}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);

  return new Promise((resolve, reject) => {
    if (!bookUri || !Number.isInteger(spineIndex)) {
      resolve();
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `INSERT OR REPLACE INTO book_preprocess_chapters (
          owner_id, book_uri, spine_index, status, surface_count, completed_at, preprocess_version
        )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [scopedOwnerId, bookUri, spineIndex, status, surfaceCount, completedAt, preprocessVersion],
        () => resolve(),
        (_, error) => {
          console.error(
            `[Database] Error marking preprocess chapter ${spineIndex} for "${bookUri}":`,
            error
          );
          reject(error);
        }
      );
    });
  });
};

/**
 * isBookPreprocessed
 * Returns true only when the preprocess metadata says the current version
 * completed. Individual book_index rows can exist while the book is still
 * partially cached.
 *
 * @param {string} bookUri
 * @returns {Promise<boolean>}
 */
export const isBookPreprocessed = async (bookUri, options = {}) => {
  const meta = await getBookPreprocessMeta(resolveOwnerId(options), bookUri);
  return meta?.status === 'complete';
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
export const logDatabaseSnapshot = () => {};

export const insertBookIndexEntries = (bookUri, entries, options = {}) => {
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    if (!entries || entries.length === 0) {
      return resolve();
    }
    db.transaction(
      tx => {
        entries.forEach(({ surface, stem_id }) => {
          tx.executeSql(
            `INSERT OR IGNORE INTO book_index (owner_id, book_uri, surface, stem_id) VALUES (?, ?, ?, ?)`,
            [ownerId, bookUri, surface, stem_id]
          );
        });
      },
      (error) => {
        console.error(`[Database] Error inserting book_index for "${bookUri}":`, error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const deleteBookIndexEntries = (bookUri, options = {}) => {
  const ownerId = resolveOwnerId(options);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      resolve();
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        'DELETE FROM book_index WHERE owner_id = ? AND book_uri = ?',
        [ownerId, bookUri],
        () => {},
        (_, error) => {
          console.error(`[Database] Error deleting book_index rows for "${bookUri}":`, error);
          reject(error);
        }
      );
      tx.executeSql(
        'DELETE FROM book_preprocess_chapters WHERE owner_id = ? AND book_uri = ?',
        [ownerId, bookUri],
        () => {},
        (_, error) => {
          console.error(`[Database] Error deleting preprocess chapter rows for "${bookUri}":`, error);
          reject(error);
        }
      );
      tx.executeSql(
        'DELETE FROM book_preprocess_meta WHERE owner_id = ? AND book_uri = ?',
        [ownerId, bookUri],
        (_, result) => resolve(result.rowsAffected),
        (_, error) => {
          console.error(`[Database] Error deleting preprocess meta for "${bookUri}":`, error);
          reject(error);
        }
      );
    });
  });
};
