/**
 * Jest mock for `expo-sqlite`, backed by a real in-memory SQLite engine
 * (better-sqlite3).
 *
 * Why back it with a real engine instead of a hand-rolled fake:
 * the behavior we most want to test in Phase 1 — that re-inserting the same
 * `client_event_id` is a genuine no-op — depends on SQLite actually enforcing a
 * UNIQUE index and honoring `INSERT OR IGNORE`. A fake that just pushed rows into
 * an array would only test the fake, not our SQL. Running the exact SQL against a
 * real engine tests the schema for real.
 *
 * This shim reproduces the small slice of expo-sqlite's WebSQL-style API that
 * Database.js uses:
 *   const db = SQLite.openDatabase(name);
 *   db.transaction(txCallback, errorCallback, successCallback);
 *   tx.executeSql(sql, params, onSuccess, onError);
 *     -> onSuccess(tx, { rows: { _array, length, item }, rowsAffected, insertId })
 */

const BetterSqlite3 = require('better-sqlite3');

// One in-memory database per filename, cached so repeated openDatabase(name)
// calls (Database.js opens once at module load) share the same state.
const databases = new Map();

const makeResultSet = (rows, runInfo) => ({
  rows: {
    _array: rows,
    length: rows.length,
    item: (index) => rows[index],
  },
  rowsAffected: runInfo ? runInfo.changes : 0,
  insertId: runInfo ? runInfo.lastInsertRowid : undefined,
});

// better-sqlite3 rejects `undefined` binds; our callers pass explicit nulls, but
// normalize defensively so a stray undefined doesn't crash the whole transaction.
const normalizeParams = (params) =>
  (Array.isArray(params) ? params : []).map((value) =>
    value === undefined ? null : value
  );

const isReadStatement = (sql) => /^\s*(select|pragma)/i.test(sql);

const createExecuteSql = (engine) => (sql, params, onSuccess, onError) => {
  try {
    const statement = engine.prepare(sql);
    const boundParams = normalizeParams(params);

    if (isReadStatement(sql)) {
      const rows = statement.all(...boundParams);
      onSuccess && onSuccess(tx, makeResultSet(rows, null));
    } else {
      const info = statement.run(...boundParams);
      onSuccess && onSuccess(tx, makeResultSet([], info));
    }
    return true;
  } catch (error) {
    // WebSQL semantics: if a statement error handler is present it may swallow the
    // error; otherwise the error propagates to the transaction error callback.
    if (onError) {
      return onError(tx, error);
    }
    throw error;
  }
};

// `tx` is assigned per transaction below; executeSql references it lazily (only
// when called), by which point the current transaction has set it.
let tx;

const getEngine = (name) => {
  if (!databases.has(name)) {
    databases.set(name, new BetterSqlite3(':memory:'));
  }
  return databases.get(name);
};

// The handle resolves its engine by name *per transaction*, not once at open time.
// Database.js captures its db handle at module load and never re-opens; resolving
// lazily lets __resetMockDatabases() swap in a fresh engine between tests while
// that long-lived handle keeps working.
const makeDatabase = (name) => ({
  transaction(txCallback, errorCallback, successCallback) {
    tx = { executeSql: createExecuteSql(getEngine(name)) };
    try {
      txCallback(tx);
      successCallback && successCallback();
    } catch (error) {
      if (errorCallback) {
        errorCallback(error);
      } else {
        throw error;
      }
    }
  },
});

const openDatabase = (name = ':memory:') => makeDatabase(name);

/**
 * Test helper (not part of the real expo-sqlite API): wipe all in-memory
 * databases so each test starts from a clean schema.
 */
const __resetMockDatabases = () => {
  for (const engine of databases.values()) {
    engine.close();
  }
  databases.clear();
};

module.exports = {
  openDatabase,
  __resetMockDatabases,
};
