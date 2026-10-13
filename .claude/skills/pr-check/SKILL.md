---
name: pr-check
description: Run Noeul's PR check - build the PR and main as release APKs, smoke-test both on the user's Android phone, compare startup time, freezes and crashes, and write a short report with the user's feel-check list. Use when the user says a PR is ready, asks to check, verify or test a PR or branch, or says "run the PR check".
---

# PR check

One fixed routine per pull request, so every PR gets the same checks and the
user gets one short report. It covers what a script and the phone can
verify. CI (`.github/workflows/ci.yml`) already runs the unit tests and the
Android build. The user's own 5-minute feel check on their phone covers the rest.

Android only. Never build or test for iOS.

## Inputs

- A PR number, or "the current branch" (use `gh pr view --json number` to find its PR).
  With no PR, compare the branch head against `origin/main` the same way.

## Steps

### 1. Gather the PR

```bash
gh pr view <N> --repo changah-song/noeul --json number,title,url,headRefOid,baseRefName,files,body
git fetch origin main "pull/<N>/head"
```

Read the changed files and the description. Note anything the user must know:

- Native changes, such as anything under `frontend/android/`, `frontend/modules/`, `app.json` plugins, or native deps in `package.json`. The user's phone dev build must be reinstalled after merging.
- SQL files under `supabase/`. They must be applied in the Supabase SQL editor.
- New dependencies, and backend changes that need a redeploy.

### 2. Read CI once

`gh pr checks <N> --repo changah-song/noeul`, read once. Do not poll or
schedule re-checks. Report whatever state CI is in.

### 3. Make sure the phone is connected

The check runs on the user's Galaxy S25 Ultra (`R3KYC01FY8K`) over USB. The user
chose the phone over the emulator. Do not start the emulator.

- `adb devices` must list `R3KYC01FY8K` as `device`. If it's missing, ask the
  user to plug the phone in and unlock it.
- The phone must stay unlocked during the run. The script wakes the screen and
  stops with a message if the phone is locked.
- Tell the user before starting that the phone will be busy for about
  15 minutes. Its Noeul data gets wiped, airplane mode toggles on briefly, and
  the screen-text scanner turns on and off.
- Only one smoke run can use the phone at a time. `smoke.py` holds a lock
  for the whole run, so a second run, including one from another session,
  waits instead of interfering. If a run reports crashes or failed steps that
  don't fit the diff, check its `device.log` for another process driving the
  screen before blaming the PR.

### 4. Build both APKs

```bash
.claude/skills/pr-check/build_apk.sh <PR head SHA>
.claude/skills/pr-check/build_apk.sh origin/main
```

Each prints an APK path. Builds take about 7 minutes and are cached by commit
in `~/.cache/noeul-pr-check/apk/`, so main usually comes from the cache. They
use the `preview` profile's env from that commit's `eas.json` (the production
backend), like a real release. The local dev `.env` points at the emulator-only
address 10.0.2.2, so on the phone it would break lookups. Run
long builds in the background. On failure, read the log path it printed and
report the error. A build failure is a finding, not a reason to stop.

### 5. Smoke-test both builds, main first

```bash
OUT=~/.cache/noeul-pr-check/runs/pr<N>-<sha7>
python3 .claude/skills/pr-check/smoke.py run --apk <main.apk> --label main --out $OUT/main
python3 .claude/skills/pr-check/smoke.py run --apk <pr.apk>   --label pr   --out $OUT/pr
python3 .claude/skills/pr-check/smoke.py compare $OUT/main/results.json $OUT/pr/results.json
```

Each run installs the release APK over the phone's dev build, wipes the app's
data, and takes about 7 minutes. It:

- times a fresh-install launch, three cold starts and an airplane-mode start,
- visits every tab,
- adds the public-domain book 감자 and pages through it in the reader,
- turns on focus mode and steps to the next sentence,
- saves a word from the reader and reviews it as a flashcard in Learn,
- adds a song with lyrics and opens it,
- starts the screen-text scanner, scans the reader page (it must find Korean
  words), and turns the scanner off.

Freezes and crash signals come from the device log. To debug or try one part,
pass `--steps` with a comma-separated subset: `startup`, `tabs`, `book`,
`focus`, `songs`, `flashcards`, `ocr`, `offline`.

Timings vary between runs. The comparison only calls a startup "slower" past
20% and 300 ms. Treat small differences as noise.

### 6. Look at the screenshots

Open the PR run's screenshots in `$OUT/pr/`, and the matching ones in `$OUT/main/`
where something looks off. Focus on the screens the diff touches. Check for
broken layout, missing text, error banners or a stuck splash. If a smoke step
failed on both builds, the cause predates the PR. Say so, and don't blame the PR.

### 7. Restore the phone's dev build

The release APK replaced the dev build on the phone. Put the dev build back and
reconnect live reload, even if an earlier step failed:

```bash
adb -s R3KYC01FY8K install -r frontend/android/app/build/outputs/apk/debug/app-debug.apk
adb -s R3KYC01FY8K reverse tcp:8081 tcp:8081
adb -s R3KYC01FY8K shell cmd connectivity airplane-mode disable
```

The dev app's data stays wiped. The user accepted that trade-off.

### 8. Write the report

Save it to `.claude/pr-checks/pr<N>-<sha7>.md` (gitignored) and give it in chat.
Post it to GitHub only if the user asks. Keep it short, using this shape:

```markdown
# PR check: #<N> <title>

**Verdict:** Ready for your feel check | Needs fixes first: <one line why>

**CI:** <passing / failing: which check / still running>

<comparison table from smoke.py compare>

**Failed steps:** <none, or each step with one line on what happened>

**What I checked in the screenshots:** <1-3 bullets tied to what the PR changed>

**Before or after merging:** <native rebuild of the phone app, SQL to apply,
backend redeploy; omit if none>

**Your 5-minute feel check on the phone:**
1. <the screen or flow this PR changed: what to try and what "good" looks like>
2. Reading: open a book and read a page or two. Does scrolling and paging feel smooth?
3. Lookups: tap a few words. Do definitions appear quickly and look right?
4. Looks: anything misaligned, cut off, or the wrong color in light or dark mode?
5. Real network: try it on your normal Wi-Fi or mobile data, not just at the desk.
```

"Needs fixes first" applies when the PR build crashes or shows "not
responding", a smoke step fails only on the PR, cold start is "slower", there
are more freezes, CI fails, or a screenshot shows a visible regression.

## Notes

- The startup and freeze numbers come from the app's `[noeul-telemetry]` log
  lines (`frontend/services/appTelemetry.js`). A build from before that line
  existed shows no startup times. Say that rather than reporting a failure.
- The smoke script finds buttons by their English text or accessibility labels:
  tab names, "Public domain", "Add", "Resume", "Focus mode", "Next sentence",
  "Save", "Review N due", "Show answer", "Okay", "New song", "Song title",
  "Enter lyrics", "Save", "Back to songs", and "Turn on/off screen text scanner".
  If a PR renames one, update `smoke.py` in the same PR.
- The phone's system language and keyboard are Korean. smoke.py recognizes
  Android's dialogs in English and Korean (screen-share prompt, permission
  prompt, 16 KB notice). It types digits only, because `adb input text` goes
  through the keyboard, and a keyboard in Korean mode turns Latin letters into
  jamo.
- The reader's and song lyrics' text isn't visible to the screen reader. The
  flashcard step taps spots in the text area until a word with a dictionary
  entry opens. The OCR bubble is found through `dumpsys window`, and its result
  through the `OcrResultOverlay: ... targets=N` log line.
