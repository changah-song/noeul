# Monitoring

What watches Noeul in production, and how to set each piece up.

| Tool | What it catches |
|---|---|
| Admin dashboard (`dashboard/`) | JS crashes and errors, freezes, startup time, users and learning activity |
| Sentry, app | Native crashes in the Swift/Kotlin reader, readable JS stack traces, the screens, taps and requests before a crash, slow screens |
| Sentry, backend | Unhandled server errors (5xx), slow endpoints |
| Uptime monitor on `/health` | The backend being down or its data files unreadable |
| Play Console vitals / Xcode Organizer | ANRs and crashes as Google and Apple see them (slower, less detail) |

## Sentry

Both sides are off until a DSN is set, so nothing changes for builds without one.

### One-time setup

1. Create a Sentry account and organization, then two projects: **React Native**
   (`noeul-app`) and **FastAPI** (`noeul-backend`). Each project's DSN is under
   Settings → Client Keys.
2. App: put the app DSN in `frontend/eas.json` under each build profile's `env` as
   `EXPO_PUBLIC_SENTRY_DSN`, and in `frontend/.env.production` for local iOS
   archives. A DSN only lets an app send events, so it is fine in the repo.
3. Backend: in Railway, set `SENTRY_DSN` to the backend DSN. Optional:
   `SENTRY_TRACES_PER_MILLE` (performance sampling, default 20 = 2%) and
   `SENTRY_ENVIRONMENT` (default `production`).
4. Readable stack traces (optional but worth it): create an auth token
   (Settings → Auth Tokens, scope `project:releases` + `project:write`). Keep it
   out of the repo. When building a release, export:

   ```bash
   export SENTRY_AUTH_TOKEN=...   # secret
   export SENTRY_ORG=<org slug>
   export SENTRY_PROJECT=noeul-app
   ```

   With the token set, the Xcode archive and the Android release build upload
   source maps and native symbols. Without it they skip the upload and build as
   before. The upload needs the `sentry-cli` binary: if `npm install` skipped
   install scripts, run `npm rebuild @sentry/cli` once in `frontend/`.
5. Alerts: Sentry → Alerts → create "a new issue is seen" and "issue frequency
   above N in 1h" rules that email you, for both projects.

### What is sent

- The account id (a UUID) only: no email, no IP address.
- No request bodies; request URLs lose their query strings (they can carry book text).
- Console breadcrumbs: warnings and errors only, cut to 200 characters.
- Debug builds send nothing unless `EXPO_PUBLIC_SENTRY_IN_DEV=1`.

See `frontend/services/crashReporting.js` and `backend/observability.py`.

## `/health`

`GET /health` answers 200 with:

```json
{"status":"ok","release":"noeul-backend@<commit>","uptime_seconds":1234,
 "checks":{"cache_db":{"ok":true,"dictionary_rows":12345,"ai_lookup_rows":678,
   "translation_rows":90,"usage_rows_today":42},"ko_dict":{"ok":true}, ...}}
```

and 503 with `"status":"degraded"` when the cache database or a bundled
dictionary can't be read.

- Point a free uptime monitor at it (UptimeRobot or Better Stack, every 5
  minutes, alert by email after two failures).
- `cache.db` lives on a Railway volume mounted at `/data`, with the service
  variable `CACHE_DB_PATH=/data/cache.db`. Without that variable it falls back
  to `backend/cache.db` inside the container, which every deploy replaces.
- Watch the `cache_db` counts across a deploy: if they drop back to zero, `cache.db`
  is not on a persistent Railway volume, and daily quotas, AI spend and the shared
  lookup cache reset with every deploy. `dictionary_rows` alone can sit at 0 for
  days (the bundled dictionaries answer most lookups); `ai_lookup_rows` and
  `translation_rows` grow with use and are the ones to compare.
  `usage_rows_today` also empties at the first start after midnight UTC, so
  compare it only within one UTC day.

## Worker processes

The backend runs 1 worker process. With one, a slow request holds up everyone
else; the Railway service variable `WEB_CONCURRENCY` raises the number without
a code change (the backend is ready for it: see below). Raise it if Sentry or
the uptime monitor shows requests queueing behind slow ones.

- Each worker loads its own copy of the language models: about 190 MB when
  idle and about 700 MB once it has served Korean, English and Chinese text
  (measured on a Mac; the Woof voice adds to it). Check the service's memory
  graph before raising the number.
- Quotas, AI spend and the lookup caches live in `cache.db`, which the workers
  share. The KRDICT cooldown and the song-search cache are kept per worker.
- `uptime_seconds` on `/health` is that of whichever worker answered.
