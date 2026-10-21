# Frontend localization audit

Goal: in every interface language (`KRDICT_INTERFACE_LANGUAGE_OPTIONS`: en, zh,
zh-Hant, ko, fr, es, ar, mn, vi, th, id, ru, ja, pt) all user-facing text in the
React Native app is in that language. Scope: `frontend/screens`, `components`,
`hooks`, `services` that produce UI text, `constants`, `App.js`. Native
Kotlin (`modules/**`, `android/**`) and bundled content / backend text are
covered by the other localization passes.

Method: an AST scan (Babel) of every string literal, template literal and JSX
text node, plus targeted greps for `Alert.alert`, `ToastAndroid`, `Share`,
`error.message`, `toLocale*`/`Intl`, `+ 's'`, and `${t(...)} ${n}`
concatenation. Each hit was checked by hand. Dev-only logs, `console.*`,
tests and comments were ignored.

Legend: [x] fixed · [-] intentionally left (reason given)

## Infrastructure

- [x] `services/interfaceLanguage.js`: new `formatNumber`, `formatDate`,
  `getInterfaceLocale` (interface language, never the phone locale; Arabic
  uses `ar-u-nu-latn` so formatted numbers match the Latin digits used
  everywhere else) and `tRuntime` for code outside React.
- [x] `i18n/userFacing.js`: `getUserFacingErrorMessage` (keeps a message only
  if it is already a UI string of the current language, otherwise a
  translated fallback / network message), `getAuthErrorMessage` (Supabase
  auth codes and messages to `auth.error*`), `localizeStoredPlaceholder` /
  `stripStoredPlaceholder` (legacy "Untitled"/"Unknown author"/"Untitled
  song"/"Unknown artist", in English or any interface language, shown in the
  current language), `localizeGeneratedSectionLabel` ("Page 3", "Pages 3-5",
  "Front matter" from PDF sectioning), `getLocalizedLanguageName`,
  `localizeBookLevelLabel` (stored 초급/중급/고급).
- [x] `scripts/mergeTranslations.mjs`: merges a batch of keys into all 14
  tables of `i18n/translations.js` (insert, fix, remove) and verifies order,
  placeholders and values.
- [x] `i18n/__tests__/hardcodedStrings.test.js`: regression guard (below).

## Hard-coded strings and how they were fixed

| File | String / pattern | Fix |
| --- | --- | --- |
| `screens/Profile.js` | guest display name `'Reader'` (+ `=== 'Reader'` check) | `profile.defaultName`; name editor starts empty instead of comparing to English |
| `screens/Profile.js` | `toLocaleString()` vocab estimate, `toLocaleDateString` "learning since" | `formatNumber`, `formatDate` |
| `screens/Profile.js` | sign-out / delete-account / rename alerts showed `error.message`, fallback `profile.preferenceSoon` ("This preference will be configurable soon") | `getUserFacingErrorMessage(…, 'common.genericError')` |
| `screens/Auth.js` | `placeholder="you@example.com"` | `auth.emailExample` |
| `screens/Auth.js` | sign-in / Google / Apple alerts showed raw Supabase `error.message` | `getAuthErrorMessage` + 7 `auth.error*` keys |
| `screens/Home.js` | `t ? t(key) : 'English'` fallbacks (Untitled, Unknown author, Unknown, Not opened yet, Ready to read, Available to download, Progress, Public domain text, `N words`, song-storage alert text, diagnostics) | helpers default to `tRuntime`; English fallbacks removed |
| `screens/Home.js` | `formatWordCount` / song word count via `toLocaleString()` | `formatNumber` |
| `screens/Home.js` | file sizes `` `${n} ${'B'|'KB'|'MB'|'GB'}` `` | `common.size*` templates + `formatNumber` |
| `screens/Home.js` | last-opened date `toLocaleDateString(language ?? undefined)` | `formatDate` |
| `screens/Home.js` | `formatBookLanguage` English names via `getLanguageLabel` | `getLocalizedLanguageName` |
| `screens/Home.js` | shelf count labels built as `{{count}} {{noun}}` with `bookSingular/bookPlural` | full sentences `home.{bookCount,favoriteCount,publicDomainCount}{One,Other}` |
| `screens/Home.js` | filter chip a11y label `` `${filter}, ${count} ${t('home.bookPlural')}` `` | `home.filterWithCount` + count sentence |
| `screens/Home.js` | book title/author display of stored "Untitled"/"Unknown author" | `localizeStoredPlaceholder` in `getBookTitle`/`getBookAuthor` (shelf, carousel, preview, delete alert) |
| `screens/Home.js` | metadata reset / edit / public-library patch stored translated or English placeholders | store empty strings; display translates |
| `screens/Home.js` | song list artist/title "Unknown artist"/"Untitled song" | `localizeStoredPlaceholder` |
| `screens/Home.js` | preview level shows stored Korean grade 초급/중급/고급 | `localizeBookLevelLabel` (`bookLevel.ko*`) on top of the backend's `localizedLevelLabel` |
| `screens/Home.js` | OCR / reset alerts showed `error.message` | `getUserFacingErrorMessage` |
| `screens/Home.js` | public-library diagnostics (internal stage ids, raw errors, Supabase table names) shown to every user while loading | rendered only in `__DEV__` |
| `screens/Home.js` | `PDF` badge, `Noeul` app title | [-] brand/format names, allow-listed |
| `screens/Read.js` | `` `${t('read.chapter')} ${n}` `` (header, a11y) | `read.chapterNumber` |
| `screens/Read.js` | progress `` `${n}%` `` | `common.percent` |
| `screens/Read.js` | file size `toFixed(1)` | `formatNumber` |
| `screens/Read.js` | chapter titles from PDF sectioning ("Page 3") | `localizeGeneratedSectionLabel` |
| `screens/Read.js` | header title / listen-session subtitle from stored placeholders | `stripStoredPlaceholder` |
| `screens/Read.js` | book-load error panel showed `error.message` | `getUserFacingErrorMessage` |
| `screens/Read.js` | `LINE_SPACING_STEPS` English labels (Compact, Regular…) | [x] removed (unused; the sheet uses `read.lineSpacing*`) |
| `screens/Read.js` | `BOOK_LEVEL_LABELS` (A1…, HSK n, 초급…) | [-] stored data; displayed through level helpers |
| `screens/Learn.js` | English month arrays `Jan…Dec`, `January…` fallback, default `'not seen'`, `'saved word'` | `formatDate`; `tRuntime('learn.savedWord')` |
| `screens/Learn.js` | `` `${t('learn.learnedTab')} ${n}` `` | `learn.learnedTabCount` |
| `screens/Learn.js` | summary stat numbers | `formatNumber` |
| `screens/Learn.js` | "From {{title}}" / source labels with stored "Untitled" | `stripStoredPlaceholder` |
| `screens/Write.js` | 110 English writing prompts (`RAW_EDITOR_PROMPTS`) | `write.prompt.<category>.<n>` (stored prompt stays English as its identity; older `write.prompts.*` texts map too) |
| `screens/Write.js` | annotation legend/badges `Grammar`, `Word choice`, `Translation`, `Unnatural` | `write.annotation.*` |
| `screens/Write.js` | built-in sample entry: prompt + 30 English feedback strings (`services/writingAssessmentMock.js`) | `write.sample.*` via `localizeMockWritingEntry` |
| `screens/Write.js` | `{t('write.chars', { count: '' }).trim() || 'chars'}` beside a bare number | one `write.chars` sentence with `formatNumber` |
| `screens/Write.js` | assessment error showed backend `detail` | `getUserFacingErrorMessage` (backend now localizes coded errors; English detail falls back) |
| `screens/Write.js` | entry dates `Intl.DateTimeFormat(language)` | `getInterfaceLocale` |
| `screens/Write.js` | new entry title stored as translated "Untitled" | stored empty; display translates |
| `screens/Write.js` | `B` / `I` / `U` format buttons | [-] single-letter symbols with translated a11y labels |
| `screens/ScreenshotOcr.js` | `LAB` eyebrow | `ocr.labEyebrow` |
| `screens/ScreenshotOcr.js` | `{{count}} tappable {{noun}}` with `itemSingular/itemPlural` | `ocr.{foundItems,testFoundItems}{One,Other}` |
| `screens/ScreenshotOcr.js` | errors shown via `error.message` | `getUserFacingErrorMessage` |
| `screens/ScreenshotOcr.js` | `OCR` button | [-] acronym, allow-listed |
| `components/Read/TocDrawer.js` | `` `${t('read.chapter')} ${n}` ``, `{n}%`, PDF "Page n" position labels and section titles | `read.chapterNumber`, `common.percent`, `localizeGeneratedSectionLabel` |
| `components/Read/NotesLogSheet.js` | `toLocaleDateString(language ?? undefined)`, `` `${n}%` ``, stored chapter labels | `formatDate`, `common.percent`, `localizeGeneratedSectionLabel` |
| `components/Read/SavedWordsPanel.js` | `toLocaleDateString` | `formatDate` |
| `components/Read/ListenBar.js`, `ListenVoiceSheet.js` | `` `${rate}×` `` | `read.listenRateValue` + `formatNumber` |
| `components/Read/TopSection/TopSection.js` | translate-panel header "Korean → Français" (English source name, endonym target) | both via `getLocalizedLanguageName` (+ `language.*` for all 14 interface languages) |
| `components/Read/TopSection/DictionaryContent.js` | `US` / `UK` pronunciation buttons | `lookup.accentUs` / `lookup.accentUk` |
| `components/Read/TopSection/DictionaryContent.js` | `` `variant of ${ref}: ${sense}` `` | `lookup.variantOf` |
| `components/Read/TopSection/DictionaryContent.js`, `TranslationContent.js` | explain / dictionary / translation errors showed `error.message` | `getUserFacingErrorMessage` |
| `components/Songs/SongReader.js` | header title/artist, delete alert with stored placeholders; edit stored translated "Unknown artist" | `localizeStoredPlaceholder`; store empty |
| `components/Home/BookList.js` | stored title/author placeholders | `localizeStoredPlaceholder` |
| `components/shared/VocabLevelModal.js`, `WordCheckModal.js` | `Number(threshold).toLocaleString()` | `formatNumber` |
| `components/shared/CalibrationQuizModal.js` | English level names ("Lower Elementary") | resolved in favour of the backend branch's `localizedLevelLabel` (content strings) |
| `hooks/useBooks.js` | `getLanguageLabel` English fallback for unsupported book languages | `getLocalizedLanguageName` |
| `hooks/useBooks.js` | import-failed alert showed `error.message`; untitled fallback stored translated | `getUserFacingErrorMessage`; store empty (and untitled books never dedupe by metadata) |
| `services/pdfMetadata.js` | stored `'Untitled'` title; native "Untitled"/"Unknown" metadata | store `''`; PDF "Untitled"/"Unknown author" metadata treated as missing |
| `services/epubMetadata.js` | stored `'Unknown author'` | store `''` |
| `services/bookCloudSync.js`, `publicLibraryService.js` | `'Untitled'` / `'Unknown author'` defaults on download/upload | `''` |
| `services/songCloudSync.js` | `'Untitled song'` / `'Unknown artist'` defaults | [-] kept as sentinels (empty song titles are dropped by the song list); shown translated |
| `services/songStorageLimits.js` | `toFixed(1) MB` in the user-facing message | `common.sizeMegabytes` + `formatNumber` (English `error.message` kept for logs) |
| `services/overlayLookup.js`, `dictionaryLookup.js` | `'No text selected.'`; raw `error.message` forwarded to the overlay / lookup panel | `lookup.noTextSelected`; `getUserFacingErrorMessage` |
| `services/accountDeletion.js`, `api/*`, `supabaseFetch.js`, `localOwner*`, `localUserData.js`, `epubMetadata.js`, `publicLibraryService.js` … | English `Error` messages | [-] developer messages; every screen that surfaced them now maps through `getUserFacingErrorMessage` |
| `services/listenPlayer.js` | voice sample sentences | [-] spoken in the voice's language on purpose |
| `services/profilesCloudSync.js` | default profile `display_name` = English language name | [-] stored only, never rendered |
| `constants/languages.js` | interface-language endonyms (English, Français…) | [-] language pickers list endonyms by convention |
| `constants/proficiencyLevels.js` | English level names / descriptions | [-] identifiers for alias matching; UI uses `localizedLevelLabel` |
| `App.js` | local-data decision alert showed `error.message` | `getUserFacingErrorMessage` |
| Notifications | none in the app | n/a |

Plurals: no code appends an English `s`. `*One`/`*Other` pairs are chosen with
`count === 1`; for Russian and Arabic, whose noun form changes with the
number, the `Other` strings use count-neutral patterns ("Книг: {{count}}",
"عدد الكتب: {{count}}") so they read correctly for any number.

## New keys

201 keys added to all 14 tables (merged with `scripts/mergeTranslations.mjs`), 9 noun-injection keys removed: `home.publicDomainCount`, `home.favoriteCount`, `home.bookCount`, `home.bookSingular`, `home.bookPlural`, `ocr.foundItems`, `ocr.testFoundItems`, `ocr.itemSingular`, `ocr.itemPlural`.

Groups: `common.*` errors/sizes/percent, `auth.error*`, `auth.emailExample`, `profile.defaultName`, `home.*Count{One,Other}`, `home.filterWithCount`, `bookLevel.ko*`, `language.*` (all interface languages), `learn.learnedTabCount`, `read.chapterNumber`/`pageNumber`/`pageRange`/`frontMatter`/`listenRateValue`, `lookup.accentUs`/`accentUk`/`variantOf`/`noTextSelected`, `ocr.*Items{One,Other}`/`labEyebrow`, `write.annotation.*`, `write.prompt.{reflective,persuasive,creative,sandbox}.N` (110), `write.sample.*` (31).

## Leftover English / wrong translations fixed in existing keys

Found by flagging values identical to English, Latin-script words in non-Latin tables (brand names excepted), mostly-English wording in Latin-script tables, and Russian/Arabic count strings; each flag was reviewed per language and only real problems changed. `overlay.*` keys (native overlay) and dev-only diagnostics were left to their owners.

### fr (2)

| Key | Now | Why |
| --- | --- | --- |
| `onboarding.extraFocus` | Concentration | English 'Focus' left as-is; use French 'Concentration' (consistent with read.focusMode 'Mode concentration') |
| `read.settingsTabFocus` | Concentration | English 'Focus' left as-is; use French 'Concentration' (consistent with read.focusMode 'Mode concentration') |

### es (1)

| Key | Now | Why |
| --- | --- | --- |
| `profile.sectionApp` | Aplicación | English 'App' left as section header; Spanish UI typically uses 'Aplicación' |

### ar (6)

| Key | Now | Why |
| --- | --- | --- |
| `learn.reviewWordsOther` | مراجعة الكلمات ({{count}}) | 'كلمات' is only grammatical for 3-10; use count-neutral pattern |
| `learn.seenTimesOther` | عدد المرات: {{count}} | 'مرات' is only grammatical for 3-10; use count-neutral pattern |
| `learn.reviewedOther` | عدد الكلمات التي راجعتها: {{count}}. | 'كلمات' is only grammatical for 3-10; use count-neutral pattern |
| `profile.pagePlural` | عدد الصفحات: {{count}} | 'صفحات' is only grammatical for 3-10; use count-neutral pattern |
| `profile.aboutPagePlural` | عدد الصفحات: {{count}} تقريبًا | 'صفحات' is only grammatical for 3-10; use count-neutral pattern |
| `savedFade.learnedMany` | الكلمات المُتعلَّمة: {{count}} | 'كلمة' after a number is only grammatical for 11+; use count-neutral pattern |

### mn (3)

| Key | Now | Why |
| --- | --- | --- |
| `auth.noAppleIdentityToken` | Apple-ийн таних токен ирсэнгүй | English word "identity" left untranslated |
| `auth.missingGoogleClientId` | Google клиент ID алга. EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID эсвэл EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID-г frontend/.env-д нэмнэ үү. | English word "client" left in Latin script |
| `ocr.screenshotTitle` | Дэлгэцийн агшны OCR | Ungrammatical/inconsistent; align with "Дэлгэцийн агшны OCR" used elsewhere |

### vi (1)

| Key | Now | Why |
| --- | --- | --- |
| `home.publicLibraryEmptyBody` | Truy vấn public_library đã hoàn tất nhưng không trả về cuốn sách nào cho ngôn ngữ bạn đang học. | 'ngôn ngữ học' means 'linguistics'; replaced with 'ngôn ngữ bạn đang học' (the language you are learning) |

### th (3)

| Key | Now | Why |
| --- | --- | --- |
| `ocr.bubbleStarted` | ปุ่ม OCR แบบลอยเริ่มทำงานแล้ว | 'ฟอง' (foam/soap bubble) is a literal calque; Thai UI calls a floating bubble button 'ปุ่มลอย' |
| `ocr.bubbleFailed` | ปุ่ม OCR แบบลอยไม่เริ่มทำงาน | 'ฟอง' literal calque for UI bubble; use 'ปุ่ม' (button) |
| `ocr.bubbleStopped` | ปุ่ม OCR แบบลอยหยุดทำงานแล้ว | 'ฟอง' literal calque for UI bubble; use 'ปุ่ม' (button) |

### id (1)

| Key | Now | Why |
| --- | --- | --- |
| `ocr.androidOnlyBadge` | Khusus Android | 'Android saja' is an unnatural calque; 'Khusus Android' is the standard badge wording |

### ru (3)

| Key | Now | Why |
| --- | --- | --- |
| `learn.seenTimesOther` | Раз: {{count}} | "{{count}} раз" is ungrammatical for 2-4 (раза); use count-neutral pattern |
| `read.nativePdfAndroidOnly` | Встроенное извлечение текста из PDF доступно только на Android. | "Нативное" is developer jargon; use natural "встроенное" |
| `read.nativeReaderAndroidOnly` | Встроенная отрисовка книг пока доступна только на Android. | "Нативная" is developer jargon; use natural "встроенная" |

### zh (1)

| Key | Now | Why |
| --- | --- | --- |
| `ocr.floatingTitle` | 悬浮 OCR | Inconsistent term: other floating-OCR strings use 悬浮, not 浮动 |

### zh-Hant (122)

| Key | Now | Why |
| --- | --- | --- |
| `profile.translationDisclaimer` | 其他語言的翻譯可能不夠準確。如有意見回饋或想提供協助，請聯絡 casong00@gmail.com。 | Mainland 反饋/幫助 -> Taiwan 意見回饋/協助 |
| `auth.missingGoogleClientId` | 缺少 Google 用戶端 ID。請將 EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID 或 EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID 新增到 frontend/.env。 | Mainland 客戶端 -> Taiwan 用戶端 |
| `auth.noGoogleIdToken` | 未收到 Google ID 權杖 | Mainland 令牌 -> Taiwan 權杖 |
| `auth.noAppleIdentityToken` | 未收到 Apple 身分權杖 | Taiwan 身分/權杖 instead of mainland 身份/令牌 |
| `home.publicLibraryEmptyBody` | public_library 查詢已完成，但目前的學習語言沒有傳回任何書籍。 | Mainland 返回 (return results) -> 傳回; smoother wording |
| `read.nativePdfAndroidOnly` | 原生 PDF 擷取僅在 Android 上可用。 | Mainland 提取 -> Taiwan 擷取 |
| `ocr.floatingTitle` | 懸浮 OCR | Inconsistent 浮動 vs 懸浮 used elsewhere |
| `ocr.selectedFloating` | 已從懸浮 OCR 選取文字。 | Mainland 文本/選擇 -> Taiwan 文字/選取 |
| `localData.offlineFoundBody` | 此裝置上有訪客進度，而此帳號可能已有雲端資料。請先選擇處理方式，雲端同步才會恢復。 | Simplified character 云 in 云端; also 帳戶 -> 帳號, 雲同步 -> 雲端同步 |
| `auth.missingInfoBody` | 請輸入電子郵件和密碼。 | Mainland 郵箱 -> Taiwan 電子郵件 |
| `auth.checkEmailTitle` | 請查看電子郵件 | Mainland 郵件/查收 -> Taiwan 電子郵件 |
| `auth.checkEmailBody` | 請驗證電子郵件地址以完成帳號升級。 | Mainland 郵箱/帳戶 -> 電子郵件/帳號 |
| `auth.email` | 電子郵件 | Mainland 郵箱 -> Taiwan 電子郵件 |
| `auth.emailPlaceholder` | 電子郵件 | Mainland 郵箱 -> Taiwan 電子郵件 |
| `auth.failedTitle` | 驗證失敗 | Mainland 認證 -> Taiwan 驗證 |
| `profile.copyEmail` | 複製電子郵件地址 | Mainland 郵箱 -> Taiwan 電子郵件 |
| `profile.personalizedVocab` | 個人化詞彙 | Mainland 個性化 -> Taiwan 個人化 |
| `profile.checkMyLevel` | 測一測我的程度 | Mainland 水平 -> Taiwan 程度 |
| `calibration.title` | 找出你的程度 | Mainland 水平 -> Taiwan 程度 |
| `calibration.resultEyebrow` | 你的程度 | Mainland 水平 -> Taiwan 程度 |
| `profile.setVocabLevel` | 設定詞彙程度 | Mainland 水平 -> Taiwan 程度 |
| `profile.vocabLevel` | 詞彙程度 | Mainland 水平 -> Taiwan 程度 |
| `vocabLevel.title` | 你的詞彙程度 | Mainland 水平 -> Taiwan 程度 |
| `vocabLevel.confirm` | 設定我的程度 | Mainland 水平 -> Taiwan 程度 |
| `vocabLevel.saved` | 詞彙程度已儲存 | Mainland 水平 -> Taiwan 程度 |
| `profile.readingLevel` | 閱讀程度 | Mainland 水平 -> Taiwan 程度 |
| `profile.levelDescription.nearNative` | 接近母語程度 | Mainland 水平 -> Taiwan 程度 |
| `home.readingEaseUnavailable` | 等我們了解這本書的閱讀程度後，就會估算它對你的難易度。 | Mainland 水平 -> 程度; 瞭解 -> 了解 (consistent with rest of table) |
| `wordCheck.resultAdvanced` | 大部分高階詞彙你都認識 | Consistency with 高階 used elsewhere |
| `profile.account` | 帳號 | Mainland 帳戶 -> Taiwan 帳號 |
| `profile.logoutBody` | 選擇是否在此裝置上保留這個帳號的快取資料。 | Mainland 帳戶 -> Taiwan 帳號 |
| `profile.deleteAccount` | 刪除帳號 | Mainland 帳戶 -> Taiwan 帳號 |
| `profile.deleteAccountTitle` | 刪除帳號？ | Mainland 帳戶 -> Taiwan 帳號 |
| `profile.deleteAccountBody` | 這將永久刪除你的帳號及所有相關資料——閱讀檔案、已儲存的單字、寫作和偏好設定。此操作無法復原。 | Mainland 帳戶 -> Taiwan 帳號 |
| `profile.deleteAccountConfirm` | 刪除帳號 | Mainland 帳戶 -> Taiwan 帳號 |
| `profile.deleteAccountFailed` | 無法刪除帳號 | Mainland 帳戶 -> Taiwan 帳號 |
| `profile.logout` | 登出 | Mainland 退出登入 -> Taiwan 登出 |
| `profile.loggingOut` | 正在登出... | Mainland 退出登入 -> Taiwan 登出 |
| `profile.logoutTitle` | 要登出嗎？ | Mainland 退出登入 -> Taiwan 登出 |
| `profile.signOutFailed` | 登出失敗 | Mainland 退出登入 -> Taiwan 登出 |
| `read.preparingHighlights` | 正在準備智慧標示 | Mainland 高亮 -> Taiwan 標示 |
| `read.enterFullscreen` | 進入全螢幕 | Mainland 全屏 -> Taiwan 全螢幕 |
| `read.exitFullscreen` | 結束全螢幕 | Mainland 退出全屏 -> Taiwan 結束全螢幕 |
| `read.fontSize` | 字體大小 | Mainland 字號 -> Taiwan 字體大小 |
| `song.fontSize` | 字體大小 | Mainland 字號 -> Taiwan 字體大小 |
| `read.decreaseFontSize` | 縮小字體 | Mainland 字號 -> Taiwan 字體 |
| `read.increaseFontSize` | 放大字體 | Mainland 字號 -> Taiwan 字體 |
| `song.decreaseFont` | 縮小歌詞字體 | Mainland 字號 -> Taiwan 字體 |
| `song.increaseFont` | 放大歌詞字體 | Mainland 字號 -> Taiwan 字體 |
| `read.scrollMode` | 捲動模式 | Mainland 滾動 -> Taiwan 捲動 |
| `read.checkpointsEmptyBody` | 點按書籤記住目前位置，長按可以留下筆記。 | Mainland 點擊 -> 點按 (consistent with table) |
| `read.checkpointsEmpty` | 還沒有儲存任何內容。點按書籤圖示儲存目前位置，長按可留下一則筆記。 | Taiwan measure word 則 for notes |
| `read.deleteNoteConfirmTitle` | 刪除這則筆記？ | Taiwan measure word 則 for notes |
| `read.bookTooLarge` | 這本書對目前裝置上的閱讀器來說似乎太大了。請改用較小的檔案再試一次。 | Mainland 當前 -> Taiwan 目前 |
| `read.candidatesRefreshHint` | 每天更新精選。已儲存的單字會從清單中移除。 | Mainland 列表 -> Taiwan 清單 |
| `lookup.englishFallbackNotice` | 正在顯示英文釋義——你所用語言的辭典暫時無法使用 | 詞典 -> 辭典 (consistent with table) |
| `lookup.notInDictionary` | 辭典中未收錄 | 詞典 -> 辭典 (consistent with table) |
| `lookup.fetchingDefinitions` | 正在取得釋義... | Mainland 獲取 -> Taiwan 取得 |
| `lookup.previousDetectedWord` | 上一個辨識出的單字 | Mainland 識別 -> Taiwan 辨識 |
| `lookup.nextDetectedWord` | 下一個辨識出的單字 | Mainland 識別 -> Taiwan 辨識 |
| `hanja.fetchingDetails` | 正在取得詳細資訊... | Mainland 獲取/詳情 -> Taiwan 取得/詳細資訊 |
| `chinese.exampleReadings` | 讀音範例 | Mainland 示例 -> Taiwan 範例 |
| `chinese.noRelatedPhonetic` | 找不到相關的聲旁範例。 | Mainland 示例 -> Taiwan 範例 |
| `home.genre` | 類型 | Bad conversion 型別 (programming "type") -> 類型 |
| `home.noMatchesTitle` | 沒有符合的結果 | Mainland 匹配 -> Taiwan 符合 |
| `home.noMatchesBody` | 沒有符合這些篩選條件的公版書。試試放寬等級或類型。 | Bad conversion 型別 -> 類型 |
| `home.ascending` | 遞增 | Mainland 升序 -> Taiwan 遞增 |
| `home.descending` | 遞減 | Mainland 降序 -> Taiwan 遞減 |
| `home.publicDomainHint` | 瀏覽目前學習語言的公版書。 | Mainland 當前 -> Taiwan 目前 |
| `home.currentReading` | 正在閱讀 | Mainland 當前 -> Taiwan wording |
| `home.autoDetectionSoon` | 自動偵測即將推出 | Mainland 檢測 -> Taiwan 偵測 |
| `home.publicDomainText` | 公版作品 | Mainland 文本 -> Taiwan wording |
| `home.songStorageLimitFallback` | 已儲存的歌曲太大，無法儲存在本機。 | Mainland 本地 -> Taiwan 本機 |
| `home.diagnosticRows` | 列數：{{count}} | Taiwan uses 列 for table rows (行 = columns/lines) |
| `home.diagnosticLocalChecks` | 本機檢查：{{count}} | Mainland 本地 -> Taiwan 本機 |
| `home.diagnosticDownloadedLocally` | 已下載至本機：{{count}} | Mainland 本地 -> Taiwan 本機 |
| `home.ocrAllowOverlay` | 允許顯示在其他應用程式上層，以使用懸浮掃描。 | Mainland 應用 -> Taiwan 應用程式 |
| `home.ocrOverlayDenied` | 未允許顯示在其他應用程式上層。 | Mainland 應用 -> Taiwan 應用程式 |
| `home.ocrCaptureStopped` | 螢幕擷取已停止。 | Mainland 捕獲 -> Taiwan 擷取 |
| `home.ocrAllowCapture` | 允許一次螢幕擷取以開始本次掃描。 | Mainland 捕獲 -> Taiwan 擷取 |
| `home.ocrCaptureDenied` | 未允許螢幕擷取。 | Mainland 捕獲 -> Taiwan 擷取 |
| `home.resetUnavailableTitle` | 無法重設 | Mainland 重置 -> Taiwan 重設 |
| `home.resetFailedTitle` | 重設失敗 | Mainland 重置 -> Taiwan 重設 |
| `ocr.noKoreanText` | 這張圖片中找不到韓文文字。 | Mainland 文本 -> Taiwan 文字 |
| `ocr.noTextBlocks` | 找不到文字區塊。 | Mainland 文本塊 -> Taiwan 文字區塊 |
| `ocr.recognizing` | 正在辨識文字 | Mainland 識別 -> Taiwan 辨識 |
| `ocr.status.overlayPermissionGranted` | 已授予懸浮視窗權限。 | Bad conversion 許可權 (权限) -> 權限; 懸浮窗 -> 懸浮視窗 |
| `ocr.status.overlayPermissionDenied` | 懸浮視窗權限遭拒。 | Bad conversion 許可權 -> 權限 |
| `ocr.overlayGranted` | 已授予懸浮視窗權限。 | Bad conversion 許可權 -> 權限 |
| `ocr.overlayDenied` | 尚未授予懸浮視窗權限。 | Bad conversion 許可權 -> 權限 |
| `ocr.status.screenCaptureRequested` | 螢幕擷取已開始。 | Mainland 捕獲 -> Taiwan 擷取 |
| `ocr.status.screenCaptureDenied` | 螢幕擷取遭拒。 | Mainland 捕獲 -> Taiwan 擷取 |
| `ocr.status.screenCaptureStartFailed` | 無法啟動螢幕擷取。 | Mainland 捕獲 -> Taiwan 擷取 |
| `ocr.captureActive` | 螢幕擷取進行中。 | Mainland 捕獲/執行中 -> Taiwan 擷取/進行中 |
| `ocr.captureDenied` | 螢幕擷取未獲授權。 | Mainland 捕獲 -> Taiwan 擷取 |
| `vocabLevel.backToList` | 返回清單 | Mainland 列表 -> Taiwan 清單 |
| `song.back` | 返回歌曲清單 | Mainland 列表 -> Taiwan 清單 |
| `write.backList` | 返回寫作清單 | Mainland 列表 -> Taiwan 清單 |
| `home.listView` | 清單檢視 | Mainland 列表 -> Taiwan 清單 |
| `onboarding.extraFlashcards` | 單字卡 | Mainland 閃卡 -> Taiwan 單字卡 (consistent with learn.flashcard) |
| `learn.filters.starred` | 已加星號 | Mainland 星標 -> Taiwan 加星號 |
| `write.archive` | 封存 | Mainland 歸檔 -> Taiwan 封存 |
| `write.new` | + 新增 | Mainland 新建 -> Taiwan 新增 |
| `write.assessingEntry` | 正在取得 AI 點評… | Mainland 獲取 -> Taiwan 取得 |
| `write.assessError` | 無法取得 AI 點評。你的文章已儲存為草稿。 | Mainland 獲取 -> Taiwan 取得 |
| `write.getAiFeedback` | 取得 AI 點評 | Mainland 獲取 -> Taiwan 取得 |
| `localData.legacyTitle` | 發現本機資料 | Mainland 本地 -> Taiwan 本機 |
| `localData.legacyBody` | 此裝置上有尚未連結帳號的舊離線資料。請先選擇它的歸屬，雲端同步才會恢復。 | Mainland 帳戶/雲同步 -> 帳號/雲端同步 |
| `localData.importAccount` | 匯入此帳號 | Mainland 帳戶 -> Taiwan 帳號 |
| `localData.discard` | 捨棄 | Mainland 丟棄 -> 捨棄 (consistent with confirmDiscardTitle) |
| `localData.saveProgressBody` | 此裝置上有訪客進度。將它儲存到此帳號，或重新開始。 | Mainland 帳戶 -> Taiwan 帳號 |
| `localData.reviewTitle` | 本機資料需要處理 | Mainland 本地 -> Taiwan 本機 |
| `localData.reviewBody` | 請先選擇如何處理本機資料，雲端同步才會恢復。 | Mainland 本地/雲同步 -> 本機/雲端同步 |
| `localData.resolving` | 正在處理本機資料... | Mainland 本地 -> Taiwan 本機 |
| `localData.decisionFailedTitle` | 本機資料處理失敗 | Mainland 本地 -> Taiwan 本機 |
| `localData.decisionFailedBody` | 無法確定本機資料的歸屬。雲端同步仍處於暫停狀態。 | Mainland 本地/雲同步 -> 本機/雲端同步 |
| `pos.pronoun` | 代名詞 | Mainland 代詞 -> Taiwan 代名詞 |
| `books.languageMismatchTitle` | 書籍語言不符 | Mainland 不匹配 -> Taiwan 不符 |
| `home.libraryQueryingDetail` | 正在查詢 Supabase 的 public_library 資料表... | Mainland 表 -> Taiwan 資料表 |
| `home.libraryRowsCheckingDetail` | Supabase 傳回了 {{count}} 列。正在檢查此裝置上已下載的檔案... | Mainland 返回/行 -> Taiwan 傳回/列 |
| `home.libraryCheckedDetail` | 已檢查 {{checked}}/{{total}} 本公共書籍的本機檔案狀態。 | Mainland 本地 -> Taiwan 本機 |
| `home.libraryLoadedDetail` | 已載入 {{total}} 列公共書庫資料，其中 {{local}} 項已在本機。 | Mainland 行/本地 -> Taiwan 列/本機 |

### ko (12)

| Key | Now | Why |
| --- | --- | --- |
| `home.pdfReady` | {{title}}을(를) 가져올 준비가 되었어요. | Was a stale 'PDF ready'; missing {{title}} placeholder and new meaning |
| `home.turnOcrOn` | 화면 텍스트 스캐너 켜기 | Source now says 'screen text scanner' instead of OCR |
| `home.turnOcrOff` | 화면 텍스트 스캐너 끄기 | Source now says 'screen text scanner' instead of OCR |
| `home.ocrScanner` | 화면 텍스트 스캐너 | Source now says 'screen text scanner' instead of OCR |
| `home.ocrAndroidOnly` | 화면 텍스트 스캔은 현재 Android에서만 사용할 수 있습니다. | Stale 'floating OCR' wording; source now 'screen text scanning ... right now' |
| `home.ocrReady` | 화면 텍스트 스캐너가 준비되었습니다. | Stale 'OCR ready'; updated to screen text scanner wording |
| `home.ocrOff` | 화면 텍스트 스캐너가 꺼져 있습니다. | Stale 'OCR off'; updated to screen text scanner wording |
| `home.ocrFailed` | 화면 텍스트 스캐너를 실행하지 못했습니다. | Stale 'OCR failed'; updated to screen text scanner wording |
| `home.ocrTurningOff` | 스캐너를 끄는 중... | Stale OCR wording; source now 'Turning scanner off' |
| `home.ocrStarting` | 스캐너를 시작하는 중... | Stale OCR wording; source now 'Starting scanner' |
| `home.ocrTapBubble` | 떠 있는 버블을 탭해 텍스트를 스캔하세요. | Stale 'tap bubble to start OCR'; source now 'tap the floating bubble to scan text' |
| `home.ocrBubbleFailed` | 스캐너 버블을 시작하지 못했습니다. | Stale OCR wording; source now 'Scanner bubble did not start' |

Total: 155 values fixed. Reviewed and intentionally unchanged: brand names (Noeul, Google, Apple, Android, OCR, AI, EPUB, PDF, TOPIK, HSK), true cognates (fr "Notes", "Pause", "Genre"; es/pt "Normal", "Horizontal"; id "Edit", "Email"), "{{current}} / {{total}}".

## Not localized

- Native Kotlin overlay / reader strings (`modules/**`, `android/**`): owned by the native pass.
- Book, song and dictionary content (titles, blurbs, CC-CEDICT English glosses): content data, owned by the backend/content pass; the `lookup.variantOf` wrapper is localized but the gloss text itself may be English.
- Public-library diagnostics (`home.diagnostic*`, `home.library*Detail`): now dev-only, translations left as they were.
- Writing prompts are stored on entries in English (their identity, used for category inference and sent with the assessment request); only the display is translated.

## Needs a native-speaker check

- All 110 `write.prompt.*` and 31 `write.sample.*` strings (long, idiomatic). `write.prompt.sandbox.13` has no explicit subject in English; translators chose "this twist".
- `write.sample.*` in ko: explains Korean words to a Korean reader; glosses kept partly in English where the essay used English words.
- Russian and Arabic count strings use count-neutral patterns ("Книг: {{count}}", "عدد الكتب: {{count}}"); check they read well in context.
- zh-Hant: 122 values changed to Taiwan usage (帳號, 登出, 捲動, 辨識, 本機, 程度…); one remaining inconsistency, 高級 (levels) vs 高階 elsewhere.
- Short labels that may be tight: ar `lookup.accentUs/Uk` (أمريكي/بريطاني), es "EE. UU."/"R. U.", ru "Брит.", ru `ocr.labEyebrow` "Лаборатория".
- `read.frontMatter` (publishing term in each language), `profile.defaultName` (masculine generic in es/pt/fr), `learn.learnedTabCount` (gender agreement in es/pt).
- id mixes "Anda" and "kamu" across the existing table (pre-existing).
- ko: OCR strings rewritten to "화면 텍스트 스캐너" to match the English.
