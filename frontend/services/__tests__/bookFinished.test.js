import {
  __resetBookFinished,
  announceBookFinished,
  isBookFinished,
  peekFinishedBook,
  subscribeBookFinished,
  takeFinishedBook,
} from '../bookFinished';

beforeEach(() => __resetBookFinished());

describe('isBookFinished', () => {
  it('counts a book read to the end, here or on another device', () => {
    expect(isBookFinished({ progress: 1 })).toBe(true);
    expect(isBookFinished({ progress: 0.4, finishedAt: '2026-11-09T00:00:00Z' })).toBe(true);
    expect(isBookFinished({ progress: 0.99 })).toBe(false);
    expect(isBookFinished(null)).toBe(false);
  });
});

describe('finished-book announcements', () => {
  it('holds the book for Home and hands it over once', () => {
    const listener = jest.fn();
    subscribeBookFinished(listener);
    announceBookFinished('file:///books/a.epub');
    expect(listener).toHaveBeenCalledWith('file:///books/a.epub');
    expect(peekFinishedBook()).toBe('file:///books/a.epub');
    expect(takeFinishedBook()).toBe('file:///books/a.epub');
    expect(takeFinishedBook()).toBe(null);
  });

  it('ignores an empty uri', () => {
    announceBookFinished(null);
    expect(takeFinishedBook()).toBe(null);
  });
});
