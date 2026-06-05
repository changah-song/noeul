/**
 * preprocessBook.js
 *
 * Starts a background preprocessing job and polls until it finishes.
 *
 * After this call returns, the caller is responsible for:
 *   - Inserting results into the local dictionary_cache via insertCacheEntries()
 *   - Building and inserting book_index rows via insertBookIndexEntries()
 */

import axios from 'axios';
import { BASE_URL } from '../../config';

/**
 * preprocessBook
 * Sends raw book text to POST /preprocess_book/ and returns the results.
 *
 * @param {object} params
 * @param {string} params.text - Raw extracted text from the full EPUB
 *
 * @returns {Promise<{
 *   results: Array<{stem: string, definition: string, hanja: string, pos: string}>,
 *   stats:   {total_stems: number, cache_hits: number, new_fetched: number},
 *   surface_index: Array<{surface: string, stem: string}>,
 *   networkError: boolean,
 *   errorMessage?: string
 * }>}
 * Returns { results: [], stats: {}, surface_index: [] } on failure so callers don't need to null-check.
 */
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 8000;
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ERRORS = 4;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const startPreprocessBookJob = async ({ text }) => {
  const response = await axios.post(
    `${BASE_URL}/preprocess_book/`,
    {
      text,
    },
    {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  return response.data;
};

const getPreprocessStatus = async (jobId) => {
  const response = await axios.get(`${BASE_URL}/preprocess_status/${jobId}`, {
    timeout: 30000,
  });

  return response.data;
};

const preprocessBook = async ({ text, onStatus, _attempt = 1 }) => {
  if (!text || text.trim() === '') {
    return { results: [], stats: {}, surface_index: [], networkError: false };
  }

  try {
    const { job_id: jobId, status } = await startPreprocessBookJob({ text });
    onStatus?.({ status, stage: 'queued', message: 'Job queued' });

    let consecutivePollErrors = 0;

    while (true) {
      await sleep(POLL_INTERVAL_MS);

      try {
        const job = await getPreprocessStatus(jobId);
        consecutivePollErrors = 0;
        onStatus?.(job);

        if (job.status === 'completed') {
          const { results = [], stats = {}, surface_index = [] } = job;
          return { results, stats, surface_index, networkError: false };
        }

        if (job.status === 'failed') {
          console.error(`[preprocessBook] Job failed -> ${job.error ?? 'unknown error'}`);
          return {
            results: [],
            stats: {},
            surface_index: [],
            networkError: false,
            errorMessage: job.error ?? job.message ?? 'Preprocessing failed',
          };
        }
      } catch (pollError) {
        const isNetworkPollError = !pollError.response;
        if (!isNetworkPollError) {
          console.error('[preprocessBook] Polling failed with backend error:', pollError.response?.data);
          return {
            results: [],
            stats: {},
            surface_index: [],
            networkError: false,
            errorMessage: pollError.response?.data?.detail ?? 'Status polling failed',
          };
        }

        consecutivePollErrors += 1;
        console.warn(`[preprocessBook] Poll network error (${consecutivePollErrors}/${MAX_POLL_ERRORS})`);
        if (consecutivePollErrors >= MAX_POLL_ERRORS) {
          return {
            results: [],
            stats: {},
            surface_index: [],
            networkError: true,
            errorMessage: pollError.message,
          };
        }
      }
    }

  } catch (error) {
    const isNetworkError = !error.response; // no response = connection dropped or timed out

    if (isNetworkError && _attempt <= MAX_RETRIES) {
      console.warn(`[preprocessBook] Network error on attempt ${_attempt} — retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await sleep(RETRY_DELAY_MS);
      return preprocessBook({ text, onStatus, _attempt: _attempt + 1 });
    }

    if (error.code === 'ECONNABORTED') {
      console.error('[preprocessBook] Request timed out after all retries');
    } else if (error.response) {
      console.error(`[preprocessBook] Backend error ${error.response.status}:`, error.response.data);
    } else {
      console.error(`[preprocessBook] Network error after ${_attempt} attempt(s):`, error.message);
    }
    return {
      results: [],
      stats: {},
      surface_index: [],
      networkError: isNetworkError,
      errorMessage: error.response?.data?.detail ?? error.message,
    };
  }
};

export default preprocessBook;
