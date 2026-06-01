import { BASE_URL } from '../../config';

const readJson = async (response) => {
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || 'Song request failed');
    }

    return data;
};

export const searchSongs = async (query, limit = 12) => {
    const trimmed = String(query || '').trim();
    if (!trimmed) {
        return [];
    }

    const url = `${BASE_URL}/songs/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`;
    const data = await fetch(url).then(readJson);
    return Array.isArray(data.results) ? data.results : [];
};

export const getSongLyrics = async (songId) => {
    const url = `${BASE_URL}/songs/${encodeURIComponent(songId)}`;
    return fetch(url).then(readJson);
};
