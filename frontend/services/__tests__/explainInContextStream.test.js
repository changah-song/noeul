jest.mock('../api/client', () => ({
  api: { post: jest.fn() },
  getAccessToken: jest.fn(async () => 'test-token'),
  INTERFACE_LANGUAGE_HEADER: 'X-Interface-Language',
}));
jest.mock('../../config', () => ({ BASE_URL: 'https://api.test' }));

import { api, getAccessToken } from '../api/client';
import { createNdjsonReader, streamExplainInContext } from '../api/explainInContext';

// Minimal XMLHttpRequest stand-in: the test drives it by pushing body chunks.
class FakeXhr {
  static last = null;

  constructor() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.headers = {};
    this.aborted = false;
    FakeXhr.last = this;
  }

  open(method, url) {
    this.method = method;
    this.url = url;
    this.readyState = 1;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  send(body) {
    this.body = JSON.parse(body);
  }

  abort() {
    this.aborted = true;
  }

  respond(status) {
    this.status = status;
    this.readyState = 2;
    this.onreadystatechange?.();
  }

  push(chunk) {
    this.responseText += chunk;
    this.readyState = 3;
    this.onprogress?.();
    this.onreadystatechange?.();
  }

  end() {
    this.readyState = 4;
    this.onreadystatechange?.();
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const line = (event) => `${JSON.stringify(event)}\n`;

beforeEach(() => {
  global.XMLHttpRequest = FakeXhr;
  api.post.mockReset();
  getAccessToken.mockClear();
});

describe('createNdjsonReader', () => {
  it('emits each completed line once and waits for partial lines', () => {
    const events = [];
    const reader = createNdjsonReader((event) => events.push(event));
    reader.feed('{"type":"gloss","gloss":"to lie down"}\n{"type":"de');
    expect(events).toEqual([{ type: 'gloss', gloss: 'to lie down' }]);
    reader.feed('{"type":"gloss","gloss":"to lie down"}\n{"type":"delta","text":"Here"}\nnot json\n');
    expect(events).toEqual([
      { type: 'gloss', gloss: 'to lie down' },
      { type: 'delta', text: 'Here' },
    ]);
  });
});

describe('streamExplainInContext', () => {
  const params = {
    word: '누워',
    sentence: '그는 침대에 누워 책을 읽었다.',
    language: 'ko',
    interfaceLanguage: 'en',
    lemma: '눕다',
  };

  it('streams gloss and text, then resolves with the final result', async () => {
    const onGloss = jest.fn();
    const onText = jest.fn();
    const pending = streamExplainInContext({ ...params, onGloss, onText });
    await flush();

    const xhr = FakeXhr.last;
    expect(xhr.url).toBe('https://api.test/explain_in_context/stream/');
    expect(xhr.headers.Authorization).toBe('Bearer test-token');
    expect(xhr.body).toMatchObject({ word: '누워', lemma: '눕다', interface_language: 'en' });

    xhr.respond(200);
    xhr.push(line({ type: 'gloss', gloss: 'to lie down' }));
    xhr.push(line({ type: 'delta', text: 'Here 누워 ' }));
    xhr.push(line({ type: 'delta', text: 'means lying.' }));
    const result = { explanation: 'Here 누워 means lying.', gloss: 'to lie down', lemma: '눕다' };
    xhr.push(line({ type: 'done', result }));

    await expect(pending).resolves.toEqual(result);
    expect(onGloss).toHaveBeenCalledWith('to lie down');
    expect(onText).toHaveBeenLastCalledWith('Here 누워 means lying.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('falls back to the JSON endpoint when the stream route is missing', async () => {
    const result = { explanation: 'fallback', gloss: 'g', lemma: '눕다' };
    api.post.mockResolvedValue({ data: result });
    const pending = streamExplainInContext(params);
    await flush();
    FakeXhr.last.respond(404);

    await expect(pending).resolves.toEqual(result);
    expect(api.post).toHaveBeenCalledWith(
      '/explain_in_context/',
      expect.objectContaining({ word: '누워', lemma: '눕다' }),
      expect.any(Object)
    );
  });

  it('falls back when the stream ends without a result', async () => {
    api.post.mockResolvedValue({ data: { explanation: 'fallback' } });
    const pending = streamExplainInContext(params);
    await flush();
    const xhr = FakeXhr.last;
    xhr.respond(200);
    xhr.push(line({ type: 'error', detail: 'boom' }));
    xhr.end();

    await expect(pending).resolves.toEqual({ explanation: 'fallback' });
  });
});
