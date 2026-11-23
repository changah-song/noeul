import { api } from './client';

// The song reader's player: the backend finds the song's YouTube video once
// (YouTube Data API, cached for every user) and hands back its id. The
// duration of the timed lyrics helps it pick the upload they were timed to.
//
// Shape: { id, title, channel, duration } or null when nothing fits.
export const findSongVideo = async ({ title, artist, duration, timeout = 15000 } = {}) => {
  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  if (!cleanTitle) {
    return null;
  }
  const response = await api.post(
    '/songs/video/',
    {
      title: cleanTitle,
      artist: typeof artist === 'string' ? artist.trim() : '',
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    },
    { timeout, headers: { 'Content-Type': 'application/json' } }
  );
  const video = response?.data?.video;
  return video && typeof video.id === 'string' ? video : null;
};
