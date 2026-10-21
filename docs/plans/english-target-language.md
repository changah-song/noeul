# Plan: English as a target language

*Brainstorm, 2026-10-21. Adding English as a language to learn, mainly for
Korean and Chinese speakers. Paths are relative to the repo root.*

## Recommendation / first step

- **English was half-built once and then hidden.** PR #18 ("English target
  language v1", commit 043720f, June 2026) added backend endpoints that still
  exist: `/en_morphs/` (spaCy), `/en_dict_search/`, `/preprocess_chapter_en/`
  in `backend/main.py`, a Kaikki/Wiktionary dictionary `backend/en_dict.db`
  (357 MB, gitignored, so probably **not deployed**), English CEFR levels in
  `backend/proficiency_levels.db` (`english_cefr`, 7.5k words A1–C2), and
  frontend branches for `'en'` in `services/dictionaryLookup.js`,
  `services/api/preprocessChapter.js`, `services/featureAssembly.js`,
  `constants/proficiencyLevels.js`. Commit 4847c9f (July) removed `en` from
  `SUPPORTED_LANGUAGES`, and Korean/Chinese have since moved far ahead
  (level engine v2, word check, fades, listen mode, focus mode).
- **Key decision:** revive the v1 English path as a third hard-coded branch
  (fast, ~3–4 weeks) **or** first extract a per-language adapter so English is
  the first language built on it (slower, ~6–8 weeks, but makes language #4
  cheap). Recommend the adapter, done incrementally: move ko and zh behind it
  one function at a time, then plug English in.
- **Biggest new work** is not tokenizing English (spaCy is solved) but
  **learner-quality definitions in Korean and Chinese** (no open bilingual
  dictionary as good as KRDICT), **multi-word expressions** (phrasal verbs,
  idioms), and **English content** (catalog, word check, vocab-size grid).
- **First step:** a 2–3 day spike — flip `SUPPORTED_LANGUAGES` back to include
  `en` on a branch, run the backend locally with `en_dict.db`, open an English
  Gutenberg EPUB on the phone, and write down everything that breaks. That list
  becomes the real backlog.

## What is language-specific in the pipeline today

| Stage | Korean | Chinese | English (today / needed) |
|---|---|---|---|
| Language gate | `SUPPORTED_LANGUAGES`, `SUPPORTED_BOOK_LANGUAGES`, `TARGET_LANGUAGE_OPTIONS` (`frontend/constants/languages.js`) | same | removed; `normalizeBookLanguage` still accepts `en` |
| Tokenize / stem | KoNLPy Okt + Kiwi, `/okt_morphs/`, `/krdict_lookup/` | jieba, `/zh_morphs/`, `backend/zh_tokens.py` | spaCy `en_core_web_sm`, `extract_en_lookup_tokens` (`main.py:1984`) |
| Dictionary | KRDICT, `ko_dict.db` + live API in 11 languages | CC-CEDICT `zh_dict.db` + Google-translated | Kaikki `en_dict.db` (English-only) + machine-translated via `is_likely_untranslated_english_definition` |
| Levels | NIKL grades → 6 Noeul Reading Levels (`korean_nikl_vocab`) | HSK 1–7 (`chinese_hsk`) | CEFR A1–C2 (`english_cefr`, `english_cefr_fallback`) |
| Frequency (Zipf) | `word_features` ko 34k | zh 108k | **missing** — `word_features` has no `en` rows |
| Word check / vocab grid | `assets/data/word-check/ko.generated.json`, `vocab-size/ko.generated.json` | zh files | **missing** |
| Calibration | `assets/data/calibration/words.generated.json` (ko) | | **missing** |
| Reading aid | romanization (`koroman`, `/romanize/`) | pinyin ruby row (`showPinyin`, `PINYIN_ROW_SCALE`) | IPA / stress, or nothing |
| Character layer | Hanja (`assets/data/hanja.db`, Hanja panel, `hanjaOverlapFraction`) | `zh_characters.db`, radicals, least-known character | none; nearest analogue is word parts/etymology (`word_parts`, `etymology`, `derived` already in `en_dict.db`) |
| Word families in level engine | 공부 ↔ 공부하다 (`levelEngine.js:41`) | least-known character | lemma + derivational family (happy → unhappy → happiness) |
| Loanword discount | Korean loanwords 0.8 easier (`levelEngine.js:426`) | n/a | interesting reverse: English words a Korean speaker already knows as 외래어 (computer, coffee) |
| Line breaking | joiners (`src/koreanLineBreak.js`) | per-char | hyphenation; `Locale.ENGLISH` already mapped (`NativeEpubReaderModule.kt:1344`) |
| Tap → word | `markedCjkWordAt`, `hasTokenBoundary` | same | must respect spaces, apostrophes (don't, rock'n'roll), hyphens, case |
| Sentences | `SentenceSplitter.kt` | same | breaks on "Mr." / "e.g." / "U.S." — needs an abbreviation list |
| OCR | ML Kit Korean (`OcrRecognizers.kt`) | ML Kit Chinese | Latin recognizer (bundled in every ML Kit script model, so cheap) |
| TTS | `ko-KR` | `zh-CN`/`zh-TW` | `en-US` already in `VOICE_LOCALES` (`services/listenPlayer.js`); offer US/UK choice; `audio_us`/`audio_uk` columns exist |
| Public-domain catalog | 22 books (`assets/data/public-domain/catalog.js`) | 6 | 0 |
| AI prompts | `LANGUAGE_DISPLAY_NAMES` has `en` | | explain + writing assessment work by name; writing assessment's `NATIVE_INSERT` assumes the writer's native language is English — must flip |
| Saved-word fade (6 steps) | `SAVED_WORD_FADE_STEPS` in `services/savedWordFade.js` | | language-neutral, but relies on surface → word mapping, so inflections (ran → run) must be in the surface index |

## English-specific problems to solve

### Tokenization and lemmatization
- spaCy `en_core_web_sm` is fine for lemmas. Gaps in the current
  `extract_en_lookup_tokens`:
  - `token.is_stop` filtering drops high-value verbs that spaCy lists as stop
    words (make, take, get, give, put, go, keep, call, show…) — exactly the
    verbs in phrasal verbs. Use a much smaller stop list.
  - `EN_LOOKUP_ALLOWED_POS` excludes `ADP`/`PART`, so particles in "give up"
    are never seen.
- Case: "Will" (name) vs "will"; sentence-initial capitals. Keep PROPN out of
  levels but let them be tapped.
- Contractions and possessives: tap on "didn't" should look up "do" + "not".
- Hyphenated compounds (well-known) and British/American spellings
  (colour/color) should map to one entry.

### Multi-word expressions (MWEs)
- The largest English-specific feature. Phrasal verbs (look up, put off),
  separable ones ("put it off"), idioms (kick the bucket), fixed phrases (as
  well as). For Korean/Chinese speakers these are the hardest part.
- Approach: build an MWE list from Wiktionary (Kaikki entries with spaces /
  `phrasal verb` tags), match with spaCy `DependencyMatcher` (verb + `prt`
  dependent) at preprocess time, and emit MWE spans alongside single-word
  spans. The native reader must support a term made of non-contiguous spans
  — a real change to the underline/hit-test code in `EpubPageView.kt`.
- Lookup panel: tapping "off" in "put it off" should offer "put off" first.

### Dictionary source and licensing
- Kaikki (Wiktionary extract) is CC BY-SA, same family as KRDICT. OK to use
  with attribution and share-alike for the data.
- Definitions are English-only and written for native speakers. For a Korean
  learner, the best experience is a short Korean gloss + simple English
  definition. Options:
  1. Wiktionary translation tables (Kaikki has `translations` per sense:
     ko and zh coverage is decent for common words, poor for rare ones).
  2. Machine-translate per sense and cache (current v1 approach). Cheap, but
     sense-level errors.
  3. Claude-generated learner glosses per (lemma, sense, user language),
     generated offline for the top ~30k lemmas and reviewed by sampling.
     Probably the best quality/cost ratio.
- WordNet (permissive license) is a good sense inventory and gives synonyms,
  but definitions are terse.
- Avoid copying commercial learner dictionaries (Oxford, Longman, Cambridge).
- **Licensing flag:** the CEFR source is recorded as `"English CEFR vocab.xls"`
  (`metadata` in `proficiency_levels.db`, `source='en_m3'`). Confirm where it
  came from; the English Vocabulary Profile and Oxford 3000/5000 are not
  openly licensed. CEFR-J (free for research/commercial with attribution —
  verify) or a frequency-derived level is a safer base.
- Deployment: `en_dict.db` (357 MB) is gitignored and the Dockerfile only
  `COPY . .`s the repo, so production likely returns 503 from
  `get_kaikki_db_connection`. Trim it (drop unused columns, top 100k lemmas)
  and either commit via Git LFS or fetch at build time.

### Frequency and the difficulty model
- `docs/difficulty-model/level-engine.md`: word difficulty = level band
  blended 50/50 with Zipf. Add English Zipf from `wordfreq` (already used by
  `backend/scripts/generate_vocab_size_tiers.py`) into `word_features`
  (`backend/scripts/import_word_features.py`).
- Bands: CEFR A1–C2 gives six bands, which fits the 6-level UI. C2 is the
  catch-all (2,394 words) and bands are uneven; same issue the Korean bands had.
- Word families: share knowledge across inflections (automatic via lemma) and
  optionally derivations (Kaikki `derived`), discounted.
- Cognate/loanword prior: for Korean speakers, English words common in Korean
  as 외래어 are much easier. Could be computed by transliterating English
  headwords to Hangul and checking `ko_dict.db`.
- Regenerate: `generate_word_check.py`, `generate_vocab_size_tiers.py`,
  `generate_calibration_wordlists.py`, `generate_catalog_levels.py` for `en`.
- The P(known) model (`backend/ml/train_pknown.py`) is trained on ko/zh data;
  English starts on the prior and needs its own validation.

### Reading aids
- No pinyin equivalent is needed for most learners, but pronunciation is
  English's hard part. Options: IPA in the lookup panel (Kaikki has it),
  audio (US/UK), and optionally a Hangul-pronunciation hint for beginners
  (controversial; a toggle at most).
- The pinyin ruby row machinery could show IPA or stress marks above words;
  probably not worth it in v1.
- Syllable count for features is approximate (`countSyllables` uses vowel
  groups, `featureAssembly.js:66`); fine.

### Hanja-like features that do not apply
- Hanja panel, hanja overlap features, character decomposition, Chinese script
  choice, romanization toggle: hide for `en`. Possible later analogue: a
  "word parts" panel (Latin/Greek roots: *tele-*, *-graph*) using
  `word_parts` / `etymology` already in `en_dict.db`.

### Content
- Public-domain catalog: Project Gutenberg / Standard Ebooks (Standard Ebooks
  are CC0 and clean EPUBs — better). Need graded picks: Aesop, Grimm, *Alice*,
  *The Secret Garden*, O. Henry short stories, Sherlock Holmes, then novels.
  Note archaic English (Dickens, Austen) is hard and the frequency model will
  rate it high — good, that is accurate.
- Songs (`backend/song_search.py`, `components/Songs`): English lyrics are the
  most available; licensing for lyrics display is the same issue as today.

### UI language interaction
- An English learner's UI is Korean or Chinese. `KRDICT_INTERFACE_LANGUAGE_OPTIONS`
  currently **does not include `ko`** (it was dropped from the list even though
  `translations.js` has a `ko` table), so a Korean speaker cannot pick a Korean
  UI. Add it.
- `getInterfaceLanguageFallbackForTarget('en')` returns the first option that
  is not `en`, i.e. `zh` — an English learner would default to a Chinese UI.
  Default from the device locale instead.
- Explain-in-context and writing feedback must be in the learner's language
  (see `user-language-support.md`; writing feedback is English-only today).

## Per-language adapter (generalization)

Today the language branches are spread across `if (lang === 'ko')` checks
(`services/dictionaryLookup.js` has ~24, plus `featureAssembly.js`, `Home.js`,
`Learn.js`, `Read.js`, `DictionaryContent.js`, and many in `backend/main.py`).
Sketch:

```js
// frontend/languages/<code>/index.js
export default {
  code: 'en',
  label: 'English',
  endpoints: { preprocess: '/preprocess_chapter_en/', search: '/en_dict_search/', morphs: '/en_morphs/' },
  levels: { system: 'CEFR', options: [...] },            // proficiencyLevels.js
  wordCheck: require('../../assets/data/word-check/en.generated.json'),
  vocabSize: require('../../assets/data/vocab-size/en.generated.json'),
  tts: { defaultLocale: 'en-US', locales: ['en-US', 'en-GB'] },
  ocr: 'latin',
  features: { hanja: false, pinyin: false, romanization: false, wordParts: true, mwe: true },
  countSyllables: (w) => ...,
  normalizeSurface: (s) => s.toLowerCase().replace(/[’']/g, "'"),
  lookupPanelSections: ['ipa', 'audio', 'senses', 'wordParts', 'examples'],
};
```

Backend mirror: a `LanguageAdapter` protocol in a new `backend/languages/`
package (`tokenize`, `lookup`, `levels`, `zipf`, `display_name`) so `main.py`'s
per-language endpoints collapse to `/preprocess_chapter/{lang}/`. Do this as
a refactor of ko and zh first, behind tests (`test_zh_tokens.py`,
`test_word_lookup.py` already exist), then add en.

Native side: pass a small language config into the reader (line-break locale,
whether tokens are space-delimited, ruby-row kind) instead of language checks
in Kotlin.

## Phased plan (rough effort)

1. **Spike (2–3 days).** Re-enable `en` on a branch, list breakages.
2. **Adapter refactor for ko/zh (2–3 weeks).** Frontend + backend, no
   behaviour change, tests green, phone PR check unchanged.
3. **English core (2–3 weeks).** Tokenizer fixes (stop words, contractions),
   trimmed `en_dict.db` deployed, CEFR + Zipf in `word_features`, levels,
   word check, vocab-size grid, calibration list, sentence-splitter
   abbreviations, tap boundaries in the reader, OCR Latin, TTS US/UK.
4. **Learner glosses (1–2 weeks + generation cost).** Korean and Chinese
   glosses per sense, cached; IPA + audio in the lookup panel.
5. **Content (1 week).** 15–25 graded Standard Ebooks titles with levels.
6. **Phrasal verbs / MWEs (2–4 weeks).** Detection at preprocess, non-contiguous
   spans in the native reader, lookup panel priority.
7. **Polish.** Word-parts panel, cognate/외래어 prior, P(known) validation on
   English data.

## Open questions

- Who is the first audience: Korean speakers, Chinese speakers, or both? It
  decides which gloss language to invest in first.
- Is machine-translated Wiktionary good enough for v1, or is generated
  learner gloss data a launch requirement?
- Where did "English CEFR vocab.xls" come from, and can we ship it?
- US or UK English by default (spelling in definitions, TTS, IPA)?
- Should MWEs block launch, or ship single words first?
- Does English need a different difficulty unit (lemma vs word family) than
  Korean (morpheme stem) and Chinese (word)?
- How big may the app bundle grow (any on-device English data), given hanja.db
  is already 14 MB?
