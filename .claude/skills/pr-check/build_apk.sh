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
APK="$CACHE/apk/$SHA.apk"
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

# Gitignored files the build needs: the app's public env values (inlined into
# the JS bundle) and the SDK location.
[ -f "$REPO/frontend/.env" ] && cp "$REPO/frontend/.env" "$WT/frontend/.env"
[ -f "$REPO/frontend/android/local.properties" ] && cp "$REPO/frontend/android/local.properties" "$WT/frontend/android/local.properties"

echo "building $SHA (log: $LOG)" >&2
(cd "$WT/frontend" && npm ci --no-audit --no-fund) >>"$LOG" 2>&1
# arm64-v8a only: matches the Apple-silicon emulator and real phones, and
# halves the native build time.
(cd "$WT/frontend/android" && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon) >>"$LOG" 2>&1

cp "$WT/frontend/android/app/build/outputs/apk/release/app-release.apk" "$APK"
echo "$APK"
