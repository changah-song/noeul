import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Database Setup ───────────────────────────────────────────────────────────
// NOTE: Change the db filename here if you ever need to reset all tables by
// wiping the old database (e.g., rename to 'app_v2.db' to start fresh).
const db = SQLite.openDatabase('temp.db');
const BOOK_INDEX_MIGRATION_KEY = 'book_index_migration_v1';
const DICTIONARY_CACHE_MIGRATION_KEY = 'dictionary_cache_migration_v1';


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
          level TEXT
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
  await createDictionaryCacheTable();
  await migrateDictionaryCache();
  await migrateBookIndex();
  await createBookIndexTable();
  await deduplicateCacheTable();
  console.log("[Database] All tables ready");
};


// ─── Vocab Table Operations ───────────────────────────────────────────────────

export const insertData = (word, hanja, definition, level) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'INSERT INTO vocab (word, hanja, def, level) VALUES (?, ?, ?, ?)',
        [word, hanja, definition, level],
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

export const updateLevel = (word, hanja, definition, newLevel) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'UPDATE vocab SET level = ? WHERE word = ? AND hanja = ? AND def = ?',
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

export const removeData = (word, hanja, definition) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'DELETE FROM vocab WHERE word = ? AND hanja = ? AND def = ?',
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
 * Returns matching rows — caller builds a stem→entry map from the result.
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
    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, stem, definition, hanja, pos, domain
         FROM dictionary_cache WHERE stem IN (${placeholders})`,
        stems,
        (_, result) => {
          const rows = result.rows._array;
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
