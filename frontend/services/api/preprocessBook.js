/**
 * preprocessBook.js
 *
 * Sends a book's raw extracted text to the backend for full preprocessing:
 *   1. Backend stems the entire text with Okt
 *   2. Backend checks its server-side cache for already-known stems
 *   3. Backend fetches missing stems from KRDICT
 *   4. Backend returns {stem, hanja, definition, pos} for every unique stem
 *
 * After this call returns, the caller is responsible for:
 *   - Inserting results into the local dictionary_cache via insertCacheEntries()
 *   - Building and inserting book_index rows via insertBookIndexEntries()
 */

import axios from 'axios';
import { KOREAN_DICTIONARY_CLIENT_ID } from '@env';

// Same base URL as stemWord.js — change here if the backend address changes
const BASE_URL = 'http://10.0.2.2:8000';

/**
 * preprocessBook
 * Sends raw book text to POST /preprocess_book/ and returns the results.
 *
 * @param {object} params
 * @param {string} params.text - Raw extracted text from the full EPUB
 *
 * @returns {Promise<{
 *   results: Array<{stem: string, definition: string, hanja: string, pos: string}>,
 *   stats:   {total_stems: number, cache_hits: number, new_fetched: number}
 * }>}
 * Returns { results: [], stats: {} } on failure so callers don't need to null-check.
 */
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 8000;

const preprocessBook = async ({ text, _attempt = 1 }) => {
  if (!text || text.trim() === '') {
    console.log('[preprocessBook] Called with empty text — skipping');
    return { results: [], stats: {}, networkError: false };
  }

  console.log(`[preprocessBook] Starting preprocessing | text length: ${text.length.toLocaleString()} chars${_attempt > 1 ? ` | attempt ${_attempt}/${MAX_RETRIES + 1}` : ''}`);

  try {
    const response = await axios.post(
      `${BASE_URL}/preprocess_book/`,
      {
        text,
        krdict_key: KOREAN_DICTIONARY_CLIENT_ID,
      },
      {
        timeout: 10 * 60 * 1000, // 10 minutes — uncapped books can be large
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const { results = [], stats = {} } = response.data;
    console.log(
      `[preprocessBook] Done — ${results.length} stems returned | ` +
      `cache_hits: ${stats.cache_hits}, new_fetched: ${stats.new_fetched}`
    );
    return { results, stats, networkError: false };

  } catch (error) {
    const isNetworkError = !error.response; // no response = connection dropped or timed out

    if (isNetworkError && _attempt <= MAX_RETRIES) {
      console.warn(`[preprocessBook] Network error on attempt ${_attempt} — retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      return preprocessBook({ text, _attempt: _attempt + 1 });
    }

    if (error.code === 'ECONNABORTED') {
      console.error('[preprocessBook] Request timed out after all retries');
    } else if (error.response) {
      console.error(`[preprocessBook] Backend error ${error.response.status}:`, error.response.data);
    } else {
      console.error(`[preprocessBook] Network error after ${_attempt} attempt(s):`, error.message);
    }
    return { results: [], stats: {}, networkError: isNetworkError };
  }
};

export default preprocessBook;
