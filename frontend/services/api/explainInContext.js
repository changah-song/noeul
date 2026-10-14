import { BASE_URL } from '../../config';
import { api, getAccessToken } from './client';

const buildExplainBody = ({
  word,
  sentence,
  language,
  interfaceLanguage,
  pKnown,
  hanja,
  anchorWords,
  dictionary,
  lemma,
}) => ({
  word,
  sentence,
  language,
  interface_language: interfaceLanguage,
  // Only include grounding fields that are actually present, so we never send
  // nulls that would look like deliberate "no signal" values.
  ...(Number.isFinite(pKnown) ? { p_known: pKnown } : {}),
  ...(hanja ? { hanja } : {}),
  ...(Array.isArray(anchorWords) && anchorWords.length ? { anchor_words: anchorWords } : {}),
  ...(dictionary ? { dictionary } : {}),
  // The dictionary form the lookup panel resolved (e.g. 눕다 for 누워). The
  // backend uses it as the base form instead of guessing its own, so the
  // explanation and the panel heading always agree. Older backends ignore it.
  ...(lemma ? { lemma } : {}),
});

export const explainInContext = async ({
  word,
  sentence,
  language,
  interfaceLanguage,
  // Optional grounding for the agentic (EXPLAIN_USE_GRAPH) backend workflow. All
  // omittable — the backend degrades to an ungrounded explanation when absent.
  pKnown,
  hanja,
  anchorWords,
  // The dictionary result the panel already fetched on-device, reused to ground
  // the explanation (no re-query). Shape: { found: boolean, senses: [{ headword,
  // pos, definition }] }. Omittable — absent means "no dictionary signal".
  dictionary,
  // The lookup's dictionary form for the tapped word, when it has one.
  lemma,
  timeout = 30000,
} = {}) => {
  const response = await api.post(
    '/explain_in_context/',
    buildExplainBody({ word, sentence, language, interfaceLanguage, pKnown, hanja, anchorWords, dictionary, lemma }),
    {
      timeout,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  return response.data;
};

// Incremental reader for a newline-delimited JSON body. `feed` takes the WHOLE
// response text received so far (what XMLHttpRequest.responseText holds) and
// calls `onEvent` once for each newly completed line. Partial trailing lines
// wait for the next feed; malformed lines are skipped.
export const createNdjsonReader = (onEvent) => {
  let offset = 0;
  return {
    feed(text) {
      if (typeof text !== 'string') return;
      let newline = text.indexOf('\n', offset);
      while (newline !== -1) {
        const line = text.slice(offset, newline).trim();
        offset = newline + 1;
        if (line) {
          let event = null;
          try {
            event = JSON.parse(line);
          } catch (parseError) {
            event = null;
          }
          if (event && typeof event === 'object') {
            onEvent(event);
          }
        }
        newline = text.indexOf('\n', offset);
      }
    },
  };
};

const STREAM_PATH = '/explain_in_context/stream/';

// Streaming variant used by the lookup panel. Calls `onGloss(gloss)` once the
// short flashcard label is ready and `onText(explanationSoFar)` as explanation
// text arrives, then resolves with the same object `explainInContext` returns.
//
// RN 0.73's fetch can't stream, but XMLHttpRequest delivers the body
// incrementally through progress events. If the stream endpoint is missing (an
// older backend), errors out, or the request fails, this falls back to the plain
// JSON endpoint — which also brings axios' 401-refresh and 5xx-retry handling.
export const streamExplainInContext = async ({
  onGloss,
  onText,
  timeout = 30000,
  ...params
} = {}) => {
  const body = buildExplainBody(params);
  const fallback = () => explainInContext({ ...params, timeout });

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (authError) {
    return fallback();
  }

  const streamed = await new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let explanation = '';
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const reader = createNdjsonReader((event) => {
      if (settled) return;
      if (event.type === 'gloss' && event.gloss) {
        onGloss?.(event.gloss);
      } else if (event.type === 'delta' && typeof event.text === 'string') {
        explanation += event.text;
        onText?.(explanation);
      } else if (event.type === 'done' && event.result) {
        finish({ ok: true, result: event.result });
        xhr.abort();
      } else if (event.type === 'error') {
        finish({ ok: false });
        xhr.abort();
      }
    });

    const consume = () => {
      if (xhr.status && xhr.status !== 200) {
        finish({ ok: false });
        xhr.abort();
        return;
      }
      reader.feed(xhr.responseText);
    };

    xhr.onprogress = consume;
    xhr.onreadystatechange = () => {
      // From HEADERS_RECEIVED on: a non-200 status bails out to the fallback
      // without waiting for the error body.
      if (xhr.readyState >= 2) consume();
      if (xhr.readyState === 4) finish({ ok: false });
    };
    xhr.onerror = () => finish({ ok: false });
    xhr.ontimeout = () => finish({ ok: false, timedOut: true });

    xhr.open('POST', `${BASE_URL}${STREAM_PATH}`);
    xhr.responseType = 'text';
    xhr.timeout = timeout;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.send(JSON.stringify(body));
  });

  if (streamed.ok) {
    return streamed.result;
  }
  if (streamed.timedOut) {
    throw new Error('Request timed out');
  }
  return fallback();
};
