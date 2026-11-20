import { scrubBreadcrumb, scrubEvent, scrubTransaction, stripQuery } from '../crashReporting';

describe('crashReporting scrubbing', () => {
  test('stripQuery drops query strings and fragments', () => {
    expect(stripQuery('https://api.example/okt_morphs?text=책을 읽다')).toBe('https://api.example/okt_morphs');
    expect(stripQuery('https://api.example/a#b')).toBe('https://api.example/a');
    expect(stripQuery('https://api.example/a')).toBe('https://api.example/a');
    expect(stripQuery(undefined)).toBeUndefined();
  });

  test('console breadcrumbs keep only the start of warnings and errors', () => {
    expect(scrubBreadcrumb({ category: 'console', level: 'log', message: 'chapter text' })).toBeNull();
    const kept = scrubBreadcrumb({
      category: 'console',
      level: 'warning',
      message: 'x'.repeat(500),
      data: { arguments: ['secret'] },
    });
    expect(kept.message).toHaveLength(200);
    expect(kept.data).toBeUndefined();
  });

  test('request breadcrumbs lose their query strings', () => {
    const crumb = scrubBreadcrumb({ category: 'xhr', data: { url: 'https://x/translate?q=hello', method: 'GET' } });
    expect(crumb.data).toEqual({ url: 'https://x/translate', method: 'GET' });
  });

  test('events keep only the user id and drop request bodies', () => {
    const event = scrubEvent({
      request: { url: 'https://x/a?b=c', data: 'body', query_string: 'b=c', cookies: 'k' },
      user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' },
    });
    expect(event.request).toEqual({ url: 'https://x/a' });
    expect(event.user).toEqual({ id: 'u1' });
  });

  test('transactions lose query strings from span urls and descriptions', () => {
    const event = scrubTransaction({
      spans: [{
        description: 'GET https://api.x/okt_morphs?text=책',
        data: { url: 'https://api.x/okt_morphs?text=책', 'http.query': 'text=책', 'http.method': 'GET' },
      }],
      contexts: { trace: { data: { url: 'https://api.x/a?b=c' } } },
    });
    expect(event.spans[0].description).toBe('GET https://api.x/okt_morphs');
    expect(event.spans[0].data).toEqual({ url: 'https://api.x/okt_morphs', 'http.method': 'GET' });
    expect(event.contexts.trace.data.url).toBe('https://api.x/a');
  });
});
