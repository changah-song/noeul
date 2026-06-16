# FluentFable — Screen Design Prompts
# Screens designed in conversation that are not covered by the README

These prompts were used to generate Claude Design screens that extend or
replace the original 11-screen master mock. For each screen, use:
  1. src/theme.ts — all token values
  2. The prompt below — layout and state spec
  3. Screenshots from the relevant .dc.html file — visual ground truth

---

## LYRIC READER (Song Reader) — Redesigned States

The song reader carries the same persistent lookup sheet as the main reader.
Use `Fluent Fable Kindle Final.dc.html` screen 4 as the base visual.

### States to implement

**Lyric word tokens**
- Default — plain ink, no decoration
- Lookupable — 2px dotted #75777b underline
- Tapped — solid #202631 fill, white text, 3px radius

**Lookup sheet — definition area**
- definition: NOUN tag + gloss
- loading: two ffShimmer skeleton bars (1.4s)
- translate: result paragraphs
- Action button toggles: TRANSLATE (in definition mode) ⇄ DICTIONARY (in translate mode)

**Roots carousel**
- collapsed: sheet shows headword + definition only, grab handle shows "▲ SLIDE UP FOR ROOTS"
- expanded: slide handle up to reveal ROOT CHARACTERS carousel
- Related word toggle states: unsaved (#c5c6cb ring) ↔ saved (filled slate + check)
- "See more" expands card in place, flips to "See less"

**Save**
- SAVE pill toggles saved state
- Saved lyric words gain dotted underline

---

## NEW SONG COMPOSER — Redesigned

A focused writing surface, not a form. Open inputs on paper, no boxes.

### Layout

Bar (52px):
- Left: × CANCEL (Inter SemiBold 11px spaced caps)
- Center: NEW SONG (Inter Bold 12px +3.2px tracked caps — NOT Fraunces)
- Right: SAVE — muted (#9a9c9f) when empty, active (#202631) when fields have content

Fields (no box borders — bare inputs):
- 제목 / Title: Noto Serif KR Medium 22px, placeholder "제목" in #9a9c9f
- 아티스트 / Artist: Inter 15px, placeholder "아티스트" in #9a9c9f
- 1px #eceaea hairline divider
- 가사를 입력하세요 / Lyrics: Noto Serif KR 400 18px / line-height 2.0,
  placeholder "가사를 입력하세요" in #9a9c9f, no border, fills remaining height
  Slate caret (#202631)

Status bar (56px, top hairline #eceaea):
- Left: live character + line count, Inter 11px #9a9c9f
- Right: autosave status — "SAVING…" → "DRAFT SAVED", Inter 11px spaced caps #9a9c9f

On-screen Korean keyboard (raised when Lyrics focused):
- 두벌식 layout on #d4d0ce deck
- Predictive suggestion strip at top (middle item highlighted)
- White keys, 1px bottom shadow; utility keys #adb1ba
- Production: use platform keyboard

### States

1. Empty — all placeholders visible, SAVE muted
2. Partially filled — title + artist filled, lyrics empty, SAVE still muted
3. Fully filled — all fields have content, SAVE active (#202631)
4. Keyboard up — Lyrics focused, keyboard visible, status bar sits above keyboard
5. Saving — status bar shows "SAVING…" with 6px slate dot

---

## READER SCREEN — Full State Spec

Use `Fluent Fable Reader Screen.dc.html` as the authoritative visual.
The README section A covers this screen in full. Key additions:

### Word token states (4, not 2)
- Clean: plain #1b1c1c, no decoration
- Unknown/lookupable: 1px dotted #9a9c9f underline
- Tapped (active lookup): solid #202631 fill, white text, 3px radius
- Already saved: soft grey #e4e2e2 fill, ink text, 3px radius (persistent)

### Lookup sheet headword bar — 3 variants
A. Korean + Hanja: 정적 靜寂 jeong-jeok, chevrons active
B. Native Korean: 갈대 gal-dae, no Hanja, no chevrons
C. Not found: headword + "No definition found" + action row, no carousel

### Related word toggle — 3 states (not 2)
- Unsaved: 1.5px #c5c6cb ring, empty
- Known: 1.5px #202631 ring + slate check (no fill)
- Saved: filled #202631 + white check

### Settings panel
Sheet title: FONT SETTINGS (Fraunces 13px spaced caps)
Rows (48px, 1px #eceaea dividers):
- Font Size: stepper − 18 +
- Line Spacing: stepper − Relaxed +
- Brightness: slider at 62%, #202631 fill, #eceaea track

### More menu (··· popover)
184px wide, no shadow, 4px radius:
- Bookmarks (bookmarks icon)
- Notes (sticky_note_2 icon)
- Font settings (text_fields icon)
- Share (ios_share icon)
Each row 14px Inter, leading icon, 1px #eceaea hairline dividers.

### Edge cases
- Minimal sheet: short native word, one-line definition, no carousel — sheet noticeably shorter
- End of chapter: chapter complete treatment, NEXT CHAPTER button (solid #202631)
- Last chapter: NEXT CHAPTER replaced with finished/back-to-library treatment

---

## LONG-PRESS TRANSLATION BANNER — Reader + Song Reader

Triggered by long-press + drag to select multiple words.
A floating dark banner, NOT the full lookup sheet.

### Appearance
- Horizontally inset 16px from screen edges (not full bleed)
- Background: rgba(27,28,28,0.82) — #1b1c1c base, NOT inkSlate
- Radius: 10px
- Shadow: 0 8px 24px rgba(27,28,28,0.18)
- Slides up ease-out 240ms; dismisses ease-in 180ms
- Max 4 lines of translation text before truncating with "..."

### Text selection
- Selected text: #202631 at 18% opacity highlight
- Drag handles: 2px #202631, 10px circle cap at corners (iOS-style)

### Banner layout
Header row:
- translate icon (Material Symbols, 16px, #9a9c9f)
- "한국어 → English" Inter 11px +0.8px letterSpacing #75777b
- COPY right-aligned: Inter SemiBold 10px spaced caps #9a9c9f
  → COPIED state: label holds for 1.5s then reverts

Translation text:
- Inter 15px #ffffff line-height 1.6
- Max 4 lines, "..." truncation

### States (static frames)
1. Single word selected, translation ready
2. Multi-word selection (partial sentence)
3. Full sentence selected
4. Long selection at 4-line max, truncated
5. Loading — 2 skeleton lines rgba(255,255,255,0.12), no COPY yet
6. COPY tapped — label shows COPIED
7. Error — "번역할 수 없습니다" Fraunces Italic 14px #75777b, no COPY

### Behavior notes
- Tapping outside dismisses both highlight and banner (slide down 180ms ease-in)
- Drag handles extend/shrink selection; banner re-triggers loading on new selection
- If selection is in bottom third of screen, content scrolls up before banner appears

---

## PROFILE SCREEN — Redesigned

Fully themed, scrollable. Dark mode is a live token swap, not a separate screen.

### Layout (top to bottom)

Bar (52px):
- Left: menu icon
- Center: FLUENT FABLE (Inter Bold 12px +3.2px tracked caps)

Profile header:
- 56px slate circle (#202631) avatar with name initial (Fraunces Medium 24px, white)
- Display name: Inter SemiBold 17px #1b1c1c — tap to edit inline
  Edit mode: border-bottom 1px #202631, same size/weight, Save + Cancel inline
- Email: Inter 13px #75777b below name

COMPLETED BOOKS eyebrow → bookshelf:
- Spine heights: 114–166px, widths: 26–44px
- Tonal fills from slate/grey palette only
- Shelf bar: 6px #9a9c9f; shelf base: 10px #e4e2e2
- Vertical titles: writing-mode vertical-rl, Noto Serif KR 9px
- Spine left edge: 3px darker accent (depth)
- Radius: 2px

SETTINGS card (#ffffff, 1px #e4e2e2, 4px radius):
Row height 52px, 1px #eceaea dividers.

- Target Language: current value + chevron
  → bottom sheet: flag + language name + native name + checkmark on active
  Languages: 한국어, 中文, 日本語, Español, Français, Deutsch
- User Language: same pattern
- Daily Streak: value + local_fire_department icon, display only
  Guest state: value shows "—" + italic Fraunces nudge "Sign in to save your streak"
- Notifications: toggle switch (on = #202631, off = #e4e2e2)
- Dark Mode: toggle switch
  → flips entire screen through t.* token map:
    bg #fbf9f8 → #11151c
    surface #ffffff → #1b1c1c
    text #1b1c1c → #f0eded
    textMuted #75777b → #5c5e63
    border #e4e2e2 → #353c47
    divider #eceaea → #202631
    shelfBar #9a9c9f → #44474b
    (inkSlate, avatar bg stay unchanged)

ACCOUNT card:
Signed in rows:
- Change Email — tap expands inline: email input + Save / Cancel
- Change Password — tap expands inline: current + new password inputs + Save / Cancel
- Sign Out — tap opens confirmation sheet
- Delete Account — Inter 15px #5c5e63 (on-system, not red)
  → tap opens stern confirmation sheet

Signed out:
- SIGN IN: full-width solid #202631, white, Inter Bold 10px spaced caps, 52px, 4px radius
- REGISTER: full-width outline 1px #202631, same size
- 12px gap between buttons

### Bottom sheets (all screens)
- Scrim: rgba(27,28,28,0.32), ffScrim fade
- Sheet: #ffffff, radius 16px top corners, grabber 36×4px #e4e2e2
- Dismiss: backdrop tap or explicit Cancel

Sign Out sheet:
- Title: SIGN OUT (Fraunces 13px spaced caps)
- Body: Inter 14px #5c5e63 "You'll need to sign in again to access your library and progress."
- SIGN OUT: solid #202631 white
- CANCEL: 1px #e4e2e2 border, #1b1c1c text

Delete Account sheet:
- Title: DELETE ACCOUNT (Fraunces 13px spaced caps)
- Body: Inter 14px #5c5e63 "This will permanently delete your library, progress, and all entries. This cannot be undone."
- DELETE: #1b1c1c bg, white text (NOT inkSlate — feels final, neutral)
  → shows "Deleting…" disabled state briefly before transitioning
- CANCEL: outline

### Bookshelf states (static frames)
- Empty: shelf bar visible, no spines, centered italic Fraunces "Finish a book to fill your shelf" #9a9c9f
- Partial: 6 spines (default interactive frame)
- Overflow: 12+ spines, second shelf row appears

---

## OCR OVERLAY — Full Spec

Screen-read overlay, not a camera. Floats over whatever is on screen.
Reuses reader lookup sheet as a shared component.

### Detection colors (from OCR HTML inspection)
- Detected word fill: rgba(61,79,114,0.13) — class .ff-w
- Detected word border: inset 1.5px #3d4f72, 2px radius
- Pressed (tapped) word: solid #3d4f72 fill, white text — opens definition
- Region selected: rgba(61,79,114,0.24) fill, 4px radius — opens translation
- No text found: "텍스트를 찾을 수 없습니다" Inter 13px #75777b

### Floating circle
- 56px, rgba(32,38,49,0.90) bg, 1px #353c47 border
- FF cream monogram (stroke-only, #FAF8F5) at 28px
- Shadow: 0 4px 16px rgba(0,0,0,0.32) rest; 0 12px 30px rgba(0,0,0,0.42) dragging
- Freely draggable anywhere on screen
- States:
  - Default: resting bottom-right, 24px from edge, 48px above safe area
  - Dragging: scale(1.08), deeper shadow, opacity 85%
  - Over close target: bg shifts to #2d1a1a, border turns #C0392B
- Hides when definition or translation panel is open; reappears on dismiss

### Close target pill
Appears ONLY while dragging (slides up ease-out 200ms).
- Default: 160×48px, rgba(27,28,28,0.82) bg, 1px #353c47 border, 999px radius
  Centered: × CLOSE Inter SemiBold 11px spaced caps #9a9c9f
  Position: centered, 32px above bottom safe area
- Activated (bubble over it): grows to 200×56px ease-out 150ms
  bg rgba(192,57,43,0.92), border #e05a4a, label white
  Pulses: scale 1 → 1.04 → 1, 400ms loop (ffPulse)

### Definition panel (same shell as reader lookup sheet, compact)
- Shell: #ffffff, radius 16px top corners, Sheet-Lift shadow, grabber 36×4px #e4e2e2
- Horizontal padding: 20px (reader uses 24px)
- Action button height: 44px (reader uses 52px)

Headword (compact):
- Korean: Noto Serif KR SemiBold 24px (reader: 28px)
- Hanja: Noto Serif KR 16px #44474b
- Romanization: Fraunces Italic 13px #75777b
- Chevrons same as reader

Definition (compact):
- Part of speech pill: same style
- Definition: Inter 14px #44474b (reader: 15px)
- Multiple definitions: Inter 13px, line-height 1.4

Root characters carousel (compact):
- Card padding: 12px (reader: 16px)
- Hanja tile: 44×44px (reader: 54×54px)
- Hanja glyph: Noto Serif KR Medium 28px (reader: 34px)
- Meaning: Inter SemiBold 14px (reader: 16px)
- Related word rows: Noto Serif KR 13px + Inter 12px gloss
- Check circle: 26px (reader: 30px)
- Page dots: 5px (reader: 6px)
- "See more" Inter 12px #5c5e63

Translate state (same swap behavior as reader):
- TRANSLATION eyebrow, Inter 14px #44474b result
- Loading: 2 skeleton lines #f0eded radius 2px

### Translation panel (region selection)
Same shell as definition panel, simpler interior.
- Header: translate icon 16px #9a9c9f + "한국어 → English" Inter 11px +0.8px #75777b
  + COPY right-aligned Inter SemiBold 10px spaced caps #9a9c9f
  → COPIED: holds 1.5s, reverts
- Translation text: Inter 15px #ffffff line-height 1.6, max 4 lines
- Loading: 2 skeleton lines rgba(255,255,255,0.12), no COPY
- Error: "번역할 수 없습니다" Fraunces Italic 14px #75777b

### Nine frames to screenshot
1. Overlay active — boxes over screen content, circle at rest
2. Definition open — tapped word solid, definition panel up, circle hidden
3. Definition + TRANSLATE active — TRANSLATE button on #f0eded bg
4. Translation open — region selected, translation panel up
5. Translation loading — skeleton lines in panel
6. Dragging to close — circle mid-drag scaled, close pill default
7. Over close target — pill red + pulsing, circle border red
8. No text detected — centered "텍스트를 찾을 수 없습니다" + search_off icon
9. Word not found — definition panel, minimal, "No definition found"

### Key implementation note
OCR definition and translation panels are the SAME component as the reader
lookup sheet, just with compact sizing constants. Build one shared component,
pass a `compact` prop for the OCR context.

---

## DESIGN SYSTEM RULES (repeat for every agent prompt)

- All values from src/theme.ts — no hardcoded hex, font size, spacing, or radius
- ONE INK RULE: #202631 on interactive elements only. Never a second accent color.
  Exception: OCR overlay uses #3d4f72 (detection) and #C0392B (close target) only.
- THREE FONT ROLES: Inter (UI), Fraunces (literary/titles), Noto Serif KR (Korean)
- Fraunces italic: romanizations and literary captions ONLY
- HAIRLINES over shadows: 1px borders for structure; only 4 in-app shadows exist
- No dark mode except on Profile (token swap via t.* map)
- Showcase toggle chips in HTML files are NOT app UI — wire to real data
- Tab bar active state: 2px underline Colors.text (#1b1c1c), NOT inkSlate
- Book covers: typographic tonal tiles only — no raster art
