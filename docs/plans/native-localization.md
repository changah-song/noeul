# Native Android localization

Goal: every string that native Android code draws follows the user's in-app
interface language (`getRuntimeInterfaceLanguage()`, 14 codes: en, zh, zh-Hant,
ko, fr, es, ar, mn, vi, th, id, ru, ja, pt), not the phone's locale.

## Audit

Scope: `frontend/modules/**/android/**` and `frontend/android/app/src/main/**`.

### Floating OCR overlay (`modules/screen-ocr-overlay`)

Already pushed from JS before this change: `OverlayText.kt` holds an English
fallback, and `modules/screen-ocr-overlay/src/index.js` pushes the `overlay.*`,
`pos.*`, `language.*` and `lookup.fromSurface` keys from `translations.js` via
`setInterfaceLanguage(language, strings)` before every native call.

| Where | Text | Before | Now |
| --- | --- | --- | --- |
| `ScreenOcrOverlayService` foreground notification | title, body | `OverlayText` (pushed) | same, plus persisted |
| Notification channel | name "Floating OCR", description | `OverlayText`, set only when the Service starts | same, and the channel is re-created on a language change, so its name in system settings follows |
| `FloatingWidgetController` bubble / dismiss target | content descriptions | `OverlayText` | same |
| `OcrResultOverlayView` | every label, eyebrow, button, empty state, hint, POS badge, error line (66 keys) | `OverlayText` | same |
| Translation header ("Korean → English") | language names | pushed for ko/en/zh/ja/es/fr only; other interface languages showed the raw code, e.g. "Korean → VI" | names for ar/mn/vi/th/id/ru/pt added (`nativeStrings.js` plus an English fallback in Kotlin) |
| `ScreenCaptureSession` | `virtualDisplayCreateFailed` error | **English only** (no `overlay.*` key) | `nativeStrings.js` |
| Errors thrown to JS (permission, capture state) | `OverlayText` messages | pushed | same |
| Service recreated before JS runs | everything above | **English** (in-memory only) | last bundle persisted in SharedPreferences (`noeul_native_overlay_strings`) and loaded in `Service.onCreate` |

### Native reader (`modules/native-epub-reader`)

| Where | Text | Before | Now |
| --- | --- | --- | --- |
| `ListenSessionService` media notification actions | Previous / Play / Pause / Next / Stop | **hard-coded English** | `ReaderText` (reuses `read.focusPreviousSentence`, `read.listenPlay`, `read.listenPause`, `read.focusNextSentence`, `read.listenStop`) |
| Listen notification channel | name "Listen" | **hard-coded English**, created once | `ReaderText` (`read.listen`), re-created on a language change |
| Listen notification title / text | book title / author or chapter | passed from JS (`Read.js`) as book data | unchanged (it is book data) |
| `EpubPageView` book-finished page | "BOOK FINISHED", "BACK TO LIBRARY", "N chapters · N words saved", "REVIEW N WORDS" | **hard-coded English** | `ReaderText` (`nativeStrings.js` plus `home.backToLibrary`, `learn.reviewWordsOne/Other`) |
| `NativeEpubReaderModule` edge state | chapter title fallback "Chapter N" | **hard-coded English** | `ReaderText.chapterNumber` |
| `PdfDocumentExtractor` | "Untitled", "Unknown author" | hard-coded | unchanged: these are stored data sentinels, not UI (see below) |
| `extractPdfDocument` failures (PDF import) | "Could not open PDF URI", "PDF has no pages to render", PdfRenderer's own corrupt or password errors | **English, shown as is** in the import-failed alert (`hooks/useBooks.js` shows `error.message`) | the module rethrows any failure as `ERR_PDF_IMPORT` with `ReaderText.pdfImportFailed` (the cause is kept for logs) |
| `renderPdfCover`, `EpubPaginator`, `ScreenOcrModule` | argument / cancellation exception messages | hard-coded | unchanged: developer errors that are not shown as text |

The book-finished page is currently disabled at both call sites
(`readerEdgeStateEnabled={false}` in `Read.js` and `SongReader.js`) but the
wrapper's default is `true`, so it is localized anyway.

`EpubPageView` has no toasts, dialogs, menus or content descriptions. Text
selection uses the app's own JS panel, not an Android ActionMode menu.

### App shell (`frontend/android/app/src/main`)

* `strings.xml`: `app_name` = "Noeul" (brand, not translated) and three
  `translatable="false"` Expo config values. No other entries.
* `MainActivity.kt`, `MainApplication.kt`: no user-visible strings.
* Manifests: only `android:label="@string/app_name"`.

## Design

**Mechanism: JS pushes a translated string map to native.** Native keeps an
English fallback and persists the last map in SharedPreferences.

* Source of truth: `frontend/i18n/translations.js` for text that already
  exists there, plus the new `frontend/i18n/nativeStrings.js` (14 locales) for
  native-only text. Keeping the new keys in a separate file avoids merge
  conflicts with the parallel JS-localization work in `translations.js`.
* `nativeStrings.js` exports `buildReaderNativeStrings(language)` (keys match
  `ReaderText.kt`) and `buildOverlayNativeExtras(language)` (merged into the
  existing overlay bundle, keys match `OverlayText.kt`). Templates keep their
  `{{count}}` / `{{number}}` placeholders; Kotlin fills them in.
* `services/interfaceLanguage.js` gained `subscribeRuntimeInterfaceLanguage`.
  `setRuntimeInterfaceLanguage` notifies listeners when the language changes.
  Both native wrappers subscribe at import time, so a running overlay
  notification or listen notification switches language immediately.
* Native reader: `NativeEpubReader.setInterfaceStrings(language, strings)`
  (module function, used by the listen service and on language change) and an
  `interfaceStrings` view prop. The prop follows the `themeTokens` pattern
  (`useMemo` in `NativeEpubReaderView.js`, keyed on `useTranslation().language`)
  so the strings arrive with the first render. `updateListenSession` pushes
  the strings first as well.
* Overlay: the existing `setInterfaceLanguage(language, strings)` bundle, now
  persisted.
* Persistence: `ReaderText` / `OverlayText` write the map to SharedPreferences
  (`noeul_native_reader_strings`, `noeul_native_overlay_strings`) and load it
  once per process in `Service.onCreate` / module `OnCreate`, unless JS has
  already pushed a fresher map.
* Notification channels: Android lets an app re-create an existing channel to
  rename it, so both services re-create theirs on a language change.

### Why not `AppCompatDelegate.setApplicationLocales`

* It recreates the Activity, which would tear down and reload the React Native
  root (and any open reader) whenever the user changes language.
* It changes the process locale that Hermes `Intl` reads, and
  `services/deviceLocale.js` uses that to detect the *phone* language for
  first-run defaults. That signal would be lost.
* It only helps text that lives in Android resources. Almost all native text
  here is drawn on a Canvas or built in Kotlin, so it would still need
  `values-xx/strings.xml` files in 14 languages. Those would duplicate
  `translations.js` and drift from it.
* The overlay already used the push approach. One mechanism for everything is
  simpler.

## Tests

`frontend/i18n/__tests__/nativeStrings.test.js` checks that:

* every interface language has a `nativeStrings` table with the full English
  key set, non-empty values, and matching placeholders;
* `buildReaderNativeStrings` returns exactly the keys in `ReaderText.kt`'s `EN`
  fallback (parsed from the Kotlin source), so JS and Kotlin can't drift;
* every `OverlayText.t("…")` key used in the overlay Kotlin sources is supplied
  by `translations.js` `overlay.*` or the native extras, for every language.

## Still English, and why

* `app_name` "Noeul": brand name.
* PDF import `Untitled` / `Unknown author` (`PdfDocumentExtractor`): stored as
  book metadata, the same sentinel the JS import code writes
  (`epubMetadata.js`, `bookCloudSync.js`). Localizing it at display time is a
  JS/data change, outside native scope.
* Developer-facing exception messages (`PDF cover page must be between…`,
  `Pagination was cancelled`, `Image uri is required`): these are not shown to
  users as text.
* Before the first app launch after install or update, nothing has been
  persisted, so a Service started by the system would show English. In
  practice both services are only started from JS.
