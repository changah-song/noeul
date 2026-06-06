# Auth, Local Data Ownership, And Privacy Guide

This guide covers the login/logout data leak currently possible in Fluent Fable:

1. Guest data is saved into global local stores.
2. Signed-in account data is merged into those same global stores.
3. After logout, the in-memory and local stores still contain the prior user's data.
4. A different account can sign in and the app may upload that existing local data into the new account.

The backend tables already model ownership with `user_id` and RLS. The core fix is client-side ownership scoping: every local user-content read, write, sync, and delete must run inside an explicit local owner.

## Current Risk Points

User-owned data currently uses unscoped local storage:

- `frontend/hooks/useAppSetup.js`
  - `@ff/books`
  - `@ff/current-book`
  - `@ff/current-book-meta`
- `frontend/services/Database.js`
  - `SQLite.openDatabase('temp.db')`
  - `vocab`
  - `vocab_contexts`
  - `book_index`
  - `book_preprocess_meta`
  - `book_preprocess_chapters`
- `frontend/screens/Home.js`
  - `manualSongs`
- `frontend/screens/Write.js`
  - `writing_entries_v1`
- `frontend/services/dailyProgress.js`
  - `dailyProgress`

Device-level preferences can stay global if that is intentional:

- OCR settings
- reader display settings
- flashcard front-side settings
- language settings
- lookup hint dismissal

If a preference reveals private behavior or content, scope it too. When in doubt, scope it.

## Ownership Model

Use one canonical local owner id everywhere:

```js
export const GUEST_OWNER_ID = 'guest';

export const getLocalOwnerId = (user) => user?.id ?? GUEST_OWNER_ID;
```

Rules:

- Guest mode uses owner id `guest`.
- Authenticated mode uses the Supabase auth UUID.
- Never sync `guest` rows to Supabase unless the user explicitly chooses to claim or merge that data.
- Never read unowned local data into active UI state.
- Never upload local rows unless their owner id matches the currently authenticated Supabase user id.

## Recommended Architecture

Add a small local ownership module, for example `frontend/services/localDataScope.js`:

```js
export const GUEST_OWNER_ID = 'guest';

export const getLocalOwnerId = (user) => user?.id ?? GUEST_OWNER_ID;

export const makeScopedStorageKey = (ownerId, key) => `@ff/user-data/${ownerId}/${key}`;
```

Then refactor user-content stores to use scoped keys:

```js
const booksKey = makeScopedStorageKey(ownerId, 'books');
const currentBookKey = makeScopedStorageKey(ownerId, 'current-book');
const writingKey = makeScopedStorageKey(ownerId, 'writing-entries-v1');
const songsKey = makeScopedStorageKey(ownerId, 'manual-songs');
const dailyProgressKey = makeScopedStorageKey(ownerId, 'daily-progress');
```

For SQLite, add an `owner_id` column to every user-content table and include it in every identity query:

```sql
ALTER TABLE vocab ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'guest';
ALTER TABLE vocab_contexts ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'guest';
ALTER TABLE book_index ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'guest';
ALTER TABLE book_preprocess_meta ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'guest';
ALTER TABLE book_preprocess_chapters ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'guest';
```

Every read/write/delete should filter by owner:

```sql
WHERE owner_id = ? AND word = ? AND hanja IS ? AND def IS ? AND language = ?
```

Update indexes to include `owner_id`, especially identity and lookup indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_vocab_owner_identity
ON vocab(owner_id, language, word, hanja, def);

CREATE INDEX IF NOT EXISTS idx_vocab_contexts_owner_identity
ON vocab_contexts(owner_id, language, word, hanja, def, source_book_uri, sentence);

CREATE INDEX IF NOT EXISTS idx_book_index_owner_surface
ON book_index(owner_id, book_uri, surface);
```

## Auth Flow Coordinator

Do not let `useAuth`, `useAppSetup`, `Home`, and `Write` independently decide how to sync on login. Add one coordinator that owns transitions between:

- previous owner id
- next owner id
- auth event
- whether guest data exists
- whether remote account data exists
- user consent for guest data

A practical shape:

```js
const transitionLocalOwner = async ({ previousOwnerId, nextOwnerId, authEvent, user }) => {
  pauseCloudSync();

  try {
    if (!user?.id) {
      await switchActiveOwner(GUEST_OWNER_ID);
      await loadOwnerState(GUEST_OWNER_ID);
      return;
    }

    const hasGuestData = await hasLocalUserData(GUEST_OWNER_ID);
    const hasRemoteData = await hasRemoteUserData(user.id);

    if (hasGuestData && previousOwnerId === GUEST_OWNER_ID) {
      const decision = await promptGuestDataDecision({ hasRemoteData });
      await applyGuestDataDecision({ decision, userId: user.id, hasRemoteData });
    }

    await switchActiveOwner(user.id);
    await pullRemoteIntoOwner(user.id);
    await loadOwnerState(user.id);
  } finally {
    resumeCloudSync();
  }
};
```

Important: cloud sync must be paused while a decision is pending. The current bug can happen because login sync treats whatever is local as account-owned data.

## Required Flows

### Guest Creates A New Account

Condition:

- Active owner is `guest`.
- Guest local data exists.
- Remote data for the new account is empty or effectively empty.

UX:

- "Save your offline progress to this account?"
- Actions: `Save progress`, `Start fresh`.

Save progress:

1. Reassign local data from `guest` to `user.id`.
2. Upload the reassigned rows to Supabase.
3. Clear the old guest scope if the data was moved rather than copied.
4. Load the authenticated scope.

Start fresh:

1. Clear guest data.
2. Switch to `user.id`.
3. Pull remote data.
4. Load an empty or remote-backed authenticated scope.

### Guest Logs Into An Existing Account

Condition:

- Active owner is `guest`.
- Guest local data exists.
- Remote data for the account exists.

UX:

- "Offline progress was found on this device. Merge it with your account or discard it?"
- Actions: `Merge`, `Discard`.

Discard:

1. Clear guest data.
2. Switch to `user.id`.
3. Pull remote account data.
4. Load account state.

Merge:

1. Fetch remote account data.
2. Deduplicate guest data against remote data.
3. Reassign only merge candidates from `guest` to `user.id`.
4. Upload candidates to Supabase.
5. Pull remote account data again.
6. Load account state.
7. Clear consumed guest rows.

Suggested dedupe identities:

- Books: `cloudId`, then `cloudFilePath`, then stable imported-file fingerprint if available, then `title + author + size`.
- Vocab: `language + word + hanja + definition`.
- Vocab contexts: `language + word + hanja + definition + source_book_uri + sentence`.
- Related known words: `language + main word identity + related word identity`.
- Songs: `externalId/providerId` when present, else `title + artist + lyrics hash`.
- Writing entries: `id/client_id`; if missing, add stable client ids before sync.

### User Logs Out, Then Another User Logs In

Logout must switch active local state away from the authenticated owner.

Minimum safe behavior:

1. Optionally finish a best-effort final sync for the signed-in user.
2. Call `supabase.auth.signOut()`.
3. On `SIGNED_OUT`, set active owner to `guest`.
4. Clear React state for books, vocab, songs, writing, current book, and progress.
5. Load the scoped guest state, which should be empty unless true guest data exists.

When User B signs in later:

1. Do not prompt if no guest data exists.
2. Switch active owner to User B.
3. Pull User B's Supabase data.
4. Load User B's scoped state.

User A's local data may remain on disk under User A's owner scope if you want offline caching. It must not remain in active state and must not be uploaded for User B.

## Migration From Current Unscoped Data

Existing installs have legacy local data without an owner id. Treat this carefully because the app cannot know who owns it.

Recommended migration:

1. Add a migration marker, for example `@ff/local-owner-migration-v1`.
2. If no session exists, migrate legacy unscoped data to `guest`.
3. If a session exists and legacy data exists, do not silently attach it to the signed-in account. Show a one-time prompt:
   - `Import to this account`
   - `Keep as offline guest data`
   - `Discard`
4. Remove legacy global keys only after the scoped write succeeds.
5. For SQLite, default legacy rows to `guest`, then reassign only after explicit consent.

This avoids silently giving User A's historical local data to whichever account happens to be signed in during the app upgrade.

## Implementation Order

1. Add local owner utilities and data inventory tests.
2. Scope AsyncStorage keys for books, current book, songs, writing entries, and daily progress.
3. Add SQLite `owner_id` migrations and update every `Database.js` user-content query.
4. Add owner-aware helpers:
   - `hasLocalUserData(ownerId)`
   - `clearLocalUserData(ownerId)`
   - `reassignLocalUserData(fromOwnerId, toOwnerId)`
   - `loadOwnerState(ownerId)`
5. Add a sync gate so cloud sync cannot run while ownership is unresolved.
6. Add the auth transition coordinator.
7. Add guest-data prompts.
8. Update cloud sync calls to assert `ownerId === user.id` before upload.
9. Add logout reset behavior.
10. Add tests for account switching and migration.

## Test Matrix

Cover these cases before shipping:

- Guest imports book and saves vocab, then signs up and chooses `Save progress`.
- Guest imports book and saves vocab, then signs up and chooses `Start fresh`.
- Guest has local data, signs into existing account, chooses `Discard`.
- Guest has local data, signs into existing account, chooses `Merge`.
- User A signs in and loads data, signs out, User B signs in on same device. User B never sees User A books, vocab, songs, writing, current book, or progress.
- User A signs out, guest mode starts empty unless guest data existed before login.
- Token refresh does not trigger guest prompts or local ownership migration.
- App cold-starts while signed in and does not briefly render the previous owner scope.
- Cloud sync in progress during logout cannot write into the next owner's local scope.
- Legacy unscoped local data migration does not silently attach data to an account.

## Pushbacks And Security Notes

Tagging data is necessary, but it is not sufficient for privacy. It prevents cross-account data bleed and wrong-account uploads, but it does not make local data private from someone who can use the same unlocked device and app install.

Offer two logout choices:

- `Sign out`: switch active state to guest, keep account data cached under its owner scope.
- `Sign out and remove data from this device`: clear that user's scoped AsyncStorage, SQLite rows, downloaded EPUBs, covers, and preprocess indexes.

Downloaded files need the same treatment as metadata. `frontend/services/bookCloudSync.js` stores cloud downloads in a shared `cloud-books/` directory. Use an owner-scoped directory such as:

```js
`${FileSystem.documentDirectory}user-data/${ownerId}/cloud-books/`
```

Avoid logging private user content. `useAppSetup` diagnostics currently include book titles, URIs, and cloud paths. Keep those logs behind `__DEV__` or redact them in production.

Use generation tokens for async sync jobs. Each auth transition should increment a `syncGeneration`; async work should check it before writing state. This prevents an old User A sync from completing after User B has signed in.

Keep remote protection strict:

- Keep RLS on every Supabase user table.
- Keep storage policies constrained to `auth.uid()` and a user-id path prefix.
- Never ship service-role keys in the app.
- Keep Supabase auth session storage in `SecureStore`, as this app already does.

For a stronger privacy mode, consider encrypting local user-content stores with a key stored in SecureStore, and deleting that key on "remove data from this device". This is more work and does not replace scoped ownership, but it raises the bar for local at-rest exposure.
