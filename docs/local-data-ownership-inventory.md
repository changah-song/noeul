# Local Data Ownership Inventory

This repo does not currently have a JavaScript test setup. There are no frontend test scripts in `frontend/package.json`, and no Jest or Vitest config was found. This inventory lists the unscoped local user-data surfaces to migrate in later steps.

## AsyncStorage Keys

- `frontend/hooks/useAppSetup.js`
  - `@ff/books`
  - `@ff/current-book`
  - `@ff/current-book-meta`
- `frontend/screens/Home.js`
  - `manualSongs`
- `frontend/screens/Write.js`
  - `writing_entries_v1`
- `frontend/services/dailyProgress.js`
  - `dailyProgress`

## SQLite Tables

- `frontend/services/Database.js`
  - `SQLite.openDatabase('temp.db')`
  - `vocab`
  - `vocab_contexts`
  - `book_index`
  - `book_preprocess_meta`
  - `book_preprocess_chapters`

## Shared File Directories

- `frontend/services/bookCloudSync.js`
  - `${FileSystem.documentDirectory}cloud-books/`
- `frontend/screens/Profile.js`
  - `${FileSystem.documentDirectory}profile/`

## Device-Level Preferences To Review

These may remain global if intentionally device-level, but should be reviewed before the privacy work is complete:

- `frontend/contexts/AppContext.js`
  - `@ff/language-settings`
- `frontend/screens/Home.js`
  - `@ff/ocr-settings`
- `frontend/screens/Read.js`
  - reader settings storage
  - lookup hint dismissal storage
- `frontend/components/Learn/Flashcard.js`
  - flashcard front-side settings storage
