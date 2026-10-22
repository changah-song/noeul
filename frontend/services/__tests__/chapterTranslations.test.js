import { chapterSentences, normalizeSentence, sentencesOf, splitSentences } from '../sentenceSplit';
import { createChapterTranslations } from '../chapterTranslations';

describe('sentenceSplit', () => {
    it('cuts like the native SentenceSplitter', () => {
        const text = '그는 3.14를 썼다. "정말?" 그녀가 물었다!';
        expect(splitSentences(text).map(([s, e]) => text.slice(s, e))).toEqual([
            '그는 3.14를 썼다.',
            '"정말?"',
            '그녀가 물었다!',
        ]);
        expect(sentencesOf('他说：“好。”我们走吧')).toEqual(['他说：“好。', '我们走吧']);
    });

    it('normalizes the way the reader hands sentences back', () => {
        expect(normalizeSentence('  “소⁠녀가   웃었다.”  ')).toBe('소녀가 웃었다.');
    });

    it('lists a chapter\'s distinct sentences in order', () => {
        expect(chapterSentences('하나. 둘.\n하나. 셋?')).toEqual(['하나.', '둘.', '셋?']);
    });
});

const fakeTranslator = () => {
    const calls = [];
    const saved = {};
    const service = createChapterTranslations({
        translateOne: async () => '',
        translateBatch: async ({ texts, target }) => {
            calls.push(texts);
            return texts.map((text) => (text.includes('실패') ? null : `[${target}] ${text}`));
        },
        loadSaved: async ({ sentences }) => {
            const out = {};
            sentences.forEach((sentence) => { if (saved[sentence]) out[sentence] = saved[sentence]; });
            return out;
        },
        save: async ({ entries }) => { entries.forEach(([sentence, translated]) => { saved[sentence] = translated; }); },
    });
    return { service, calls, saved };
};

describe('chapterTranslations', () => {
    it('fetches a chapter in one request and then answers instantly', async () => {
        const { service, calls } = fakeTranslator();
        const result = await service.prefetchChapter({
            key: 'book:0',
            paragraphs: ['감자를 먹었다. 맛있었다!', '그래서 또 먹었다.'],
            source: 'ko',
            target: 'es',
        });
        expect(result).toEqual({ total: 3, done: 3 });
        expect(calls).toHaveLength(1);
        // A sentence the reader reports, quotes and spacing aside.
        expect(service.peek('“감자를  먹었다.”', 'ko', 'es')).toBe('[es] 감자를 먹었다.');
        // A focus span of two sentences joins their translations.
        expect(await service.translate('감자를 먹었다. 맛있었다!', 'ko', 'es'))
            .toBe('[es] 감자를 먹었다. [es] 맛있었다!');
        expect(calls).toHaveLength(1);
        // Asking for the same chapter again sends nothing.
        await service.prefetchChapter({ key: 'book:0', paragraphs: ['감자를 먹었다.'], source: 'ko', target: 'es' });
        expect(calls).toHaveLength(1);
    });

    it('uses translations saved on the phone before asking the server', async () => {
        const first = fakeTranslator();
        await first.service.translate('비가 왔다.', 'ko', 'en');
        const second = createChapterTranslations({
            translateBatch: async () => { throw new Error('should not be called'); },
            loadSaved: async ({ sentences }) => Object.fromEntries(
                sentences.filter((s) => first.saved[s]).map((s) => [s, first.saved[s]])
            ),
            save: async () => {},
        });
        expect(await second.translate('비가 왔다.', 'ko', 'en')).toBe('[en] 비가 왔다.');
    });

    it('splits a long chapter into several requests', async () => {
        const { service, calls } = fakeTranslator();
        const paragraphs = Array.from({ length: 250 }, (_, i) => `문장 ${i}.`);
        const result = await service.prefetchChapter({ key: 'long', paragraphs, source: 'ko', target: 'en' });
        expect(result.done).toBe(250);
        expect(calls.map((batch) => batch.length)).toEqual([100, 100, 50]);
    });

    it('returns empty when a sentence could not be translated, and retries a partial chapter', async () => {
        const { service, calls } = fakeTranslator();
        expect(await service.translate('이건 실패한다.', 'ko', 'en')).toBe('');
        const partial = await service.prefetchChapter({ key: 'c', paragraphs: ['좋다. 실패다.'], source: 'ko', target: 'en' });
        expect(partial).toEqual({ total: 2, done: 1 });
        await service.prefetchChapter({ key: 'c', paragraphs: ['좋다. 실패다.'], source: 'ko', target: 'en' });
        // The retry only asks for what is still missing.
        expect(calls[calls.length - 1]).toEqual(['실패다.']);
    });

    it('joins without spaces for Chinese and Japanese', async () => {
        const { service } = fakeTranslator();
        expect(await service.translate('하나. 둘.', 'ko', 'ja')).toBe('[ja] 하나.[ja] 둘.');
    });
});

describe('chapterTranslations on a server without the batch endpoint', () => {
    it('falls back to one request per sentence for what is being read now', async () => {
        const single = [];
        const service = createChapterTranslations({
            translateBatch: async () => { throw Object.assign(new Error('Not found'), { response: { status: 404 } }); },
            translateOne: async ({ query, target }) => { single.push(query); return `(${target}) ${query}`; },
            loadSaved: async () => ({}),
            save: async () => {},
        });
        expect(await service.translate('하나. 둘.', 'ko', 'en')).toBe('(en) 하나. (en) 둘.');
        expect(single).toEqual(['하나.', '둘.']);
        // A whole chapter ahead does not fan out into single requests.
        const result = await service.prefetchChapter({ key: 'x', paragraphs: ['셋. 넷. 다섯.'], source: 'ko', target: 'en' });
        expect(result.done).toBe(0);
        expect(single).toEqual(['하나.', '둘.']);
    });
});

