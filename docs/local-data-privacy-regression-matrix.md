# Local Data Privacy Regression Matrix

This repo currently has no JavaScript test runner configured in `frontend/package.json`.
Use this matrix for manual QA until an Expo-capable integration test harness exists.

## Preconditions

- Use two real Supabase accounts: User A and User B.
- Start each case from a clean app install unless the case explicitly needs existing local data.
- Check AsyncStorage, SQLite, and `FileSystem.documentDirectory/user-data/<owner>/` when validating local state.
- Confirm no Supabase writes are sent unless `activeOwnerId === user.id`.

## Matrix

| Case | Steps | Expected Result |
| --- | --- | --- |
| Guest signs up and saves progress | As guest, add a book, save vocab, add a song, write an entry, create daily progress. Sign up and choose `Save progress`. | Guest data moves to the new user scope. Cloud sync starts only after the decision. Guest scope no longer shows the moved data. |
| Guest signs up and starts fresh | As guest, create the same data. Sign up and choose `Start fresh`. | Guest local data is cleared. The signed-in account starts from empty local state, then loads only its cloud data. |
| Guest logs into existing account and discards | As guest, create data. Log into User A with existing remote data and choose `Discard`. | Guest data is cleared. User A sees only User A cloud/local scoped data. No guest data uploads. |
| Existing-account merge is blocked or safe | As guest, create data. Log into an account that already has local account-scoped data and choose `Merge`. | If dedupe is not implemented, the modal reports the merge cannot run and ownership remains blocked. If implemented later, merged data dedupes by stable IDs and uploads only under the signed-in user. |
| User A to User B switch | Sign in as User A, load books/current book/vocab/songs/writing/daily progress. Sign out. Sign in as User B. | User B never sees User A books, current book, vocab, songs, writing, or daily progress. User A data remains under User A scope unless the destructive signout option was used. |
| Destructive signout | Sign in as User A, download a cloud book, then choose `Sign out and remove data from this device`. | Supabase data remains untouched. User A AsyncStorage keys, SQLite rows, and `documentDirectory/user-data/<User A>/` are deleted. Guest state loads after signout. |
| Token refresh | Stay signed in long enough for token refresh or force a token refresh. | No local ownership prompt appears. No guest migration runs. No new local data sync starts just because the token refreshed. |
| Cold start signed in | With User A signed in, kill and restart the app. | The first rendered app state is User A scoped data. Guest or previous-owner data is not rendered while startup ownership is unresolved. |
| Sync during logout | Start a book/song/writing/vocab sync, then immediately sign out. | The sync generation changes. Any delayed or resumed upload exits before writing to Supabase or local state for the wrong owner. |
| Legacy unscoped data | Install a build with old global keys/SQLite data, then update to this build. Sign in while legacy data exists. | Legacy data is never silently attached to the signed-in account. Signed-in startup blocks for an explicit legacy decision. Signed-out startup migrates legacy data only to guest scope. |

## Final Audit Commands

```sh
rg "manualSongs|writing_entries_v1|dailyProgress|@ff/books|@ff/current-book|cloud-books" frontend docs
rg "upsertUser|uploadUser|updateUserPreferenceFields|supabase\\.from|supabase\\.storage" frontend
```
