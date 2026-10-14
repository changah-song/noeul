// The old expo-sqlite callback API (db.transaction / tx.executeSql), rebuilt on
// the current expo-sqlite.
//
// expo-sqlite 13 (Expo SDK 50) exposed a WebSQL-style API, and the app's
// database code is written against it. Newer expo-sqlite only has the
// promise API. Rather than rewrite every query, this module reproduces the
// old behavior on top of it:
//
// - Transactions run one at a time, in the order they were requested.
// - A write transaction is wrapped in BEGIN / END, and rolled back if a
//   statement fails and its error callback doesn't return false (or a
//   callback throws). The transaction's error callback then gets the error.
// - Statements queued from inside a success callback join the same
//   transaction.
// - Results look like WebSQL's: { insertId, rowsAffected, rows: { length,
//   item(i), _array } }.
// - Parameters bind the way the old Android module bound them: booleans as
//   the text 'true' / 'false' (existing rows hold those strings), undefined
//   as NULL.

const RETURNS_ROWS = /^\s*(SELECT|PRAGMA|WITH|EXPLAIN|VALUES)\b|\bRETURNING\b/i;

const noop = () => {};
const unhandled = () => true;

const bindValue = (value) => {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value;
};

// Match the old WebSQL insertId / rowsAffected quirks.
const toResultSet = (sql, { rows = [], insertId, rowsAffected = 0 }) => {
  let id = insertId;
  let affected = rowsAffected;
  if (/^\s*CREATE\s+TABLE\b/i.test(sql)) {
    id = 0;
    affected = 0;
  } else if (/^\s*DROP\s+TABLE\b/i.test(sql)) {
    id = undefined;
    affected = 0;
  } else if (!/^\s*INSERT\b/i.test(sql)) {
    id = undefined;
  }
  return {
    insertId: id,
    rowsAffected: affected,
    rows: {
      _array: rows,
      length: rows.length,
      item: (index) => rows[index],
    },
  };
};

// The driver runs one statement: (sql, params) => Promise<{ rows, insertId, rowsAffected }>.
export const createExpoDriver = (database) => async (sql, params) => {
  if (RETURNS_ROWS.test(sql)) {
    const rows = await database.getAllAsync(sql, params);
    return { rows, insertId: undefined, rowsAffected: 0 };
  }
  const { lastInsertRowId, changes } = await database.runAsync(sql, params);
  return { rows: [], insertId: lastInsertRowId, rowsAffected: changes };
};

export const createLegacyDatabase = (run) => {
  const queue = [];
  let running = false;

  const runTransaction = async ({ readOnly, callback, onError, onSuccess }) => {
    const pending = [];
    let failure = null;

    const tx = {
      executeSql(sql, args, onRowResult, onRowError) {
        pending.push({
          sql,
          params: (Array.isArray(args) ? args : []).map(bindValue),
          onResult: typeof onRowResult === 'function' ? onRowResult : noop,
          onError: typeof onRowError === 'function' ? onRowError : unhandled,
        });
      },
    };

    try {
      if (!readOnly) await run('BEGIN;', []);
      callback(tx);
      while (!failure && pending.length) {
        const statement = pending.shift();
        let result = null;
        let statementError = null;
        try {
          result = await run(statement.sql, statement.params);
        } catch (error) {
          statementError = error instanceof Error ? error : new Error(String(error));
        }
        if (statementError) {
          if (statement.onError(tx, statementError) !== false) {
            failure = statementError;
          }
        } else {
          statement.onResult(tx, toResultSet(statement.sql, result));
        }
      }
    } catch (error) {
      // A callback threw, or BEGIN failed.
      failure = failure || (error instanceof Error ? error : new Error(String(error)));
    }

    if (!readOnly) {
      try {
        await run(failure ? 'ROLLBACK;' : 'END;', []);
      } catch (error) {
        failure = failure || error;
      }
    }

    if (failure) {
      onError(failure);
    } else {
      onSuccess();
    }
  };

  const drain = async () => {
    if (running) return;
    running = true;
    while (queue.length) {
      const task = queue.shift();
      try {
        await runTransaction(task);
      } catch (error) {
        // The transaction's own error or success callback threw; keep the
        // queue moving so one bad callback can't stall every later query.
        console.warn('[legacySqlite] transaction callback threw', error);
      }
    }
    running = false;
  };

  const enqueue = (readOnly) => (callback, onError, onSuccess) => {
    if (typeof callback !== 'function') {
      throw new Error('The callback provided as parameter 1 is not a function.');
    }
    queue.push({
      readOnly,
      callback,
      onError: onError || noop,
      onSuccess: onSuccess || noop,
    });
    // Start on a later tick, like WebSQL, so callers finish their own setup first.
    Promise.resolve().then(drain);
  };

  return {
    transaction: enqueue(false),
    readTransaction: enqueue(true),
  };
};

// One queue per database file, however many times it's opened: two handles on
// the same connection must not interleave their BEGIN / END.
const openDatabases = new Map();

export const openLegacyDatabase = (name, openNative) => {
  if (!openDatabases.has(name)) {
    openDatabases.set(name, createLegacyDatabase(createExpoDriver(openNative(name))));
  }
  return openDatabases.get(name);
};

export const openDatabase = (name) =>
  // Required lazily so tests can use createLegacyDatabase without the native module.
  // eslint-disable-next-line global-require
  openLegacyDatabase(name, (fileName) => require('expo-sqlite').openDatabaseSync(fileName));
