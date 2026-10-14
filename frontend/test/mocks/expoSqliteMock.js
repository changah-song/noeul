/**
 * Jest mock for `expo-sqlite`, backed by a real in-memory SQLite engine
 * (better-sqlite3).
 *
 * Why back it with a real engine instead of a hand-rolled fake:
 * the behavior we most want to test — e.g. that re-inserting the same
 * `client_event_id` is a genuine no-op — depends on SQLite actually enforcing a
 * UNIQUE index and honoring `INSERT OR IGNORE`. A fake that just pushed rows into
 * an array would only test the fake, not our SQL.
 *
 * It implements the slice of the current expo-sqlite API that
 * services/legacySqlite.js uses (openDatabaseSync → getAllAsync / runAsync), so
 * tests run the app's real callback-API adapter on top of it. `openDatabase` is
 * that adapter, for tests that open a database directly.
 */

const BetterSqlite3 = require('better-sqlite3');
const { openLegacyDatabase } = require('../../services/legacySqlite');

// One in-memory database per filename, cached so repeated opens share state.
const databases = new Map();

const getEngine = (name) => {
  if (!databases.has(name)) {
    databases.set(name, new BetterSqlite3(':memory:'));
  }
  return databases.get(name);
};

// The handle resolves its engine by name per call, not once at open time.
// Database.js opens its db at module load and never re-opens; resolving lazily
// lets __resetMockDatabases() swap in a fresh engine between tests while that
// long-lived handle keeps working.
const openDatabaseSync = (name = ':memory:') => ({
  async getAllAsync(sql, params = []) {
    const statement = getEngine(name).prepare(sql);
    if (!statement.reader) {
      statement.run(...params);
      return [];
    }
    return statement.all(...params);
  },
  async runAsync(sql, params = []) {
    const info = getEngine(name).prepare(sql).run(...params);
    return { lastInsertRowId: Number(info.lastInsertRowid), changes: info.changes };
  },
});

const openDatabase = (name = ':memory:') => openLegacyDatabase(name, openDatabaseSync);

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
  openDatabaseSync,
  openDatabase,
  __resetMockDatabases,
};
