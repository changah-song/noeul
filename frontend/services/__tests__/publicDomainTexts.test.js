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
  it('covers all 24 Korean books', () => {
    expect(koreanBooks).toHaveLength(24);
  });

  it.each(koreanBooks.map((book) => [book.file, book]))('%s is one line per paragraph', (file, book) => {
    const paragraphs = read(file).trim().split(/\n{2,}/);
    // 성냥팔이 소녀 is the shortest at 13 paragraphs.
    expect(paragraphs.length).toBeGreaterThan(10);
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

describe('bundled public-domain front and back matter', () => {
  const paragraphsOf = (file) => read(file).trim().split(/\n{2,}/);
  const ANDERSEN = {
    'little_match_girl.txt': '지독히도 추운 날이었다.',
    'little_mermaid.txt': '저 멀리 드넓은 바다에,',
    'snow_queen.txt': '일곱 가지 이야기',
    'thumbelina.txt': '옛날에 아주 작은 아이를',
    'ugly_duckling.txt': '시골에서는 밖이 무척 아름답다.',
  };

  it.each(Object.entries(ANDERSEN))('%s starts with the story, not the series heading or credit', (file, opening) => {
    const text = read(file);
    expect(paragraphsOf(file)[0].startsWith(opening)).toBe(true);
    expect(text).not.toContain('[Andersen 단편선]');
    expect(text).not.toContain('김선희 역1');
    expect(text).not.toContain('옮긴이 약력');
    expect(text).not.toContain('역자 약력은 원고 말미에');
    expect(text).not.toContain('instagram.com');
    expect(text).not.toContain('blog.naver.com');
    // No page-rule dash lines (or the "-1-" page number) left at the end.
    paragraphsOf(file).forEach((paragraph) => expect(paragraph).not.toMatch(/^-[-\d]*-$/));
  });

  it('keeps the translator\'s glosses the stories point at', () => {
    expect(read('little_mermaid.txt')).toContain('2 배의 돛대·활대·돛 따위를 다루기 위한 밧줄·쇠사슬 등-옮긴이');
    expect(read('thumbelina.txt')).toContain('2 옛 영국의 화폐단위 12페니가 1실링(shilling)이었다. _옮긴이');
  });

  it('drops leading title lines that differ from the catalog title', () => {
    const firstParagraphs = {
      'chisuk.txt': '치숙(痴叔)',
      'city_and_ghost.txt': '도시와 유령',
      'crime_and_punishment_lee_muyeong.txt': '죄(罪)와 벌(罰)',
      'heosaengjeon.txt': '許生傳[허생전]',
      'mister_bang.txt': '미스터 방',
      'taepyeongcheonha.txt': '太　平　天　下[태평천하]',
      'tears_of_blood.txt': '혈(血)의 누(淚)',
      'when_buckwheat_flowers_bloom.txt': '메밀꽃 필 무렵',
      'ah_q_true_story.txt': '阿Q正传',
      'chen_lun_yu_dafu.txt': '沉沦_(郁达夫)',
      'kong_yiji_lu_xun.txt': '孔乙己',
      'madmans_diary_lu_xun.txt': '狂人日记',
    };
    Object.entries(firstParagraphs).forEach(([file, title]) => {
      expect([file, paragraphsOf(file)[0]]).not.toEqual([file, title]);
    });
    // 呐喊's doubled 自序 heading is now single.
    expect(paragraphsOf('na_han_lu_xun.txt').slice(0, 2)).toEqual(['自序', expect.not.stringContaining('自序')]);
  });

  it('drops trailing source citations', () => {
    const files = fs.readdirSync(BOOKS_DIR).filter((file) => file.endsWith('.txt'));
    files.forEach((file) => {
      const last = paragraphsOf(file).slice(-1)[0];
      expect([file, last]).not.toEqual([file, expect.stringMatching(/^출전\s*:|조선문단』|자유 문학|《어린이》/)]);
    });
  });
});
