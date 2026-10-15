import { translate } from '../../i18n/translations';
import {
  MAX_SONGS_STORAGE_BYTES,
  getSongStorageLimitMessage,
  isSongStorageLimitError,
  serializeSongsForStorage,
} from '../songStorageLimits';

const makeLimitError = () => {
  const huge = [{ lyrics: 'x'.repeat(MAX_SONGS_STORAGE_BYTES + 10) }];
  try {
    serializeSongsForStorage(huge);
  } catch (error) {
    return error;
  }
  throw new Error('expected a storage limit error');
};

describe('songStorageLimits', () => {
  test('limit error carries sizes for a translated message', () => {
    const error = makeLimitError();
    expect(isSongStorageLimitError(error)).toBe(true);
    expect(error.byteLength).toBeGreaterThan(MAX_SONGS_STORAGE_BYTES);
    expect(error.limitBytes).toBe(MAX_SONGS_STORAGE_BYTES);
  });

  test('message is rendered in the interface language, not English', () => {
    const error = makeLimitError();
    const ko = getSongStorageLimitMessage(error, (key, params) => translate('ko', key, params));
    expect(ko).toContain('4.0 MB');
    expect(ko).not.toMatch(/Saved songs|limit is/);
    expect(ko).toMatch(/[가-힣]/);

    const en = getSongStorageLimitMessage(error, (key, params) => translate('en', key, params));
    expect(en).toMatch(/^Saved songs would use \d+\.\d MB on this device; the limit is 4\.0 MB\.$/);
  });

  test('falls back to the generic message when sizes are missing', () => {
    const t = (key, params) => translate('fr', key, params);
    expect(getSongStorageLimitMessage({ code: 'SONG_STORAGE_LIMIT' }, t))
      .toBe(translate('fr', 'home.songStorageLimitFallback'));
  });
});
