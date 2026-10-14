import { openDatabaseSync, __resetMockDatabases } from 'expo-sqlite';
import { createExpoDriver, createLegacyDatabase } from '../legacySqlite';

let db;
let counter = 0;

beforeEach(() => {
  __resetMockDatabases();
  counter += 1;
  db = createLegacyDatabase(createExpoDriver(openDatabaseSync(`legacy-${counter}.db`)));
});

const exec = (sql, args = []) =>
  new Promise((resolve, reject) => {
    db.transaction(
      (tx) => tx.executeSql(sql, args, (_, result) => resolve(result)),
      reject
    );
  });

const setup = () => exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT UNIQUE, flag)');

describe('legacy expo-sqlite adapter', () => {
  it('returns WebSQL-shaped results', async () => {
    await setup();
    const insert = await exec('INSERT INTO t (v) VALUES (?)', ['a']);
    expect(insert.insertId).toBe(1);
    expect(insert.rowsAffected).toBe(1);

    const select = await exec('SELECT v FROM t');
    expect(select.rows.length).toBe(1);
    expect(select.rows.item(0)).toEqual({ v: 'a' });
    expect(select.rows._array).toEqual([{ v: 'a' }]);
    expect(select.insertId).toBeUndefined();
  });

  it('rolls the whole transaction back when an error is not handled', async () => {
    await setup();
    const error = await new Promise((resolve, reject) => {
      db.transaction(
        (tx) => {
          tx.executeSql('INSERT INTO t (v) VALUES (?)', ['a']);
          tx.executeSql('INSERT INTO t (v) VALUES (?)', ['a']); // UNIQUE violation
        },
        resolve,
        () => reject(new Error('should have failed'))
      );
    });
    expect(error.message).toMatch(/UNIQUE/);
    expect((await exec('SELECT COUNT(*) AS n FROM t')).rows.item(0).n).toBe(0);
  });

  it('keeps going when the error callback returns false', async () => {
    await setup();
    await new Promise((resolve, reject) => {
      db.transaction(
        (tx) => {
          tx.executeSql('INSERT INTO t (v) VALUES (?)', ['a']);
          tx.executeSql('INSERT INTO t (v) VALUES (?)', ['a'], null, () => false);
          tx.executeSql('INSERT INTO t (v) VALUES (?)', ['b']);
        },
        reject,
        resolve
      );
    });
    expect((await exec('SELECT v FROM t ORDER BY v')).rows._array).toEqual([{ v: 'a' }, { v: 'b' }]);
  });

  it('runs statements queued from a success callback in the same transaction', async () => {
    await setup();
    await new Promise((resolve, reject) => {
      db.transaction(
        (tx) => {
          tx.executeSql('INSERT INTO t (v) VALUES (?)', ['a'], (innerTx, result) => {
            innerTx.executeSql('UPDATE t SET flag = ? WHERE id = ?', ['x', result.insertId]);
          });
        },
        reject,
        resolve
      );
    });
    expect((await exec('SELECT flag FROM t')).rows.item(0).flag).toBe('x');
  });

  it('rolls back when a callback throws', async () => {
    await setup();
    const error = await new Promise((resolve) => {
      db.transaction((tx) => {
        tx.executeSql('INSERT INTO t (v) VALUES (?)', ['a'], () => {
          throw new Error('boom');
        });
      }, resolve);
    });
    expect(error.message).toBe('boom');
    expect((await exec('SELECT COUNT(*) AS n FROM t')).rows.item(0).n).toBe(0);
  });

  it('runs transactions one at a time, in order', async () => {
    await setup();
    const order = [];
    await Promise.all(
      ['a', 'b', 'c'].map(
        (v) =>
          new Promise((resolve, reject) => {
            db.transaction(
              (tx) => tx.executeSql('INSERT INTO t (v) VALUES (?)', [v], () => order.push(v)),
              reject,
              resolve
            );
          })
      )
    );
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('binds booleans as the text the old Android module stored, and undefined as NULL', async () => {
    await setup();
    await exec('INSERT INTO t (v, flag) VALUES (?, ?)', ['a', true]);
    await exec('INSERT INTO t (v, flag) VALUES (?, ?)', ['b', undefined]);
    const rows = (await exec('SELECT v, flag FROM t ORDER BY v')).rows._array;
    expect(rows).toEqual([
      { v: 'a', flag: 'true' },
      { v: 'b', flag: null },
    ]);
    expect((await exec('SELECT v FROM t WHERE flag = ?', [true])).rows.length).toBe(1);
  });
});
