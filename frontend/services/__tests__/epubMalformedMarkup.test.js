/**
 * Some converter-generated EPUBs (seen in the wild in Korean nonfiction
 * titles) corrupt bracket-style quotation marks into literal '<' '>'
 * characters mid-paragraph, e.g. a book title rendered as
 * `<타일랜드 태틀러<span="" class="en">Thailand Tatler>...</타일랜드>`.
 * The strict xmldom parser throws on that, and previously the whole
 * chapter was silently dropped from the reader's navigation window —
 * the "I can see the chapter start but can't scroll past it" bug.
 * These pin down that parseChapterXhtmlDocument recovers instead of
 * losing the chapter, using real corrupted paragraphs pulled from a
 * reported book.
 */

import {
  sanitizeMalformedInlineMarkup,
  buildPlainTextFallbackXhtml,
  parseChapterXhtmlDocument,
} from '../epubMetadata';

const wrapBody = (innerHtml) => (
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>t</title></head>
<body>${innerHtml}</body></html>`
);

describe('sanitizeMalformedInlineMarkup', () => {
  it('escapes a fake tag whose name is corrupted bracket text fused with a real tag', () => {
    const raw = '<p>방콕의 패션 잡지인 <타일랜드 태틀러<span="" class="en">Thailand Tatler>의 한 편집자는 말했다.</타일랜드></p>';
    const sanitized = sanitizeMalformedInlineMarkup(raw);

    expect(() => parseChapterXhtmlDocument(wrapBody(sanitized), 'test')).not.toThrow();
  });

  it('also escapes accidentally self-consistent non-ASCII "tags" (still parses fine either way)', () => {
    const raw = '<p>영국 <이코노미스트>가 지적했다.</이코노미스트></p>';
    const sanitized = sanitizeMalformedInlineMarkup(raw);

    expect(sanitized).toBe('<p>영국 &lt;이코노미스트>가 지적했다.&lt;/이코노미스트></p>');
    const doc = parseChapterXhtmlDocument(wrapBody(sanitized), 'test');
    expect(doc.documentElement.textContent).toContain('영국 <이코노미스트>가 지적했다.</이코노미스트>');
  });

  it('leaves ordinary ASCII markup untouched', () => {
    const raw = '<p>Some <span class="en">Text</span> with a <a href="x.html">link</a>.</p>';
    expect(sanitizeMalformedInlineMarkup(raw)).toBe(raw);
  });

  it('escapes bare ampersands that are not part of a real entity', () => {
    const raw = '<p>News & Observer</p>';
    expect(sanitizeMalformedInlineMarkup(raw)).toBe('<p>News &amp; Observer</p>');
  });
});

describe('parseChapterXhtmlDocument', () => {
  const realCorruptedParagraphs = [
    // chaptxt1.xhtml — corrupted magazine title fused with a real <span> tag, unclosed.
    '<p>방콕의 패션 잡지인 <타일랜드 태틀러<span="" class="en">Thailand Tatler>의 한 편집자는 로이터 기자들에게 이렇게 말했다.</타일랜드></p>',
    // chaptxt2.xhtml — corrupted song title, real <span> left dangling to end of chapter.
    '<p>쿠데타를 지지하는 우파 진영 사람들은 <페이스 투="" 더="" 선<span="" class="en">Face to the Sun>을 열창했다.</p>',
    // chaptxt3.xhtml — corrupted newspaper name that also contains a literal unescaped '&'.
    '<p>롤리에서 발행하는 신문 <뉴스&옵저버<span class="en">News & Observer</span>는 인종차별을 옹호했다.</p>',
    // chaptxt4.xhtml — accidentally self-consistent (open/close names match), never threw.
    '<p>영국 <이코노미스트>가 냉철하게 지적했던 것처럼, 그들은 “민주주의를 저버렸다”.</이코노미스트></p>',
  ];

  it.each(realCorruptedParagraphs)('parses a chapter containing corrupted paragraph %#', (paragraph) => {
    const doc = parseChapterXhtmlDocument(wrapBody(paragraph), 'test-chapter');
    expect(doc.getElementsByTagName('p').length).toBeGreaterThan(0);
    expect(doc.documentElement.textContent.length).toBeGreaterThan(0);
  });

  it('still parses a genuinely well-formed chapter with no sanitization needed', () => {
    const doc = parseChapterXhtmlDocument(wrapBody('<p>Perfectly fine paragraph.</p>'), 'test');
    expect(doc.getElementsByTagName('p')[0].textContent).toBe('Perfectly fine paragraph.');
  });

  it('falls back to plain text and still surfaces surrounding paragraphs when a tag is left unrecoverably dangling', () => {
    const raw = wrapBody(
      '<p>First paragraph is fine.</p>'
      + '<p>쿠데타를 지지하는 우파 진영 사람들은 <페이스 투="" 더="" 선<span="" class="en">Face to the Sun>을 열창했다.</p>'
      + '<p>Third paragraph should still be readable.</p>'
    );

    const doc = parseChapterXhtmlDocument(raw, 'test-chapter');
    const text = doc.documentElement.textContent;

    expect(text).toContain('First paragraph is fine.');
    expect(text).toContain('Third paragraph should still be readable.');
  });
});

describe('buildPlainTextFallbackXhtml', () => {
  it('produces valid XHTML with one <p> per source paragraph, stripped of markup', () => {
    const raw = wrapBody(
      '<p>Paragraph one.</p><p>Paragraph <b>two</b> with <i>inline</i> markup.</p>'
    );

    const fallback = buildPlainTextFallbackXhtml(raw);
    const doc = parseChapterXhtmlDocument(fallback, 'fallback-test');
    const paragraphs = Array.from(doc.getElementsByTagName('p')).map((node) => node.textContent);

    expect(paragraphs).toEqual(['Paragraph one.', 'Paragraph two with inline markup.']);
  });

  it('always yields a parseable document even for severely mangled input', () => {
    const raw = '<html><body><p>broken <<< &&& >>> tags</p></body></html>';
    expect(() => parseChapterXhtmlDocument(raw, 'mangled-test')).not.toThrow();
  });
});
