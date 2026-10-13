#!/usr/bin/env bash
# Build a release APK for one commit and print its path.
#
#   build_apk.sh <git-ref>
#
# Builds in a throwaway git worktree, so the user's checkout and uncommitted
# work are never touched. APKs are cached by commit SHA, so main usually only
# builds once. Build output goes to <cache>/logs/<sha>.log.
set -euo pipefail

REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
REF=${1:?usage: build_apk.sh <git-ref>}
SHA=$(git -C "$REPO" rev-parse --verify "${REF}^{commit}")
CACHE=${NOEUL_PR_CHECK_CACHE:-$HOME/.cache/noeul-pr-check}
# Builds use the EAS "preview" profile's env (the production backend and
# Supabase), the same settings as a real release. The "-preview" suffix keeps
# them apart from older cached builds made with the local dev .env.
PROFILE=${NOEUL_PR_CHECK_PROFILE:-preview}
APK="$CACHE/apk/$SHA-$PROFILE.apk"
LOG="$CACHE/logs/$SHA.log"

if [ -f "$APK" ]; then
  echo "$APK"
  exit 0
fi

mkdir -p "$CACHE/apk" "$CACHE/logs" "$CACHE/worktrees"
WT="$CACHE/worktrees/$SHA"

export JAVA_HOME=${JAVA_HOME_17:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}
export ANDROID_HOME=${ANDROID_HOME:-$HOME/Library/Android/sdk}

cleanup() { git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

git -C "$REPO" worktree add --detach "$WT" "$SHA" >"$LOG" 2>&1

# The app's public env values are inlined into the JS bundle. Take them from
# the commit's own eas.json build profile, not the local dev .env, whose
# backend address (10.0.2.2) only works from the emulator.
python3 - "$WT/frontend/eas.json" "$PROFILE" > "$WT/frontend/.env" <<'PY'
import json, sys
env = json.load(open(sys.argv[1]))["build"][sys.argv[2]].get("env", {})
if not env.get("EXPO_PUBLIC_API_BASE_URL"):
    sys.exit(f"eas.json profile {sys.argv[2]!r} has no EXPO_PUBLIC_API_BASE_URL")
for key, value in sorted(env.items()):
    print(f"{key}={value}")
PY
# Gitignored: the SDK location.
[ -f "$REPO/frontend/android/local.properties" ] && cp "$REPO/frontend/android/local.properties" "$WT/frontend/android/local.properties"

echo "building $SHA (log: $LOG)" >&2
(cd "$WT/frontend" && npm ci --no-audit --no-fund) >>"$LOG" 2>&1
# arm64-v8a only: matches the Apple-silicon emulator and real phones, and
# halves the native build time.
(cd "$WT/frontend/android" && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon) >>"$LOG" 2>&1

cp "$WT/frontend/android/app/build/outputs/apk/release/app-release.apk" "$APK"
echo "$APK"
