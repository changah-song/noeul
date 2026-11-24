# Store images, Nov 2026 (songs)

`python3 make.py && sh render.sh` writes every image to `out/`.

- `shots/` are iOS simulator screenshots (iPhone 17, Korean interface, learning English, level B1, status bar set to 9:41 with `xcrun simctl status_bar`).
- The song is "Amazing Grace" (1779 words, public domain), artist shown as "Traditional hymn". The video area above the lyrics is drawn over with a waveform in the image (base.css `.wave`), so no performer or label artwork shows; "That saved a wretch like me!" is the lit line.
- Style matches the live 01–06 screenshots: slate background, Fraunces headline, Inter body.
- appstore-header-<lang>-3840x1646: the 21:9 App Store product page header (copy centred, since the store crops the sides).
- Where each image goes: docs/store-listing-songs-update.md.
