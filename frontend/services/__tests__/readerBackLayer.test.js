import { readerBackLayer } from '../readerBackLayer';

describe('readerBackLayer', () => {
    it('closes nothing when no layer is up, so back leaves the book', () => {
        expect(readerBackLayer({})).toBeNull();
        expect(readerBackLayer()).toBeNull();
    });

    it('closes an open lookup panel (the word card or the AI explanation)', () => {
        expect(readerBackLayer({ lookupOpen: true })).toBe('lookup');
        expect(readerBackLayer({ lookupOpen: true, isFullscreen: true })).toBe('lookup');
    });

    it('closes the options dropdown before anything else', () => {
        expect(readerBackLayer({ showMenu: true, lookupOpen: true, isFullscreen: true })).toBe('menu');
    });

    it('drops fullscreen last', () => {
        expect(readerBackLayer({ isFullscreen: true })).toBe('fullscreen');
    });
});
