#!/usr/bin/env bash
# Build a signed Noeul.ipa for App Store Connect.
#
#   frontend/scripts/ios-release.sh
#
# Archives the Release build and exports it with ios/ExportOptions.plist.
# The .ipa lands in frontend/ios/build/release/; upload it with Transporter.
# Before running: raise the build number (and version if you like), and have the
# signing files installed. See docs/ios-release.md.

set -euo pipefail

FRONTEND="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS="$FRONTEND/ios"
OUT="$IOS/build/release"
ARCHIVE="$OUT/Noeul.xcarchive"
export LANG=en_US.UTF-8

# The JS bundle reads the server URLs from .env.production (gitignored). Without it
# the app builds fine but can't reach the backend.
if ! grep -q "^EXPO_PUBLIC_API_BASE_URL=https://" "$FRONTEND/.env.production" 2>/dev/null; then
  echo "frontend/.env.production is missing or has no EXPO_PUBLIC_API_BASE_URL. Copy the production env values from eas.json (docs/ios-release.md)." >&2
  exit 1
fi

if ! security find-identity -v -p codesigning | grep -q "iPhone Distribution: Harim Song (GW2R499N63)"; then
  echo "Signing certificate missing or not valid. Install Noeul-Distribution.p12 and Apple's WWDR G3 certificate (docs/ios-release.md)." >&2
  exit 1
fi

VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$IOS/Noeul/Info.plist")
BUILD=$(/usr/libexec/PlistBuddy -c "Print CFBundleVersion" "$IOS/Noeul/Info.plist")
echo "Building Noeul $VERSION ($BUILD)"

rm -rf "$OUT"
mkdir -p "$OUT"

(cd "$IOS" && pod install)

xcodebuild -workspace "$IOS/Noeul.xcworkspace" -scheme Noeul -configuration Release \
  -destination "generic/platform=iOS" -archivePath "$ARCHIVE" archive \
  > "$OUT/archive.log" 2>&1 || {
    echo "Archive failed. Last lines of $OUT/archive.log:" >&2
    grep -A8 "The following build commands failed" "$OUT/archive.log" >&2 || tail -40 "$OUT/archive.log" >&2
    exit 1
  }

xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$IOS/ExportOptions.plist" -exportPath "$OUT" \
  > "$OUT/export.log" 2>&1 || { tail -40 "$OUT/export.log" >&2; exit 1; }

echo "Done: $OUT/Noeul.ipa (version $VERSION, build $BUILD)"
open "$OUT"
