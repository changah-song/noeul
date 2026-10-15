import { api } from './client';

// Song suggestions for the song editor: the backend searches LRCLIB (free,
// no key) by title / artist and, when a Genius token is configured on the
// server, by a line of lyrics too. Each result carries the full lyrics when
// the source has them, so one tap fills the editor; the reader can still edit
// or paste over it.
//
// Shape: [{ id, title, artist, album, duration, lyrics, synced }]
export const searchSongs = async ({ query, language = 'ko', timeout = 12000 } = {}) => {
  const cleaned = typeof query === 'string' ? query.trim() : '';
  if (cleaned.length < 2) {
    return [];
  }
  const response = await api.post(
    '/songs/search/',
    { query: cleaned, language },
    { timeout, headers: { 'Content-Type': 'application/json' } }
  );
  const results = response?.data?.results;
  return Array.isArray(results) ? results : [];
};
