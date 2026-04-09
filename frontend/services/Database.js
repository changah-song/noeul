import * as SQLite from 'expo-sqlite';

// need to change so that i don't have to change db everytime i change table layout...
const db = SQLite.openDatabase('temp.db');

export const createTable = () => {
  return new Promise ((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE
          IF NOT EXISTS vocab (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT,
            hanja TEXT,
            def TEXT,
            level TEXT)`,
        [],
        () => {
          console.log("[Database] Table created successfully!");
          resolve();
        },
        (_, error) => {
          console.log("[Database] Error creating table:", error);
          reject(error);
        }
      );
    });
  });
};

export const insertData = (word, hanja, definition, level) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'INSERT INTO vocab (word, hanja, def, level) VALUES (?, ?, ?, ?)',
        [word, hanja, definition, level],
        () => {
          console.log(`[Database] Inserted word: "${word}" | hanja: "${hanja}" | level: "${level}"`);
          resolve();
        },
        (_, error) => {
          console.error(`[Database] Error inserting word "${word}":`, error);
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
          console.log(`[Database] Updated level for "${word}" to "${newLevel}"`);
          resolve();
        },
        (_, error) => {
          console.log(`[Database] Error updating level for "${word}":`, error);
          reject(error);
        }
      )
    })
  })
}

export const removeData = (word, hanja, definition) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'DELETE FROM vocab WHERE word = ? AND hanja = ? AND def = ?',
        [word, hanja, definition],
        (_, result) => {
          console.log(`[Database] Removed "${word}" (hanja: "${hanja}", def: "${definition}")`);
          resolve(result);
        },
        (_, error) => {
          console.error(`[Database] Error removing "${word}" (hanja: "${hanja}", def: "${definition}"):`, error);
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
          const {count} = result.rows.item(0);
          console.log(`[Database] wordExists("${word}"): ${count > 0}`);
          resolve(count > 0);
        },
        (_, error) => {
          console.error(`[Database] Error checking if "${word}" exists:`, error);
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
              console.error(`[Database] Error retrieving schema for vocab table:`, error);
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
              console.error(`[Database] Error deleting all data from vocab table:`, error);
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
            console.error('[Database] Error fetching data:', error);
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
