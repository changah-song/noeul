"""Remove stray spaces inside Korean words in the bundled public-domain texts
(아버지 의 -> 아버지의, 하였 다 -> 하였다, 입신( 入神) 의 -> 입신(入神)의):
leftovers of the printed editions' line breaks in the digitized sources.

    backend/.venv/bin/python backend/scripts/respace_korean_books.py \
        frontend/assets/data/public-domain/books [--write]

Kiwi's spacing correction proposes; only the spaces it removes are applied
(never the ones it would add), and only where the part after the space starts
with a particle, an ending or a suffix, or the space splits a morpheme, so an
auxiliary verb keeps its space (해야 한다). Prints a sample of the joins; with
--write it rewrites the files. Afterwards update the Korean books' wordCount in
frontend/assets/data/public-domain/catalog.js (publicDomainTexts.test.js)."""
import glob
import os
import random
import re
import sys

from kiwipiepy import Kiwi

books_dir = sys.argv[1]
write = '--write' in sys.argv
kiwi = Kiwi()
HANGUL = re.compile('[가-힣]')


def bracket_fix(text):
    text = re.sub(r'([(\[（［])[ 　]+', r'\1', text)
    text = re.sub(r'[ 　]+([)\]）］])', r'\1', text)
    return text


def join_ok(left, right):
    """Whether `left right` is one word split by a stray space: the merged
    word's analysis has a morpheme spanning the boundary, or the part after it
    starts with a particle, an ending or a suffix (아버지 의, 하였 다, 통탄
    할). A verb or an auxiliary there (해야 한다, 하기도 했다) is its own word,
    and after a complete word (one ending in a particle or a word ending:
    집에, 땅이) only a particle joins (하면서 부터)."""
    if not left or not right:
        return False
    alone = kiwi.tokenize(left)
    last = alone[-1].tag if alone else ''
    complete = last.startswith('J') or last in ('EF', 'EC', 'ETM')
    merged = left + right
    boundary = len(left)
    for token in kiwi.tokenize(merged):
        start, end = token.start, token.start + token.len
        if start < boundary < end:
            return not complete
        if start == boundary:
            if complete:
                return token.tag.startswith('J')
            return token.tag.startswith(('J', 'E', 'XS'))
    return False


def removals_only(original, corrected):
    """Keep `original`, minus the spaces `corrected` doesn't have and
    join_ok accepts (never the spaces it would add)."""
    # Map each non-space character of the original to whether a space
    # follows it in the corrected text.
    flat = [c for c in corrected]
    spaced_after = []
    j = 0
    for ch in original:
        if ch in ' \u3000':
            continue
        while j < len(flat) and flat[j] == ' ':
            j += 1
        if j >= len(flat) or flat[j] != ch:
            return original  # alignment lost: leave the line alone
        j += 1
        spaced_after.append(j < len(flat) and flat[j] == ' ')
    words = re.split(r'([ \u3000]+)', original)
    out = []
    count = 0
    for index, piece in enumerate(words):
        if index % 2 == 0:
            out.append(piece)
            count += len(piece)
            continue
        left = words[index - 1]
        right = words[index + 1] if index + 1 < len(words) else ''
        kiwi_keeps = count == 0 or spaced_after[count - 1]
        if (not kiwi_keeps and left and right and HANGUL.search(left[-1:]) or not kiwi_keeps and left[-1:] in ')]' and right and HANGUL.search(right[:1])) \
                and join_ok(re.sub(r'^.*[^가-힣()\[\]A-Za-z0-9\u4e00-\u9fff]', '', ''.join(out).split(' ')[-1]), re.sub(r'[^가-힣].*$', '', right)):
            continue
        out.append(' ')
    return ''.join(out)


changes = []
for path in sorted(glob.glob(os.path.join(books_dir, '*.txt'))):
    text = open(path, encoding='utf-8').read()
    if not HANGUL.search(text) or len(HANGUL.findall(text)) < len(text) * 0.2:
        continue
    lines = text.split('\n')
    new_lines = []
    for line in lines:
        fixed = bracket_fix(line)
        if HANGUL.search(fixed) and ' ' in fixed.strip() and not fixed.startswith('#'):
            corrected = kiwi.space(fixed, reset_whitespace=False)
            fixed = removals_only(fixed, corrected)
        if fixed != line:
            changes.append((os.path.basename(path), line, fixed))
        new_lines.append(fixed)
    if write:
        open(path, 'w', encoding='utf-8').write('\n'.join(new_lines))

# Word-level view of the changes.
def merged_pairs(before, after):
    a = before.split()
    b = after.split()
    pairs = []
    i = 0
    for word in b:
        start = i
        built = ''
        while i < len(a) and len(built) < len(word):
            built += a[i]
            i += 1
        if i - start > 1:
            pairs.append(' '.join(a[start:i]) + ' -> ' + word)
    return pairs

counts = {}
all_pairs = []
for name, before, after in changes:
    pairs = merged_pairs(re.sub(r'([(\[])\s+', r'\1', before), after)
    counts[name] = counts.get(name, 0) + len(pairs)
    all_pairs.extend((name, p) for p in pairs)
for name, n in sorted(counts.items(), key=lambda kv: -kv[1]):
    print(f'{n:5d} {name}')
print('total merges', len(all_pairs))
random.seed(7)
for name, p in random.sample(all_pairs, min(80, len(all_pairs))):
    print(f'  {name[:14]:14s} {p}')
