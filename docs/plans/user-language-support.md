# Plan: user language support

*Brainstorm, 2026-10-21. "User language" = the learner's own language: the UI,
plus the language that definitions, translations, AI explanations, writing
feedback, onboarding and store listings are shown in. Paths are relative to the
repo root.*

## Recommendation / first step

- **The UI is translated; the content often is not.** 12 UI locales exist, but
  several learning surfaces are English-only or machine-translated, and RTL
  Arabic is not laid out right-to-left at all. A learner who picks Thai gets a
  Thai UI around English writing feedback and English Chinese definitions.
- **Key decision:** which content gets *real* per-language data versus
  machine translation (Google Translate / Claude) cached on the backend. Today
  Korean definitions come from KRDICT in 11 languages (that is where the UI
  language list came from: `KRDICT_INTERFACE_LANGUAGE_OPTIONS` in
  `frontend/constants/languages.js`), Chinese and English definitions are
  English-source and machine-translated per word. Recommend: keep that split,
  but make it explicit with a quality label in the UI and per-language QA.
- **First step (small, high value):** an audit table of every user-visible
  text source × 12 languages (UI / dictionary / hanja / sentence translation /
  explain / writing feedback / onboarding / notifications / store listing),
  filled in by actually switching the phone app to Arabic, Thai and Mongolian.
  Then fix the two clear bugs below (writing feedback language, Arabic RTL).

## Which languages (2026-10-21)

The current list is KRDICT's 11 minus Japanese, plus Traditional Chinese.
KRDICT only matters for Korean definitions; Chinese (and future English)
definitions are machine-translated anyway, so choose by learners instead.

**How to judge a language**
1. How many people learn Korean or Chinese from it (TOPIK, HSK, Duolingo).
2. How well those learners read English. Native-language glosses help most
   where English is weak.
3. Android share (Noeul is Android-only for now).
4. Cost: KRDICT data or machine translation only, script/font work, RTL.

**Keep:** en, zh-Hans, zh-Hant, ko (for Chinese learners), vi, id, th, es, ru,
fr, mn. Vietnam is the largest overseas TOPIK market; Indonesia and Thailand
are big, Android-heavy K-culture markets. Mongolian is small but cheap: it is
already done, and Korean was the top language on Duolingo there.

**Add first**
- **Japanese**: among the largest groups learning Korean, and KRDICT already
  has Japanese glosses, so Korean definitions are first-class with no machine
  translation. Large Chinese-learner base too. Caveat: Japan is mostly iPhone.
- **Portuguese (Brazil)**: a huge, Android-heavy K-pop/K-drama audience,
  Portuguese is in Duolingo's top 10, English proficiency is low. Glosses are
  machine-translated.

*Status (2026-10-21): Japanese and Portuguese (Brazil) added — full UI
tables, KRDICT `trans_lang=2` for Japanese, machine-translated Korean glosses
for Portuguese (`MACHINE_TRANSLATED_KO_INTERFACE_LANGUAGES`), Supabase check
in `supabase/users_interface_language_ja_pt.sql`. Hanja meanings and Chinese
character data still show English for both (no `hun_ja` / `hun_pt`).*

**Add second**
- **Turkish**: a large K-drama audience, Android-heavy, low English. Machine-translated.
- **German**, **Italian**, **Polish**: places where Korean is growing on
  Duolingo, but many learners there read English fine; lower marginal value.

**Only if data shows demand**
- Job-route Korean learners (EPS-TOPIK): Uzbek, Nepali, Burmese, Khmer,
  Sinhala. Large numbers, but they mostly study for the exam, not by reading
  books.
- Hindi, Filipino: big K-pop audiences, but English is widely read.

**Arabic: real users (Supabase, 2026-10-21).** After English, the most common
saved interface languages are Spanish, Arabic and Chinese. Arabic users are
here now, so the RTL work (1–2 weeks) moves up, ahead of new languages.

**Measure before deciding**
- Log the phone's system language with each app start, so we can see demand
  for languages we don't support yet.
- Look at Play Console installs by country and by device language.
- Look at how `users.interface_language` is spread across users in Supabase.

## What is already done

- **12 UI languages** in `frontend/i18n/translations.js` (~13.4k lines, ~1,100
  keys per locale): en fr es ar mn vi th id ru zh zh-Hant ko. Missing keys fall
  back to English (`translate()`, line 13366).
- **Language settings**: `frontend/services/interfaceLanguage.js` stores
  `targetLanguage`, `interfaceLanguage`, `chineseScript` in AsyncStorage
  (`@ff/language-settings`) and syncs `interface_language` to
  `public.users` (`frontend/services/accountSettingsCloudSync.js`).
- **Interface ≠ target rule**: `normalizeInterfaceLanguageForTarget` stops a
  Korean learner from choosing a Korean UI (falls back to the first other
  option). Sensible, but see open questions.
- **Korean definitions** in the user's language via KRDICT `trans_lang`
  (`KRDICT_INTERFACE_LANGUAGES`, `backend/main.py:143`). The offline
  `backend/ko_dict.db` only holds English glosses, so non-English users depend
  on the live KRDICT API (with an English fallback, PR #46).
- **Chinese definitions**: CC-CEDICT (English) in `backend/zh_dict.db`, then
  Google-translated per stem and cached in `dictionary_cache`
  (`translate_and_cache_zh_preprocess`, `main.py:3603`).
- **Hanja meanings** in 11 languages, offline: `frontend/assets/data/hanja.db`
  table `hanja_characters` has `hun_korean, hun_english, hun_fr … hun_ru`.
- **AI explanations** (`/explain_in_context/`) are prompted in the interface
  language (`_explain_language_names`, `main.py:5343`;
  `LANGUAGE_DISPLAY_NAMES`, `main.py:943`), and cached per interface language.
- **Dates and numbers** mostly use `Intl` / `toLocale*` with the interface
  language (`screens/Write.js:266`, `screens/Profile.js:142`, `Home.js:579`,
  `Learn.js:309`, `NotesLogSheet.js`, `SavedWordsPanel.js`).
- **TTS sample lines** per locale exist in `services/listenPlayer.js`, and
  listen mode can read translations aloud.

## What is not done (gaps)

### Content language
*Status (2026-10-21, branch `loc/backend`): writing feedback, backend error
messages (stable codes), catalog blurbs, hanja meanings (placeholder `hun_zh`
cleared), Chinese character data and level names are now in the user's
language. Details and what stays English:
[`content-localization.md`](content-localization.md).*

- **Writing feedback is always English.** `_ASSESSMENT_SYSTEM_BASE`
  (`backend/main.py:4858`) ends with "All explanations and notes should be
  written in English", and `build_assessment_system_prompt` takes no interface
  language. Also its `NATIVE_INSERT` error type assumes the writer's native
  language is English. Fix: pass `interface_language`, name it in the prompt,
  and rename the error to "native-language insert".
- **Chinese character data is English-only**: `frontend/assets/data/zh_characters.db`
  (`definition`, `hint` columns). Needs per-language columns like hanja.db, or
  translate-and-cache on the backend.
- **English definitions** (used by the English-target path, see
  `english-target-language.md`) are Wiktionary English, machine-translated.
- **Offline Korean dictionary is English-only**: a non-English user offline
  gets English, not their language. Option: ship more KRDICT translation
  columns in `ko_dict.db` (the KRDICT export includes all 11 languages; size
  grows maybe 3–5×) or download per-language packs on demand.
- **Hanja data quality**: spot check found `hun_zh` for 一 is a placeholder
  string (`韓文表義一致`), not a meaning. Audit every `hun_*` column.
- **Sentence translation** (`services/api/googleTranslate.js` → `/translate/`)
  targets the interface language; fine, but verify `zh-Hant` is passed as
  `zh-TW` to Google, not collapsed to `zh`.
- **`nativeLanguage` is effectively dead**: `AppContext.js:130` normalizes it
  with `normalizeLanguageCode`, which only knows target languages (ko/zh), so it
  can never hold e.g. `vi`. Either remove it or make it real (see "Model").
- **Calibration and word-check copy**, onboarding examples, and starter book
  blurbs (`assets/data/public-domain/catalog.js` descriptions are English) are
  shown in English to everyone.

### Layout and typography
- **No RTL.** No `I18nManager` use anywhere; ~60 `marginLeft/paddingLeft/left:`
  styles in screens/components. Arabic users get Arabic strings in an LTR
  layout. Options: (a) `I18nManager.forceRTL(true)` + app restart when Arabic
  is chosen, then swap `left/right` for `start/end`; (b) keep LTR chrome but
  set `writingDirection: 'rtl'` on Arabic text blocks only. (a) is correct, (b)
  is cheap. The native reader and OCR overlay draw their own UI (Kotlin) and
  need their own pass — though the *book* text is Korean/Chinese, so only
  chrome flips.
- **Fonts.** Inter and Fraunces (`App.js`) have no Thai, Arabic or Han glyphs,
  so those fall back to system fonts, mixing weights and line heights next to
  Inter. Mongolian (Cyrillic) is covered by Inter. Consider Noto Sans Thai and
  Noto Sans Arabic (or IBM Plex Sans Arabic) via `@expo-google-fonts`, and
  check Thai line height (tall vowel marks get clipped with tight
  `lineHeight`).
- **Thai line breaking**: Thai has no spaces; RN Android handles it via ICU,
  but check truncation (`numberOfLines`) in buttons and pills.
- **Text expansion**: ru/fr/es/vi strings are 20–40% longer; the floating
  Read/Learn pill and onboarding buttons need a long-string pass.

### Grammar of the UI
- **Plurals** are English-shaped: pairs like `profile.pagePlural` /
  `home.bookPlural` with a `{{count}}` placeholder. Russian needs one/few/many,
  Arabic six forms, while zh/ko/th/vi/id need none. Use `Intl.PluralRules`
  (available in Hermes) with keys like `pages.one / pages.few / pages.other`.
- **String concatenation**: grep for UI built from pieces (`t('x') + ' ' + n`)
  — word order differs. Replace with full-sentence templates.
- **Numbers**: some calls use `toLocaleString()` with no locale (device locale,
  not app language), e.g. `Profile.js:66`, `WordCheckModal.js:421`. Pass the
  interface language.

### Data and backend consistency
- `supabase/users_interface_language_ko.sql` constraint allows
  `('en','ko','fr','es','ar','mn','vi','th','id','ru','zh')` — **no `zh-Hant`**,
  but the app sends `zh-Hant`. Verify whether that upsert fails or is coerced;
  likely a silent sync failure for Traditional-Chinese UI users.
- `KRDICT_INTERFACE_LANGUAGES` has no `zh-Hant` or `ko` entry; a Traditional
  Chinese user gets KRDICT's Simplified Chinese glosses. Consider converting
  with OpenCC on the backend.

### Outside the app
- Store listings (Play, later App Store) only in English/Korean? Localize at
  least the title, short description and screenshots for the top 3–4 markets.
- Support/feedback email templates, Supabase auth emails (confirmation, reset)
  are English — Supabase templates are global, not per-user; would need a
  custom email hook.

## Model: separate "UI language" and "explanation language"?

Today one setting (`interfaceLanguage`) drives both. Cases where they differ:
a Vietnamese learner in Korea who wants an English UI but Vietnamese glosses; a
heritage learner who wants Korean UI while learning Chinese. Options:
1. Keep one setting (simplest; current).
2. Two settings: `uiLanguage` and `glossLanguage` (reuse the dead
   `nativeLanguage` field for the second). Backend already takes
   `interface_language` per request, so this is mostly frontend plumbing.
Recommend 1 for now, 2 only if users ask.

## How to add a new user language (checklist)

1. `frontend/constants/languages.js` — add to `KRDICT_INTERFACE_LANGUAGE_OPTIONS`
   (rename to `INTERFACE_LANGUAGE_OPTIONS`; it is no longer only about KRDICT).
2. `frontend/i18n/translations.js` — add a full table. Machine-draft with
   Claude from `en`, then a native reviewer. Add a test that every locale has
   every `en` key (and no extra keys).
3. `backend/main.py` — `LANGUAGE_DISPLAY_NAMES`; `KRDICT_INTERFACE_LANGUAGES`
   if KRDICT has it (KRDICT covers only its 11; e.g. Japanese, German would be
   machine-translated from English for Korean too).
4. Supabase — extend the `users_interface_language_supported` check.
5. `hanja.db` — new `hun_xx` column (generate + review), and zh character data.
6. Fonts — confirm glyph coverage; add a Noto font if needed.
7. TTS sample line in `services/listenPlayer.js`.
8. Store listing + screenshots.
9. QA pass on the phone: onboarding, reader lookup, Learn, Write feedback.

Splitting `translations.js` into one file per locale (`i18n/locales/fr.js`)
would make reviews and lazy loading easier; at 13k lines it is hard to diff.

## Phased plan (rough effort)

1. **Audit + quick fixes (2–3 days).** Audit table; writing feedback in the
   user's language; `toLocaleString` locales; `zh-Hant` constraint check;
   hanja `hun_*` spot fixes.
2. **Plurals and string hygiene (2–3 days).** `Intl.PluralRules` helper,
   convert the `*Plural` keys, locale completeness test, split translations
   per file.
3. **Typography (2–4 days).** Thai and Arabic fonts, line-height checks,
   long-string pass on pills/buttons.
4. **RTL (1–2 weeks).** Decide (a) vs (b); start/end styles; native chrome in
   Kotlin reader/overlay; test every screen in Arabic.
5. **Content parity (1–3 weeks, ongoing).** Per-language Chinese character
   data, offline KRDICT translations, translated onboarding/catalog blurbs,
   per-language quality labels ("machine translated").
6. **Store localization (2–3 days per wave).**

## Open questions

- Which user languages matter by actual users? (Check `app_telemetry` /
  `users.interface_language` distribution before investing in RTL.)
- Allow interface language = target language (immersion mode, e.g. Korean UI
  for advanced Korean learners)? Today it is blocked.
- Is Google-translated dictionary data acceptable, or should Claude generate
  learner-friendly glosses per language (more cost, better quality, needs
  review)?
- Who reviews translations — paid native reviewers, community, or users via an
  in-app "report translation" (the profile already has a translation-feedback
  disclaimer)?
- Add Japanese and German as user languages even though KRDICT lacks them?
- Should offline dictionaries ship all languages or download per user?
