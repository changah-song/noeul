jest.mock('../../services/Database', () => ({ logInteractionEvent: jest.fn().mockResolvedValue(1) }));

import { LOOKUP_ACTIONS, lookupDetailEvent } from '../useLookupDetail';

describe('lookupDetailEvent', () => {
    const openedAt = Date.UTC(2026, 10, 3, 10, 0, 0);

    it('records how long the card was open and what the reader did', () => {
        const event = lookupDetailEvent(
            { word: '喉咙', openedAt, actions: LOOKUP_ACTIONS.saved },
            openedAt + 7340,
            { ownerId: 'u1', language: 'zh', sourceBookUri: 'book://x' },
        );
        expect(event).toEqual({
            ownerId: 'u1', language: 'zh', sourceBookUri: 'book://x',
            word: '喉咙', eventType: 'lookup_detail', valueNum: 7.3, grade: 1,
            createdAt: '2026-11-03T10:00:00.000Z',
        });
    });

    it('caps a card left open and skips an empty one', () => {
        expect(lookupDetailEvent({ word: '的', openedAt, actions: 0 }, openedAt + 3600 * 1000).valueNum).toBe(600);
        expect(lookupDetailEvent(null, openedAt)).toBeNull();
        expect(lookupDetailEvent({ word: '', openedAt }, openedAt)).toBeNull();
    });
});
