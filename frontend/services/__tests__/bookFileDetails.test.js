import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { bookFileDetails } from '../bookFileDetails';

jest.mock('@react-native-async-storage/async-storage', () => {
    const store = new Map();
    return {
        __esModule: true,
        default: {
            getItem: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
            setItem: jest.fn(async (key, value) => { store.set(key, value); }),
            clear: () => store.clear(),
        },
    };
});

jest.mock('expo-file-system/legacy', () => ({
    getInfoAsync: jest.fn(),
}));

const BOOK = 'file:///docs/public-library/pride.epub';
const COVER = 'file:///docs/book-covers/abc.jpg';
const details = { cover: COVER, wordCount: 1200, metadata: { title: 'Pride' }, coverColors: { coverColor: '#123456' } };

// The files on the device: address → { size, modificationTime }.
let files;

beforeEach(() => {
    AsyncStorage.clear();
    jest.clearAllMocks();
    files = { [BOOK]: { size: 500, modificationTime: 10 }, [COVER]: { size: 9, modificationTime: 10 } };
    FileSystem.getInfoAsync.mockImplementation(async (uri) => (
        files[uri] ? { exists: true, ...files[uri] } : { exists: false }
    ));
});

describe('bookFileDetails', () => {
    it('reads a book once and reuses the answer while the file is the same', async () => {
        const read = jest.fn(async () => details);
        expect(await bookFileDetails({ key: 'en/pride.epub', uri: BOOK, read })).toEqual(details);
        expect(await bookFileDetails({ key: 'en/pride.epub', uri: BOOK, read })).toEqual(details);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('reads again when the file has changed', async () => {
        const read = jest.fn(async () => details);
        await bookFileDetails({ key: 'en/pride.epub', uri: BOOK, read });
        files[BOOK] = { size: 501, modificationTime: 11 };
        await bookFileDetails({ key: 'en/pride.epub', uri: BOOK, read });
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('reads again when the saved cover file is gone', async () => {
        const read = jest.fn(async () => details);
        await bookFileDetails({ key: 'en/pride.epub', uri: BOOK, read });
        delete files[COVER];
        await bookFileDetails({ key: 'en/pride.epub', uri: BOOK, read });
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('does not keep a read that found neither words nor a cover', async () => {
        const read = jest.fn(async () => ({ cover: null, wordCount: null, metadata: {} }));
        await bookFileDetails({ key: 'en/pride.epub', uri: BOOK, read });
        await bookFileDetails({ key: 'en/pride.epub', uri: BOOK, read });
        expect(read).toHaveBeenCalledTimes(2);
        expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it('shares one read between two requests made at the same time', async () => {
        const read = jest.fn(async () => details);
        const [first, second] = await Promise.all([
            bookFileDetails({ key: 'en/pride.epub', uri: BOOK, read }),
            bookFileDetails({ key: 'en/pride.epub', uri: BOOK, read }),
        ]);
        expect(first).toEqual(details);
        expect(second).toEqual(details);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('keeps books apart and passes a failed read on without saving it', async () => {
        const read = jest.fn(async () => details);
        await bookFileDetails({ key: 'en/pride.epub', uri: BOOK, read });
        files['file:///docs/public-library/emma.epub'] = { size: 500, modificationTime: 10 };
        const other = jest.fn(async () => { throw new Error('bad zip'); });
        await expect(bookFileDetails({ key: 'en/emma.epub', uri: 'file:///docs/public-library/emma.epub', read: other }))
            .rejects.toThrow('bad zip');
        expect(other).toHaveBeenCalledTimes(1);
        expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    });
});
