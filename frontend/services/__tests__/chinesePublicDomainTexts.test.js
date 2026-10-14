/**
 * The Chinese public-domain texts came from Wikisource pages whose linked names
 * (鲁镇, 咸亨酒店, 孔乙己, 阿Q …) each became a paragraph, so the reader broke
 * sentences mid-way. backend/scripts/rejoin_chinese_link_fragments.py rejoins
 * them; this keeps them rejoined without merging real headings.
 */
const fs = require('fs');
const path = require('path');

const BOOKS_DIR = path.join(__dirname, '../../assets/data/public-domain/books');
const paragraphs = (file) => fs.readFileSync(path.join(BOOKS_DIR, file), 'utf8')
  .split('\n\n').map((p) => p.trim()).filter(Boolean);

describe('bundled Chinese public-domain texts', () => {
  it('keeps sentences that contained linked names whole', () => {
    const kong = paragraphs('kong_yiji_lu_xun.txt');
    expect(kong[0].startsWith('鲁镇的酒店的格局')).toBe(true);
    expect(kong).toContainEqual(expect.stringMatching(/^我从十二岁起，便在镇口的咸亨酒店里当伙计/));
    expect(paragraphs('ah_q_true_story.txt')).toContainEqual(expect.stringMatching(/^我要给阿Q做正传/));
  });

  it('has no stray link fragments left as paragraphs', () => {
    ['kong_yiji_lu_xun.txt', 'ah_q_true_story.txt'].forEach((file) => {
      const fragments = paragraphs(file).filter((p) => p === '孔乙己' || p === '阿Q' || p === '。');
      expect(fragments).toEqual([]);
    });
  });

  it('keeps chapter headings and story titles on their own', () => {
    expect(paragraphs('madmans_diary_lu_xun.txt').slice(0, 2)).toEqual(['一', '今天晚上，很好的月光。']);
    expect(paragraphs('ah_q_true_story.txt')[0]).toBe('第一章　序');
    const naHan = paragraphs('na_han_lu_xun.txt');
    ['自序', '狂人日记', '孔乙己', '药', '明天', '一件小事', '头发的故事', '风波', '故乡',
      '阿Q正传', '端午节', '白光', '兔和猫', '鸭的喜剧', '社戏'].forEach((title) => {
      expect(naHan.filter((p) => p === title).length).toBeGreaterThanOrEqual(1);
    });
  });
});
