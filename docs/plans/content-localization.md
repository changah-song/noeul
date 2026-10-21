# Content localization (backend text and bundled data)

*Branch `loc/backend`, 2026-10-21. Follows up the "Content language" gaps in
[`user-language-support.md`](user-language-support.md). The UI strings in
`frontend/i18n/translations.js` are a separate piece of work; this covers the
text that comes from the backend or from bundled data files.*

Interface languages: `en, zh, zh-Hant, ko, fr, es, ar, mn, vi, th, id, ru, ja, pt`.

## How the backend knows the language

- Every request from the shared axios client (`frontend/services/api/client.js`)
  and the streaming explain request now sends **`X-Interface-Language`**.
- `backend/content_i18n.py` has `InterfaceLanguageMiddleware`, which reads the
  header for each request. `request_interface_language(explicit)` returns the
  first of: the body/query `interface_language`, the header, `"en"`.
  Unsupported codes become `"en"`. `zh-TW`/`zh-Hant` stay `zh-Hant`.
- Old app builds send no header and get the same behaviour as before.

## What changed, by area

### Writing feedback (`/assess_entry/`)
- The prompt moved to `backend/writing_assessment.py`. It names the learner's
  language and asks for every `explanation`, `suggestion_notes` entry,
  `patterns`/`strengths` entry and vocab `meaning` in that language.
  `suggestions` (the corrected text) and example sentences stay in the target
  language.
- **New request field:** `interface_language` (`frontend/services/api/assessEntry.js`
  sends it; it defaults to the app's current interface language). The header
  is the fallback. If the interface language is the target language (for
  example zh-Hant UI while learning Chinese), feedback is in English.
- **New response field:** `feedback_language`, the language the notes are
  in. Saved assessments keep the language they were written in.
- **`NATIVE_INSERT`** now means "a word or phrase in another language instead
  of the target language, usually the writer's own language (or English)".
  The type code is unchanged, because saved assessments on devices and in
  Supabase (`user_writing_entries.assessment`) and the Write legend use it.
  The Write screen label "Words you wrote in English" is now
  `write.otherLanguageWords` ("Words you wrote in another language").
- **Cache:** assessments are not cached on the server. The explanation cache
  (`lookup_cache`) and `translate_cache` keys already include the interface
  language.

### Every endpoint: error codes
Errors the app can show now have a stable `code`. The body is
`{"detail": "<English>", "code": "...", "params": {...}}`. `detail` stays
English for logs and older builds. The axios client
(`localizeErrorInPlace`) replaces `error.message` and `response.data.detail`
with text in the learner's language from `frontend/i18n/contentStrings.js`.
The English stays in `error.originalMessage` and `data.detail_en`, so every
existing `Alert`/`setError(error.message)` shows translated text without
screen changes. Errors without a code (network, timeout, old backend) map by
HTTP status or by axios error type.

| code | status | where | params |
|---|---|---|---|
| `ai_budget_exhausted` | 503 | any AI endpoint (global daily spend) | |
| `daily_quota_exceeded` | 429 | per-user general quota | |
| `explain_daily_limit` | 429 | `/explain_in_context/` (+ stream) | `limit` |
| `assess_daily_limit` | 429 | `/assess_entry/` | `limit` |
| `translate_budget_exhausted` | 503 | `/translate/` | |
| `translate_timeout` | 504 | `/translate/` | |
| `translate_failed` | 502 | `/translate/` | |
| `sign_in_required` | 403 | `/assess_entry/` for guests | |
| `auth_failed` | 401 | missing, expired or invalid token | |
| `forbidden` | 403 | wrong token role | |
| `service_unavailable` | 500/503 | a dependency or config is missing on the server | |
| `ai_unavailable` | 502 | Anthropic call failed (also the stream `error` event) | |
| `ai_bad_response` | 502 | unparseable or empty model output | |
| `song_search_unavailable` | 503 | `/songs/search/` | |
| `text_too_long` | 413 | any text over its limit | `limit` |
| `request_too_large` | 413 | body over the byte cap (`limits.py` middleware) | |
| `too_many_items` | 413 | `/krdict_search/`, `/translate_content/` | `limit` |
| `invalid_request` | 400 | malformed input | |
| `entry_required` | 400 | empty writing entry | |
| `entry_too_short_words` / `_characters` | 422 | writing entry length | `length`, `min` |
| `entry_too_long_words` / `_characters` | 422 | writing entry length | `length`, `max` |
| `not_found` | 404 | reserved | |

The list lives in `content_i18n.ERROR_CODES`. A test checks that every code
has a message in `contentStrings.js`. Never rename a code; add new ones.

### Every endpoint: AI and dictionary output
- `/explain_in_context/` (+ `/stream/`): already prompted in the interface
  language and cached per language. It now also falls back to the header.
- Chinese definitions (`/zh_dict_search/`, `/preprocess_chapter_zh/`) and
  English definitions (`/en_dict_search/`): when machine translation fails,
  the English definition used to be returned (and for zh cached on the
  server) **as if it were the learner's language**. It is now returned with
  `interface_language: "en"` and `fallback_language: "en"` and is not cached.
  The app shows its existing `lookup.englishFallbackNotice` and the reader
  drops it from its local cache, so the next lookup fetches the real
  translation.
- English-target paths keep `zh-Hant` distinct (zh-TW translations and their
  own cache rows) instead of collapsing to Simplified `zh`.
- Book level names: the backend still returns the stable English names
  ("Lower Elementary"). They are stored in books on devices and in Supabase,
  so the app translates them by rank at display time (`localizedLevelLabel`
  in `contentStrings.js`, used on Home and in the calibration result). HSK
  and CEFR names are the same in every language.
- No endpoint produces summaries, quizzes, book blurbs or word-check copy;
  those are bundled or in `translations.js`.

### Bundled content
- **Book blurbs:** `frontend/assets/data/public-domain/i18n/<lang>.json` has
  the title, genre and blurb for all 28 bundled books in the 13 non-English
  languages (drafted with Claude, not yet reviewed by native speakers).
  `catalogI18n.js` looks them up by catalog id with English fallback. Home
  uses it in the preview sheet (genre, blurb, level) and the starter card
  (translated title). It works offline.
- **Hanja meanings** (`hanja.db`): `hun_zh` was not a meaning for any row; it
  was a comment comparing the Korean and Chinese senses. The whole column was
  cleared. Broken values in other columns (model chatter, wrong script,
  untranslated English) were cleared too: about 450 characters and 2,400 word
  definitions. `backend/scripts/clean_hanja_translations.py` does this, can
  be re-run, and rewrote `hanja_manifest.json` so devices copy the new db.
  Languages with no column (ja, pt, zh-Hant, ko) and cleared values are
  machine-translated from English at lookup time
  (`services/api/hanjaRelated.js` → `localizeHanjaResult`).
- **Chinese character data** (`zh_characters.db`, English only): the
  definition, hint, phonetic-component definition and radical names are
  machine-translated at lookup time (`localizeChineseCharacterRows`). The
  formation type comes from `contentStrings.js`. A Korean UI uses the db's
  Korean radical names.
- **Why translate at lookup time instead of new columns:** hanja needs 3–4
  new languages × 6k characters and 22k word definitions. zh_characters needs
  13 languages × about 380k characters of English (about 5M characters, most
  of which nobody will ever look up). A learner looks up a few characters per
  session, so translating on demand costs a small fraction and needs no new
  binary assets.
- **The machine-translation endpoint:** **`POST /translate_content/`**
  `{texts: [≤64 strings ≤400 chars], kind, interface_language}` returns
  `{translations: [str|null], interface_language, source_language: "en",
  machine_translated}`. It uses `translate_cache` (keyed on text + source +
  target, shared across users) and the global daily character budget. It
  does not use `dictionary_cache`, because these are not dictionary stems.
  The app also keeps translations on the device
  (`services/contentTranslation.js`: memory plus AsyncStorage, up to 4,000
  per language), so a meaning seen once works offline.
- **Calibration / word-check / level names:** the word lists in
  `assets/data/calibration`, `word-check` and `vocab-size` are only target
  language words; there is no copy in them. Level names and descriptions are
  in `contentStrings.js` (`level.*`). The copy around them is in
  `translations.js`.

## Offline: what stays English
English is shown offline only with a label:
- **Hanja meanings / Chinese character data** that were never translated on
  this device: English, with "Shown in English. Translations into your
  language need an internet connection." (`content.englishFallbackOffline`)
  in the hanja section and the character breakdown. When the server has no
  translation, the label is `content.englishFallback`.
- **Dictionary entries:** the device has no offline dictionary, only cached
  rows in the learner's language, so offline lookups don't show unlabelled
  English. Live English fallbacks show `lookup.englishFallbackNotice`.

Still English, and why:
- **Reader inline glosses** (`readerAnnotations.js`) use an English row when
  no row in the learner's language is cached. These are tiny labels under
  words with no room for a notice. Korean chapter preprocessing still caches
  English glosses (`ko_dict.db` is English-only).
- **Overlay (native) and Learn hanja tiles** get the translated meanings but
  no "English" label when a meaning falls back to English.
- **English-target word parts and etymology** (Wiktionary) are English: it is
  English-learning content.
- **Korean definitions for zh-Hant** come from KRDICT's Simplified Chinese.
  OpenCC conversion is a possible follow-up.
- **`hun_english` errors:** some English meanings in hanja.db are wrong
  (寡 = "enemy", 刻 = "new path"). Machine translation copies those errors.
  The source data needs a review.
- **Catalog attribution lines** ("Public domain (PD-old-80-1996)", source
  names) are legal/source notes and are kept verbatim.
- **Server-only messages** (`detail`) stay English by design. The app shows
  the coded translation.

## Deploy / migration
- **Backend redeploy needed** (new modules `content_i18n.py`,
  `writing_assessment.py`, new route `/translate_content/`, coded errors). No
  database migration: `translate_cache` already exists in `cache.db`.
- **No Supabase SQL.**
- **App release needed** for the header, error mapping, catalog
  translations, cleaned hanja.db (the manifest change makes devices re-copy
  it) and on-demand content translation. Old app + new backend: same as
  before, plus `code` fields it ignores. New app + old backend: no codes, so
  errors map by HTTP status; `/translate_content/` returns 404, so content
  stays English with the label.

## Tests
- Backend: `test_content_i18n.py` (language resolution, middleware, codes,
  prompt), `test_main_localization.py` (endpoints through main.py; skipped in
  CI's minimal environment), `test_clean_hanja_translations.py` (cleaner +
  the bundled db is clean).
- Frontend: `services/__tests__/contentLocalization.test.js` (14-locale
  completeness and placeholders, error mapping, level names, catalog
  coverage, header + error localization in the axios client) and
  `contentTranslation.test.js` (cache, offline/unavailable, hanja and Chinese
  character localization).
