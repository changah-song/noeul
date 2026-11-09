# Releasing Noeul on iOS

Noeul ships under John's Apple developer account: team **Harim Song** (`GW2R499N63`).
Paul is an Admin there and can do everything in App Store Connect except make signing files.

- App Store Connect app: **Noeul**, Apple ID `6832584946`, bundle ID `com.noeulapp.Noeul`
- Primary language Korean ("Noeul"); English (U.S.) name is "Noeul: Learn by Reading" ("Noeul" was taken)
- Listing copy and the privacy/age-rating answers: [app-store-listing.md](app-store-listing.md)

## One-time setup on a Mac

1. **Xcode** from the Mac App Store, then the iOS platform: Xcode → Settings → Components → iOS → Get.
2. **Code:** clone the repo, then `npm install` in `frontend/`. `scripts/ios-release.sh` runs `pod install` itself.
   Create `frontend/.env.production` (gitignored): one `KEY=value` line for each entry under
   `build.production.env` in `frontend/eas.json` (`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`, ...).
   Without it the app builds but can't reach the server; the release script refuses to run.
3. **Signing files** (the "Noeul signing (App Store)" zip on Drive; never commit them):
   - Double-click `Noeul-Distribution.p12`, choose the **login** keychain, enter the password from `p12-password.txt`.
   - Double-click `Noeul_App_Store.mobileprovision`. Use the profile that includes Sign in with Apple
     (created 2026-11-09 13:19 UTC or later); the first one John made lacks it and signing fails.
   - Install Apple's intermediate certificate, or the certificate shows as "not valid":
     download https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer and double-click it (login keychain).
   - Check: `security find-identity -v -p codesigning` lists `iPhone Distribution: Harim Song (GW2R499N63)`.
4. **Transporter** from the Mac App Store; sign in with your Apple ID.

## Each release

1. Raise the build number, always: `CFBundleVersion` in `frontend/ios/Noeul/Info.plist`
   (Apple rejects a build number it has seen). Raise `CFBundleShortVersionString` for a new version.
2. `frontend/scripts/ios-release.sh` → `frontend/ios/build/release/Noeul.ipa` (about 15 minutes).
3. Transporter → drop in `Noeul.ipa` → Deliver. It shows up in App Store Connect after 10-30 minutes.
4. App Store Connect → Noeul → **+** next to iOS App → new version (same number as step 1) →
   What's New → Build: pick the upload → Save → Add for Review → Submit for Review.

## Gotchas

- **Don't run `expo prebuild --clean`.** It regenerates `frontend/ios/` and drops the manual signing
  settings and the quoted bundle-script line in `project.pbxproj`. If you must, re-apply both:
  `CODE_SIGN_STYLE = Manual`, `DEVELOPMENT_TEAM = GW2R499N63`, the "Noeul App Store" profile on the
  Noeul target, and quote the `react-native-xcode.sh` command in the "Bundle React Native code and images" phase.
- **A space in the repo path** (e.g. `Personal Projects`) used to break two build scripts. Both are fixed:
  `scripts/expoConstantsAppConfig.sh` (wired up by `plugins/withIosPodFixes.js`) and the quoted bundle-script line.
- **Screenshots:** the required slot is "iPhone with Dynamic Island (medium display)", 1206×2622 or 1179×2556,
  under the "App Previews and Screenshots" tab (not "Header and Search Results").
- **Per-language fields:** Privacy Policy URL is set per localization; a new language starts empty.

## When to ask John

- An upload or submission fails over an agreement ("sign the latest agreement").
- November 2027: the certificate and profile expire.
- A new capability (push notifications, iCloud, in-app purchases, ...): he enables it and sends a new profile.
- EU trader status (Digital Services Act): until he sets it, Noeul isn't offered in the EU.
