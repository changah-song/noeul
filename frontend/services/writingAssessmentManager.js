import { assessEntry } from './api/assessEntry';

// Owns in-flight writing assessments at module level so they survive the
// WritingCanvas unmounting. One assessment per entry id at a time: pressing
// Assess again (or re-entering the screen) reuses the same promise instead
// of firing another API call. The caller supplies a `persist` closure that
// saves the result (local + cloud) — it runs before listeners are notified,
// so subscribers always see the stored result.

const inflight = new Map(); // entryId -> promise of {status, result|error, body}
const listeners = new Set();

export const subscribeToAssessments = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const emit = (event) => {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.warn('[writingAssessmentManager] Listener error:', error);
    }
  });
};

export const isAssessmentInFlight = (entryId) => inflight.has(entryId);

export const getAssessmentPromise = (entryId) => inflight.get(entryId) ?? null;

export const startAssessment = ({ entryId, body, category, language = 'ko', prompt = '', persist }) => {
  if (inflight.has(entryId)) {
    return inflight.get(entryId);
  }

  const run = (async () => {
    try {
      const result = await assessEntry({ body, category, language, prompt });
      try {
        await persist?.(result ?? null);
      } catch (error) {
        console.warn('[writingAssessmentManager] Persist failed:', error);
      }
      emit({ type: 'success', entryId, result: result ?? null, body });
      return { status: 'success', result: result ?? null, body };
    } catch (error) {
      emit({ type: 'error', entryId, error, body });
      return { status: 'error', error, body };
    } finally {
      inflight.delete(entryId);
    }
  })();

  inflight.set(entryId, run);
  return run;
};
