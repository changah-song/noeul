# Noeul admin dashboard

A static page that shows users, learning activity, crashes, startup time and UI
freezes. It reads everything through one Supabase function and has no build
step.

## How the data flows

1. The app records events with `frontend/services/appTelemetry.js`:
   - `app_start` once per launch, with the time from app code starting to the first screen.
   - `crash` for a fatal JavaScript error. The handler saves the event before the app dies.
   - `error` for a non-fatal error that reached the global handler.
   - `js_stall` when the app stops responding for one second or more, tagged with the screen.
2. Events wait in an on-device queue, so offline use loses nothing. They upload
   to the `app_events` table when the app has a session and a connection.
3. The page signs in with an admin account and calls `admin_dashboard()`. That
   function refuses anyone not listed in `admin_users`.

Debug builds tag their events `development`, so the dashboard's default
Production view is not polluted by local testing.

## One-time setup

1. In the Supabase SQL editor, run `supabase/app_telemetry.sql`.
2. Create your admin login: Authentication → Users → Add user, with an email and
   password and auto-confirm on.
3. Grant it access in the SQL editor:

   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where email = 'you@example.com';
   ```

4. Copy `config.example.js` to `config.js` and fill in the project URL and anon
   key. These are the same public values as `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`. `config.js` is gitignored. Never put the
   service-role key here.

## Level model page

`level.html` shows how the app's level engine (`frontend/services/levelEngine.js`)
tracks each reader: their level over time with its uncertainty band, what moved
it (lookups, words read past, reviews, word checks), a searchable log of every
change with the word and why, and an accuracy check across all readers
(predicted chance against what happened).

It reads `admin_level_model()` from `supabase/user_ability_log.sql`. Apply that
file once in the SQL editor, after `app_telemetry.sql`. The app keeps its log
rows on the device until the table exists, then uploads them. Add `?demo=1` to
preview it with sample data.

## Running it

Serve the folder with any static server, for example:

```bash
python3 -m http.server 8090 --bind 127.0.0.1 --directory dashboard
```

Open `http://127.0.0.1:8090`. Add `?demo=1` to preview the layout with sample
data and no sign-in.

## Health targets

The thresholds live at the top of `dashboard.js` in `THRESHOLDS`:

| Check | Healthy | Watch | Worse |
|---|---|---|---|
| Crash-free sessions | 99.5% or more | 99% or more | below 99% |
| Startup, 95th percentile | 2.5 s or less | 4 s or less | over 4 s |
| Freezes per 100 sessions | 10 or fewer | 30 or fewer | over 30 |

A crash first seen in the last 48 hours is flagged as new. No telemetry for
24 hours raises a warning.

## Known limits

- Native crashes, such as an out-of-memory kill or a Kotlin module failure, are not captured. Only JavaScript crashes are. A native crash reporter such as Sentry would cover those.
- Startup time starts when the JavaScript bundle runs, not when the process launches.
- "Active" means the user opened the app or produced a study event that day. Builds without telemetry only count through study events.
- The user list shows the 500 most recently active users.
