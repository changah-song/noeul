/**
 * markBookPreprocessChapter stores which pieces of a long chapter are done
 * (piece_progress) against the in-memory SQLite mock, and a later write that
 * leaves it out (the 'processing' mark) keeps it.
 */

jest.mock('../hanjaDatabase', () => ({
    initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
    createBookPreprocessTables,
    getBookPreprocessChapter,
    markBookPreprocessChapter,
    migrateBookPreprocessPieceProgress,
} from '../Database';
import { parsePieceProgress } from '../preprocessPieces';

const { __resetMockDatabases } = SQLite;
const OWNER = 'owner-1';
const BOOK = 'book-1';

beforeEach(async () => {
    __resetMockDatabases();
    await createBookPreprocessTables();
    await migrateBookPreprocessPieceProgress();
});

it('stores the done pieces with the chapter', async () => {
    await markBookPreprocessChapter({
        ownerId: OWNER,
        bookUri: BOOK,
        spineIndex: 3,
        status: 'partial',
        surfaceCount: 12,
        pieceProgress: { count: 5, done: [0, 1] },
    });

    const chapter = await getBookPreprocessChapter(OWNER, BOOK, 3);
    expect(chapter.status).toBe('partial');
    expect(chapter.surface_count).toBe(12);
    expect(parsePieceProgress(chapter.piece_progress)).toEqual({ count: 5, done: [0, 1] });
});

it('keeps the done pieces through a write that leaves them out', async () => {
    await markBookPreprocessChapter({
        ownerId: OWNER,
        bookUri: BOOK,
        spineIndex: 3,
        status: 'partial',
        pieceProgress: { count: 5, done: [0] },
    });
    await markBookPreprocessChapter({
        ownerId: OWNER,
        bookUri: BOOK,
        spineIndex: 3,
        status: 'processing',
    });

    const chapter = await getBookPreprocessChapter(OWNER, BOOK, 3);
    expect(chapter.status).toBe('processing');
    expect(parsePieceProgress(chapter.piece_progress)).toEqual({ count: 5, done: [0] });
});

it('adds the column to a table made before it existed', async () => {
    __resetMockDatabases();
    const db = SQLite.openDatabase('fluentfable.db');
    await new Promise((resolve, reject) => {
        db.transaction((tx) => {
            tx.executeSql(
                `CREATE TABLE book_preprocess_chapters (
                    owner_id TEXT NOT NULL DEFAULT 'guest',
                    profile_id TEXT DEFAULT 'ko_default',
                    book_uri TEXT NOT NULL,
                    spine_index INTEGER NOT NULL,
                    status TEXT,
                    surface_count INTEGER DEFAULT 0,
                    book_level TEXT,
                    book_level_rank INTEGER,
                    book_level_system TEXT,
                    book_level_source TEXT,
                    book_level_stats TEXT,
                    completed_at TEXT,
                    preprocess_version INTEGER,
                    PRIMARY KEY (owner_id, profile_id, book_uri, spine_index, preprocess_version)
                )`
            );
        }, reject, resolve);
    });

    await migrateBookPreprocessPieceProgress();
    await markBookPreprocessChapter({
        ownerId: OWNER,
        bookUri: BOOK,
        spineIndex: 0,
        status: 'complete',
        pieceProgress: { count: 1, done: [0] },
    });

    const chapter = await getBookPreprocessChapter(OWNER, BOOK, 0);
    expect(parsePieceProgress(chapter.piece_progress)).toEqual({ count: 1, done: [0] });
});
