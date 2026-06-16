# Fluent Fable Feature And Interaction Inventory

Last updated: 2026-06-12

This document is a current-state product and interaction inventory for design work. Use it with `docs/pencil-handoff/README.md`, the screenshots in `docs/pencil-handoff/visuals/`, and `DESIGN.md`.

## Product Frame

Fluent Fable is a mobile language-learning reader. The primary loop is:

1. Read real text.
2. Tap or select text when help is needed.
3. Save useful words in context.
4. Revisit saved words only when reading alone has not reinforced them.

The app is text-first and study-focused. It should not feel like a quiz game, a generic flashcard app, or a marketing landing page.

Supported learning languages:

- Korean
- English
- Chinese

Supported interface languages:

- English
- Korean
- Chinese
- French
- Spanish
- Arabic
- Mongolian
- Vietnamese
- Thai
- Indonesian
- Russian

Chinese profiles also have a script setting:

- Simplified Chinese, `zh-Hans`
- Traditional Chinese, `zh-Hant`

## Global App Shell

The bottom navigation has five tabs:

- Home
- Read
- Learn
- Write
- Profile

Global behaviors:

- App startup waits for fonts, local data ownership checks, local database setup, auth state, and book loading.
- Users can run as guests or signed-in users.
- Local data is scoped to the current local owner: guest, legacy local data, or signed-in user.
- Cloud sync uses Supabase when the active local owner is the signed-in user.
- The bottom tab bar hides when Home opens full-screen subflows such as book preview and song reader.
- The bottom tab bar also hides when the reader enters focus/fullscreen mode.
- Modals and sheets generally close by explicit close/back controls, Android back, or backdrop press where implemented.

Important global decision state:

- When guest or legacy local data conflicts with account state, a local data decision modal blocks cloud sync.
- Possible decision actions include import to account, keep as guest, discard, save progress, start fresh, and merge.
- This modal should feel trustworthy and explicit because it controls whether local reading data is kept, merged, or discarded.

## Cross-Cutting Lookup Model

Lookup is the central shared interaction across reading, songs, and OCR.

Dictionary lookup:

- Triggered by tapping a word or detected token.
- Shows the selected surface word and the resolved dictionary stem.
- Shows language-specific pronunciation:
  - Korean: romanization and Hanja when available.
  - English: IPA when available.
  - Chinese: pinyin.
- Shows part of speech when available.
- Shows one primary definition and optional alternative definitions.
- Bookmark/save action saves or unsaves the vocabulary item.
- Saved items are stored with source sentence/context when available.
- Multiple possible lookup terms can show left/right navigation chevrons.
- If dictionary lookup fails, the sheet can show a fallback selection state rather than a full definition.

Translation:

- Triggered by long-press/text selection in the reader.
- Also available from the lookup panel via a translate action.
- Uses the same bottom/top panel pattern as dictionary lookup.
- Shows loading, translated text, and error/no-result states.

Hanja:

- Korean dictionary entries may show Hanja characters.
- Tapping Hanja opens a Hanja details modal or popup.
- Hanja details can include readings, meaning, related words, and known-word toggles.
- Related words can be marked known without leaving the lookup flow.

Vocabulary save state:

- Saving from reader, song reader, OCR overlay, word detail, or Hanja related-word flows updates local vocabulary.
- Signed-in users sync saved vocabulary, contexts, favorites, reviews, and related known words.
- Saved words are highlighted in reader text where the preprocessed index or local heuristics can match them.

## Home

Home is the main launch surface. It contains the user's book library, public-domain catalog, song library, continue-reading entry point, and Android OCR toggle.

### Home Top Actions

User can:

- Continue the current book.
- See current book title, author, cover/progress information, and cloud/download status.
- Switch between Books and Songs.
- Toggle Android floating OCR.

OCR toggle states:

- Off
- Starting
- Waiting for overlay permission
- Waiting for screen-capture permission
- Floating bubble visible
- Turning off
- Permission denied
- Capture stopped
- Failed

The OCR toggle is Android-only. On other platforms it should either be hidden or clearly unavailable.

### Books Library

Book filters:

- Favorites
- My Books
- Public Domain

User can:

- Scroll the book grid.
- Tap a book cover to open book preview.
- Tap an undownloaded cloud book to download/open.
- Use the book overflow menu.
- Import a book from the My Books filter.

Book tile states:

- Local and ready
- Cloud item not downloaded
- Downloading
- Favorite
- Completed
- Overflow menu open
- Pressed

Book overflow menu actions:

- Edit
- Reset to original metadata
- Delete

Delete is destructive and uses a confirmation alert.

### Import Book

User can import:

- EPUB
- PDF on Android

Import flow can include:

- Document picker
- Metadata extraction
- Duplicate detection
- Language mismatch alert
- PDF cover prompt
- First page as cover
- No cover
- Custom cover page number
- Invalid page alert
- Cloud upload for signed-in users

Book metadata handled by the app:

- Title
- Author
- Cover image
- Generated cover colors
- Format
- URI/local path
- File size
- Word count
- Language
- Progress
- Favorite state
- Completed state

### Public-Domain Catalog

Public-domain sources differ by target language:

- English uses a remote Supabase public library.
- Non-English target languages use bundled public-domain catalog data.

User can:

- Browse public-domain books.
- Sort by title, author, length, or genre.
- Tap an active sort again to reverse ascending/descending order.
- Tap a public-domain book to preview.
- Download a remote public-domain book.
- Read a downloaded public-domain book.
- Add a public-domain book to the personal library without immediately reading it.

Public-domain states:

- Loading
- Empty
- Unavailable/error
- Diagnostics visible
- Downloading
- Downloaded/readable

### Book Preview

Book preview is a full-screen Home subflow.

User can:

- Go back to Home.
- Read the book.
- Download/add to library when the item is public-domain or remote.
- Favorite/unfavorite.
- Mark completed/uncompleted.
- Edit metadata.
- Reset metadata to original.
- Delete or remove from library.

Preview shows:

- Cover
- Title
- Author
- Format/source status
- Genre/difficulty when present
- Word count or file size
- Snippet/description when present
- Progress/completion state

### Edit Book

User can:

- Edit title.
- Edit author.
- Pick a custom cover image.
- Remove a custom cover.
- Save changes.
- Cancel.

The reset action restores metadata from the original import or public-domain catalog where available.

### Songs In Home

User can:

- Switch to Songs.
- Add a song manually.
- Enter title, artist, and lyrics.
- Cancel or save the song.
- Tap a song to open Song Reader.

Song data is local and syncs for signed-in users where supported.

## Song Reader

Song Reader is a full-screen Home subflow for lyrics.

User can:

- Go back to Home.
- Read scrollable lyrics.
- Tap lyric words for dictionary lookup.
- Long-press/select lyric text for translation where supported.
- Save or unsave terms from lookup.
- See saved terms highlighted.
- Open the more/settings menu.
- Decrease or increase font size.
- Edit song title, artist, and lyrics.
- Delete song with confirmation.

Song Reader states:

- Loading saved words
- Main lyrics view
- Lookup panel open
- Translation panel open
- More/settings menu open
- Edit song modal open
- Delete confirmation
- Empty or missing lyrics fallback

## Read

Read is the main long-form reading surface.

Supported content:

- EPUB
- PDF
- TXT/public-domain text packages

Reader readiness states:

- No current book selected
- Loading/opening book
- Preparing highlights
- Error with retry
- Ready
- Book/file too large or unsupported

Header controls:

- Book title and author
- Progress indicator
- Table of contents
- Fullscreen/focus mode
- Reader settings

Reading interactions:

- Swipe/page through the native reader.
- Navigate previous/next chapter at spine edges.
- Tap word for dictionary lookup.
- Long-press/select text for translation.
- Scroll table of contents and jump to a chapter.
- Enter fullscreen.
- Exit fullscreen.
- Adjust reading settings.

Reading progress:

- Page/chapter progress updates as the user reads.
- Reading time is recorded after sustained reading.
- Progress syncs for signed-in users.
- Adjacent chapters can be prefetched/preprocessed in the background.

### Reader Settings

User can:

- Open settings from the header.
- Change font size from 12 to 30.
- Change line spacing from 1.0 to 2.6.
- Toggle dark mode.
- Close settings by backdrop or control.

Settings persist locally and sync when possible.

### Table Of Contents

User can:

- Open table of contents.
- See flattened chapter entries.
- See the current active item.
- Tap a chapter to jump to it.
- Dismiss with backdrop/back.

TOC item states:

- Active
- Enabled
- Disabled/unavailable

### Reader Lookup Panel

User can:

- Tap a word to open dictionary mode.
- Long-press/select text to open translation mode.
- Toggle translation from dictionary mode.
- Save or unsave the primary definition.
- Expand/collapse alternative definitions.
- Save alternative definitions.
- Navigate multiple lookup items with chevrons.
- Tap Hanja for details.
- Close the panel.

Panel states:

- Opening animation
- Looking up
- Fetching live definitions
- Dictionary result
- Translation loading
- Translation result
- No dictionary entry
- Lookup fallback with multiple tokens
- Save in progress
- Saved
- Unsaved
- Error

Placement:

- Usually appears as a bottom panel.
- Can appear higher or adjust placement in fullscreen/focus mode.

### Smart Highlighting And Preprocessing

The app preprocesses chapters to improve saved-word highlighting and dictionary lookup.

User-visible states:

- Checking cache
- Preprocessing current chapter
- Retrying
- Done
- Error, non-blocking

Behavior:

- Current chapter is prioritized.
- Adjacent/all chapters can be queued.
- Failures do not block live lookup, but highlights may be less precise.

## Learn

Learn is the saved vocabulary and review surface.

Summary card shows:

- Matured words
- Waiting words
- Not-seen words
- Guidance to keep reading

Primary actions:

- Keep Reading, navigates to Read.
- Review, starts due review when available.

Filters:

- Starred
- Recent
- Maturity
- Not Seen
- Most Seen

Vocabulary row can show:

- Word
- Hanja when available
- Definition
- Favorite state
- New/not-seen badge
- Seen count
- Source book
- Last-seen date
- Proficiency/maturity dots or labels

User can:

- Tap a row to open word detail.
- Long-press a row to enter selection mode.
- Tap rows in selection mode to select/deselect.
- Cancel selection.
- Bulk delete selected words with confirmation.

### Word Detail

User can:

- Close detail.
- Favorite/unfavorite the word.
- Tap Hanja for details.
- Review definition and maturity data.
- See source and last-seen metadata.
- See saved context sentences.
- Delete the saved word with confirmation.

Detail states:

- No contexts
- Contexts loading
- Contexts available
- Hanja details open
- Delete confirmation

### Flashcard Review

Review opens as a modal over Learn.

User can:

- Close the modal.
- Open front-card settings.
- Toggle front-card Hanja.
- Toggle front-card definition.
- Toggle front-card related words.
- Tap the card to flip.
- Tap again to hide answer.
- Mark Hard.
- Mark Okay.
- Mark Easy.

Review updates scheduling, studied count, and cloud review fields where possible.

Flashcard states:

- Front
- Back
- Settings open
- No due cards
- End of deck/close back to Learn

## Write

Write is a writing archive, draft editor, and reviewed-entry feedback surface.

Entry filters:

- All
- Free
- Diary
- Essay

Entry statuses:

- Draft
- Submitted
- Reviewed

List mode:

- Shows entry count.
- Shows filters.
- Shows entry rows with title, date, character count, type, status, and chevron.
- Empty state has a New Entry action.
- Current header New button is disabled in code when entries exist. A design pass should decide whether to enable it consistently.

User can:

- Filter entries.
- Tap an entry to open detail/review mode.
- Open new draft from empty state.

### Writing Detail And Review

User can:

- Go back to list.
- Open edit mode for non-reviewed drafts.
- See entry title, status, type, and date.
- See character count.
- See native-language words marked "to translate".
- Tap highlighted annotations.
- Tap inline correction rows.
- Close the annotation sheet.
- Tap Done to return to list.

Reviewed entry UI can show:

- Annotated text spans.
- Correction type.
- Original text.
- Suggested correction.
- Explanation.
- Notes.
- Native-language insert chips.

Assessment behavior is currently represented with mock reviewed data. Design should treat it as a real future review surface, but avoid promising real AI review controls that do not exist.

### Writing Editor

User can:

- Go back.
- Choose type: Diary, Essay, Free.
- Expand prompt picker for Diary/Essay.
- Select a prompt.
- Enter title.
- Enter body.
- Toggle bold, italic, underline.
- Save.
- Submit Review, currently saves/submits locally rather than running a real assessment.
- Delete existing drafts with confirmation.

Editor states:

- New draft
- Existing draft
- Prompt picker collapsed
- Prompt picker expanded
- Save disabled
- Save enabled
- Delete confirmation

## Profile

Profile contains identity, completed-books bookshelf, preferences, language profiles, interface language, and auth entry points.

Header:

- Shows display name or guest identity.
- Shows guest/signed-in subtitle.
- Signed-in users can edit username.

### Bookshelf

Bookshelf shows completed books for the active target language.

User can:

- Scroll/paginate the shelf when enough books exist.
- Tap a book spine to show more info.
- Tap another spine to move the tooltip.
- Tap away to clear selection.

Book spines encode:

- Estimated page count through height/width.
- Cover-derived colors.
- Title/author in tooltip.

States:

- Empty shelf
- One shelf
- Multiple shelf pages
- Spine tooltip open

### Preferences

Preference rows:

- Language Profile
- Interface Language
- Notifications
- Reading Level
- Appearance

Implemented interactions:

- Language Profile opens profile switcher.
- Interface Language opens language picker.
- Notifications, Reading Level, and Appearance currently show placeholder "coming soon" alerts.

### Language Profile Switcher

User can:

- See existing profiles.
- Switch active learning profile.
- Add profiles for supported target languages not already present.
- Add Chinese profile with default Simplified script.

Profile behavior:

- Switching target language updates active profile.
- If target language and interface language would collide, the app chooses a different interface language fallback.
- Signed-in profile changes sync to Supabase.
- Guest profile changes persist locally.

### Interface Language Picker

User can:

- Open the picker.
- Select an interface language from the supported set.
- See the current language selected.
- See target-language conflicts disabled.
- Close or cancel.

### Auth And Account

Guest user can:

- Open Sign In.
- Open Sign Up.
- Use email/password.
- Use Google.
- Use Apple on iOS where shown.

Signed-in user can:

- Edit username.
- Sign out with confirmation.

Auth states:

- Sign in mode
- Sign up mode
- Loading/working
- Missing email/password alert
- Provider cancelled
- Provider failed
- Check email alert for some signup flows

## Android OCR Overlay

Floating OCR is outside the normal tab shell and runs over the screen on Android.

Permission sequence:

1. Display-over-other-apps permission.
2. Screen-capture permission.
3. Floating widget starts.

Floating widget interactions:

- Tap bubble to scan current screen.
- Drag bubble.
- Drag bubble to dismiss target to close.
- Bubble hides during capture and restores afterward when appropriate.

Result overlay interactions:

- Shows OCR-detected word boxes.
- Tap a detected word/target for lookup.
- If a target has multiple word options, use in-card navigation to move between options.
- Tap translate action to show translation.
- Tap bookmark/save to save or unsave.
- Expand/collapse alternative definitions.
- Save alternative definitions.
- Tap Hanja inline to open Hanja popup.
- Scroll Hanja popup related words.
- Load more related words at the bottom.
- Toggle related words as known.
- Tap close control or outside result card to clear/dismiss.

OCR overlay states:

- Capture shell visible
- Capture measured
- OCR analyzing
- OCR result visible
- Empty OCR result
- Lookup loading
- Lookup resolved
- Lookup updated/enriched
- Lookup timeout/error
- Saving
- Save resolved/error
- Hanja loading
- Hanja resolved/error
- Capture stopped

Design note: OCR is a floating, permission-heavy feature. The Home toggle, Android permission copy, floating bubble, result overlay, dictionary card, Hanja popup, and close/dismiss target should feel like one coherent system.

## Data, Sync, And Offline Expectations

Local-first data:

- Books and local file paths
- Reading progress
- Saved vocabulary
- Vocabulary contexts
- Related known words
- Songs
- Writing entries
- Reader settings
- Flashcard front-card settings
- OCR preference
- Language settings

Cloud-sync data for signed-in users:

- Account/profile metadata
- Learning preferences
- Interface language
- User profiles
- Books and progress
- Songs
- Vocabulary entries and contexts
- Related known words
- Review state
- Writing entries where implemented
- OCR and flashcard preferences where implemented

Design implications:

- Every cloud-backed action should have local-first feedback.
- Sync failure should not make the app feel unusable.
- Destructive actions should distinguish local removal from cloud soft-delete where copy allows.
- Ownership decisions should be explicit and calm, not hidden in settings.

## Empty, Error, And Edge States To Design

Global:

- App loading/splash while setup is incomplete.
- Offline or cloud sync unavailable.
- Local data ownership decision required.

Home:

- No books.
- No favorite books.
- Public library loading.
- Public library unavailable.
- Public library empty.
- Book download failed.
- Import cancelled.
- Import failed.
- Duplicate book found.
- PDF cover page invalid.

Read:

- No current book.
- Book language does not match active target language.
- Opening reader.
- Preparing highlights.
- Reader error with retry.
- Lookup failed.
- No dictionary entry.
- Translation failed.
- Preprocessing failed but reading still works.

Learn:

- No saved words.
- No due reviews.
- Selection mode with zero/one/many selected.
- Delete failure.
- Word detail without contexts.

Write:

- No entries.
- Save disabled due to missing required fields.
- Reviewed entry with no annotations.
- Annotation sheet for long explanations.
- Delete confirmation.

Profile:

- Guest state.
- Signed-in state.
- Empty completed bookshelf.
- Username validation failure.
- Sign-out confirmation.
- Language conflict disabled state.
- Placeholder preference alerts.

OCR:

- Android-only unavailable state.
- Overlay permission denied.
- Screen capture denied.
- Screen capture stopped by system.
- No text detected.
- Lookup timeout.
- Save timeout.

## Known Design Gaps And Clarifications

- `ScreenshotOcr.js` exists as a secondary OCR screen reference but is not mounted in the current bottom-tab navigator.
- Write review currently uses mock reviewed data. The design can improve the review surface, but should not imply a fully implemented AI assessment pipeline unless that product decision is made.
- The Write header New button is disabled in current code while the empty-state New Entry action works.
- Profile rows for notifications, reading level, and appearance are placeholders.
- OCR is Android-only.
- PDF import is Android-only in the current flow.
- Public-domain English library is remote; other target-language catalogs are bundled.
- Chinese support has simplified/traditional profile state and pinyin dictionary display, but good learner-appropriate Chinese public-domain sourcing remains a product/content task.

