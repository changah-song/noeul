/**
 * The bundled Korean public-domain texts must reach the reader as clean
 * paragraphs. publicDomainBooks.js splits paragraphs at blank lines and joins
 * the lines inside one with a space, so a source hard-wrapped mid-word
 * (심해지\n기는) used to read as "심해지 기는", and a file without blank lines
 * became one giant paragraph, leaving chapter 1 as a near-empty title page.
 * backend/scripts/reflow_public_domain_texts.py fixes the files; this keeps
 * them fixed.
 */
const fs = require('fs');
const path = require('path');

const BOOKS_DIR = path.join(__dirname, '../../assets/data/public-domain/books');
const CATALOG = fs.readFileSync(path.join(__dirname, '../../assets/data/public-domain/catalog.js'), 'utf8');

const koreanBooks = CATALOG.split(/\n  \{\n/).slice(1)
  .map((block) => ({
    title: (block.match(/title: '([^']+)'/) || [])[1],
    author: (block.match(/author: '([^']+)'/) || [])[1],
    language: (block.match(/language: '([a-z]+)'/) || [])[1],
    wordCount: Number((block.match(/wordCount: (\d+)/) || [])[1]),
    file: (block.match(/books\/([^']+)'/) || [])[1],
  }))
  .filter((book) => book.file && book.language === 'ko');

const read = (file) => fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8');

describe('bundled Korean public-domain texts', () => {
  it('covers all 22 Korean books', () => {
    expect(koreanBooks).toHaveLength(22);
  });

  it.each(koreanBooks.map((book) => [book.file, book]))('%s is one line per paragraph', (file, book) => {
    const paragraphs = read(file).trim().split(/\n{2,}/);
    expect(paragraphs.length).toBeGreaterThan(20);
    // No single line breaks inside a paragraph: those are what the reader
    // turned into spaces.
    paragraphs.forEach((paragraph) => expect(paragraph).not.toMatch(/\n/));
    // The reader renders the title and author itself.
    const squash = (value) => value.replace(/[\s<>()]/g, '');
    expect(squash(paragraphs[0])).not.toBe(squash(book.title));
    // The catalog's word count matches the text.
    expect(book.wordCount).toBe(read(file).split(/\s+/).filter(Boolean).length);
  });

  it('rejoins words the source split across lines', () => {
    const text = read('a_lucky_day.txt');
    expect(text).toContain('심해지기는');
    expect(text).not.toContain('심해지 기는');
    expect(text).toContain('추적추적');
    expect(text).not.toContain('추 적추적');
  });
});
