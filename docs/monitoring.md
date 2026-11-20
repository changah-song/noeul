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
 "checks":{"cache_db":{"ok":true,"dictionary_rows":12345},"ko_dict":{"ok":true}, ...}}
```

and 503 with `"status":"degraded"` when the cache database or a bundled
dictionary can't be read.

- Point a free uptime monitor at it (UptimeRobot or Better Stack, every 5
  minutes, alert by email after two failures).
- Watch `dictionary_rows` across a deploy: if it drops back to near zero, `cache.db`
  is not on a persistent Railway volume, and daily quotas, AI spend and the shared
  lookup cache reset with every deploy.
