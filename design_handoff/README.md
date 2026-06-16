# Handoff: Fluent Fable Reskin — "Slate & Stone" (the Kindle setting)

## Overview

This is a full visual reskin of **Fluent Fable**, a mobile language-learning reader (Korean / English / Chinese). The direction is called **"Slate & Stone"** — ink on paper in a cool, low-chroma register. The whole interface is built from **hairline rules instead of shadows**, **tracked uppercase labels**, a **text-only tab bar**, **typographic book covers** (no cover art), and **one slate ink — `#202631` — doing all of the interactive work**. Emphasis comes from weight, tracking, and the single slate.

Three type roles are kept strictly separate: **Inter** for the interface, **Fraunces** for the literary voice (section titles, romanizations, screen-bar labels, stat numerals), and **Noto Serif KR** for anything in the learning language itself.

### What's in this package

The package now contains **five design files**, all in `design/`:

| File | What it is |
|---|---|
| **Fluent Fable Kindle Final** | The master mock — **11 screens** across the app's five-tab shell, plus empty/edge/dark states. The system source of truth. |
| **Fluent Fable Reader Screen** | A deep-dive, **state-by-state spec of the reading surface + dictionary lookup** (screen 3), including an interactive assembled reader, the font-settings panel, and edge cases. |
| **Fluent Fable OCR Overlay** | The **screen-OCR floating overlay** — "read anything on screen." Nine frames + detection-layer and floating-circle state studies. This screen was previously unmocked; it is now fully specified here. |
| **Component States** | A **contact sheet of every interactive component** in its full range of states (default / pressed / disabled / active / inactive). The build reference. |
| **App Icon FF** | The **app icon** — the "FF" / open-book monogram, at multiple sizes. |

The 11 master screens are: Home/Library, Book Preview, Reader + dictionary lookup, Song Reader, New Song composer, Vocabulary list, Word Detail, Flashcard Review, Write Archive, Write — New Entry composer, and Profile. The remaining un-mocked surfaces (settings sub-screens, edit-book, auth, etc.) should be derived from the same token system, the component rules below, and the behavior inventory in `reference/FEATURES_AND_INTERACTIONS.md`.

> Note: this is a different, more evolved direction than the earlier "Annotated Page" (terra cotta / DM Sans) package. Where the two conflict, **this Slate & Stone package is the current intent.**

## About the Design Files

The files in `design/` are **design references created in HTML** — prototypes showing intended look, layout, and (lightly) behavior. They are **not production code**. Your task is to **recreate these designs in the Fluent Fable codebase's existing environment** (e.g. React Native / Expo, or whatever the app is built in), using its established navigation, state, and component patterns. If no app codebase exists yet, choose the framework most appropriate for a cross-platform mobile reader and implement there.

Rendered PNGs of every master screen are in `visuals/` (numbered to match the screen order below). Open any `design/*.dc.html` in a browser for the source of truth — every style is inline, so you can inspect any element in dev tools for exact values. Phone frames are laid out at **390×844** (iPhone-class logical resolution). The grey page behind the phones (`#dcd9d9` / `#E8E5E0` on the icon) is showcase backdrop only; the app screen background is `#fbf9f8`.

## Fidelity

**High-fidelity.** Colors, typography, spacing, radii, and copy are final. Recreate the UI pixel-faithfully using the codebase's existing component infrastructure. Where this README and the HTML disagree, **the HTML wins.** Where two design files disagree, **the more specific file wins** for its subject (e.g. the Reader Screen file governs the reader; Component States governs component states).

One deliberate exception: the **reader page content** (font, size, line height inside the ebook view) is user-configurable at runtime. The values shown (Noto Serif KR 18px / line-height 2.0) are the *defaults*, exposed through the Font Settings panel (see the Reader Screen file).

---

## Design Tokens

### Colors

The palette is intentionally near-grey. The only "color" in the core app is the slate ink. Two additional hues exist **only inside the OCR overlay** (see the One Ink Rule note below).

| Token | Hex | Usage |
|---|---|---|
| `ink-slate` (Slate Ink) | `#202631` | THE interactive ink. Active tab underline, primary buttons, progress fills, FAB, saved/known states, dictionary highlight fill, page dots (active), "more" links, caret. The only near-saturated value in the core app. |
| `ink-pressed` | `#0e1014` | **Pressed state** of any slate fill (primary button, FAB) — paired with an inset shadow + 1px downward nudge. |
| `ink-slate-deep` | `#11151c` | Book-cover spine edge / deepest tone only. |
| `cover-slate` | `#353c47` | Darkest typographic book-cover background; also the 1px border on OCR floating chrome. |
| `icon-slate` | `#333B46` | App-icon background fill (squircle). |
| `text` (Deep Ink) | `#1b1c1c` | Primary text. |
| `text-secondary` | `#44474b` | Icon strokes, secondary headings. |
| `text-muted` | `#5c5e63` | Secondary text, metadata, eyebrow labels. |
| `text-tertiary` | `#75777b` | Tertiary text, romanizations, helper copy. |
| `text-subtle` | `#9a9c9f` | Placeholders, inactive eyebrows, counts, inactive tab/nav text, dotted-underline (reader). |
| `bg-page` (Warm Paper) | `#fbf9f8` | Screen background on every screen. Also tab bar. |
| `surface` | `#ffffff` | Inputs, sheets, and most cards. |
| `surface-card` | `#fefdfc` | Flashcard + Root-Character carousel cards (a hair warmer than white). |
| `surface-muted` | `#f0eded` | Inset blocks: muted covers, Hanja inset, download tile, chip fills, active TRANSLATE tab. |
| `surface-assist` | `#f4f1f1` | Writing-editor vocabulary assist strip. |
| `cover-mid` | `#75777b` | Mid-tone typographic book cover. |
| `divider` (Hairline) | `#eceaea` | In-card dividers / row separators, 1px. |
| `border` (Card Rule) | `#e4e2e2` | Card and element borders, 1px; also the "already-saved" word fill in the reader. |
| `border-strong` | `#c5c6cb` | Input borders, outline pills, inactive mark-known ring. |
| `frame` | `#b0b2b6` | Device-frame border, low-emphasis icon strokes, inactive dot edge. |
| `dot-inactive` | `#d2d0d0` | Inactive carousel page dot. |
| **`ocr-navy`** | `#3d4f72` | **OCR overlay only** — word-detection boxes (1.5px outline, ~13% fill at rest, solid when pressed, ~24% fill for a region selection). |
| **`destructive`** | `#C0392B` | **OCR overlay only** — the close/dismiss target and the floating circle when it is over the close target. |
| `glyph-cream` | `#FAF8F5` | The FF monogram stroke, on the app icon and the OCR floating circle. |

**The One Ink Rule:** in the core app, slate `#202631` appears on interactive/active elements only — never a second saturated color, no gradients, no glows. **Scoped exception — the OCR overlay** introduces exactly two hues (`ocr-navy` for detection boxes, `destructive` for the close target) because that surface floats over arbitrary third-party UI and must read unmistakably as system chrome, not as content. Keep both colors confined to the overlay; they must never leak into in-app screens.

### Typography

Fonts: **Inter** (400/500/600/700), **Fraunces** (optical-size axis; 400/500/600, plus italic 400/500), **Noto Serif KR** (400/500/600/700). Icons: **Material Symbols Outlined** (variable: `FILL 0, wght 300, GRAD 0, opsz 24` at rest). Fallbacks: system-ui/sans-serif, Georgia/serif, serif.

| Style | Spec | Usage |
|---|---|---|
| Display | Fraunces 500, 50px / 1.1, −0.01em | Showcase cover title only |
| Part title | Fraunces 500, 26px | Section dividers ("The Library", "Reading", "Study", "Desk & Identity"); spec-file section titles |
| Screen heading (serif) | Fraunces 500–600, 30–32px | "Archive", "Alex Chen" |
| Screen heading (sans) | Inter 600, 28px, −0.02em | "Welcome back." |
| App-name bar title | Inter 700, 12px, +3.2px tracking, UPPERCASE | Top-bar app title ("FLUENT FABLE", "BOOK", "VOCABULARY") |
| Screen-bar title (serif caps) | Fraunces 400, 13px, +4px tracking, UPPERCASE | Modal/composer bar titles ("FLASHCARD", "NEW SONG", "NEW ENTRY", "FONT SETTINGS") |
| Eyebrow | Inter 600, 9–10px, +1.6–2.6px tracking, UPPERCASE, `#75777b`/`#9a9c9f` | Section markers ("LIBRARY", "ROOT CHARACTERS", "MEANING", "RELATED WORDS", "TRANSLATION") |
| Stat numeral | Fraunces 500, 24–26px | Vocab stats (128 / 42 / 17), word-detail counts |
| Body UI | Inter 400, 13–15px / 1.45–1.7, `#5c5e63` | Definitions, descriptions, metadata |
| Label | Inter 600–700, 10–11px, +1.4–1.8px tracking | Buttons, status chips, tab labels |
| Romanization | Fraunces *italic* 400, 12–17px, `#75777b` | Romanized readings (e.g. *jeong-jeok*). Italic is reserved for romanization + literary captions. |
| Korean reader body (default) | Noto Serif KR 400, 18px / 2.0 | Ebook + song page text — user-configurable |
| Korean title | Noto Serif KR 600, 16–23px | Book titles, entry titles, headwords in lists |
| Korean headword | Noto Serif KR 600, 28px (lookup) · 500 36px (detail) · 500 60px (flashcard) | Lookup / detail / flashcard headwords |
| Hanja glyph | Noto Serif KR 500, 32–38px, `#202631` | Root-character tiles, Hanja insets |

**Serif-for-Content Rule:** Fraunces = literary/section hierarchy; Inter = functional UI; Noto Serif KR = anything in the learning language. Italics are *only* for romanizations and literary captions — never for UI labels.

### Radii

| Token | Value | Usage |
|---|---|---|
| frame | 34px | Device frame (40px on the OCR-overlay phone frames) |
| sheet | 16px 16px 0 0 | Bottom-sheet top corners |
| card | 4px | Collection cards, vocab card, carousel cards, stat cards |
| input | 3px | Text inputs, Hanja-tile, chips, **primary/secondary buttons** |
| cover | 2px | Typographic book covers, progress bars, reader word tokens |
| pill | 999px | Type pills, status dots, mark-known rings, FAB, OCR floating circle + close target |
| badge | 2px | Status badges ("REVIEWED", "NEW", "PDF") |
| icon | 230/1024 (~22.5%) | App-icon squircle corner (86px at 384px render) |

### Spacing scale

4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 22 / 24 / 26 / 28. Screen content padding: **24px horizontal** (20px in a few dense bars). Card padding 16–18px. Inter-section gaps 22–28px.

### Elevation & interaction (hairline-first — shadows are rare)

The design is overwhelmingly flat; structure comes from 1px rules, not shadows. The few shadows that exist:

- **Sheet Lift** — `0 -10px 30px rgba(27,28,28,0.08)`: dictionary/translation bottom sheets and the font-settings panel only.
- **FAB** — `0 6px 16px rgba(27,28,28,0.25)`: Home compose FAB only.
- **Cover Lift** — `0 14px 28px rgba(27,28,28,0.22)`: the large book cover in Book Preview only.
- **OCR circle shadow** — `0 4px 16px rgba(0,0,0,0.32)` at rest, deepening to `0 12px 30px rgba(0,0,0,0.42)` while dragging.
- **Showcase frame shadow** — `0 24px 48px rgba(27,28,28,0.10)`: only the *presentation* drop-shadow on the phone frames; **do not** ship it as in-app chrome.

**Press / disabled (global):** pressed slate surfaces darken to `ink-pressed #0e1014`, gain an inset shadow (`inset 0 2px 5px rgba(0,0,0,0.45)`), and nudge `translateY(1px)`. Outline (secondary) controls fill `#ece9e9` and nudge down on press. Disabled controls drop to `#e4e2e2` fill / `#b0b2b6`–`#c5c6cb` text. No background-shift hover states. (Exact swatches in the **Component States** file.)

---

## Screens / Views

All phone frames: 390×844, background `#fbf9f8`, 1px `#b0b2b6` outer border, 34px radius. **Status bar row:** 44px, "9:41" left (Inter 13px 600), a small outline battery glyph right (18×9px, 1px `#5c5e63`, inner fill bar). Use the platform's real status bar in production.

### ⚠ Showcase controls vs. app UI

The master file is **interactive** — above several phones you'll see small tracked-caps **toggle chips** (e.g. `CURRENT READING: IN PROGRESS / EMPTY / FINISHED`, `BOOK: DEFAULT / PUBLIC / NOT DL / DOWNLOADING`, `SHELF: EMPTY / PARTIAL / OVERFLOW`, `DARK`, `GUEST`). **These chips are presentation scaffolding, not part of the app.** They flip the phone beside them between states so you can see every variant from one file. Do **not** build them into the product — wire the underlying states to the app's real data/events. Likewise the grey backdrop and the phones' presentation drop-shadow are showcase chrome only.

### Demonstrated states (drive these from real app state)

The master file mocks the empty/edge states alongside the happy path:

- **Home — Current-reading card:** `IN PROGRESS` / `EMPTY` / `FINISHED`. Plus a **grid ⇄ list** view toggle.
- **Home — empty collections:** **Empty · My Books**, **Empty · Public Domain**, **Empty · Songs** — warm-paper canvas, centered hairline-circle icon, serif headline, muted subtext, one or two action pills.
- **Book Preview:** `DEFAULT` / `PUBLIC` / `NOT DL` / `DOWNLOADING…`; **snippet PRESENT / NONE**; **favorite ★ toggle**.
- **New Song — live composer:** focusing Lyrics raises the on-screen keyboard; typing updates the field. Fidelity demo — use the platform keyboard in production.
- **Profile — bookshelf:** `EMPTY` / `PARTIAL` / `OVERFLOW`; a **DARK** appearance state (whole screen re-themes via the `t.*` token map); a **GUEST ⇄ SIGNED IN** auth state. Dark mode is mocked on Profile but the token approach is meant to extend app-wide.

### Global: Tab Bar (text-only)

- Height **64px**, background `#fbf9f8`, top border 1px `#e4e2e2`, **5 equal columns** (HOME, READ, VOCAB, WRITE, PROFILE).
- **No icons.** Each label is Inter 10px, +1.8px tracking, UPPERCASE.
- **Active:** weight 700, `#1b1c1c`, with a 2px `#1b1c1c` underline (5px padding above it). **Inactive:** weight 500, `#9a9c9f`, 7px bottom padding, no underline.
- Tab bar hides in full-screen subflows (reader, song reader, composers, flashcard modal, OCR overlay).

### PART I — The Library

#### 1. Home — Library
- App-name bar: language selector "KO ▾" left, centered "FLUENT FABLE", `screenshot_region` (OCR) icon right — **this icon launches the Screen OCR Overlay.**
- **Hero:** eyebrow "LIBRARY" → "Welcome back." → one line of subtext, centered.
- **Current-reading card:** `#ffffff`, 1px `#e4e2e2`, radius 4px, 16px padding. Left: 86×122 typographic cover. Right: title (Noto Serif 600 19px) + "KO · B1" badge, italic-Fraunces author, then "64% Progress" / "Ch. 4 of 27", a 3px track (`#eceaea`) with `#202631` fill, and a full-width **RESUME** button.
- **Collection header:** eyebrow "COLLECTION" + grid/list view icons.
- **Segmented tabs:** MY BOOKS / PUBLIC DOMAIN / SONGS.
- **Book grid:** 2 columns, 18px gap, aspect-ratio 2/3 typographic covers (no art); plus "PDF" badge, "DOWNLOAD" tile, dashed "IMPORT EPUB" tile.
- **Compose FAB:** 52px circle, solid `#202631`, white `add`, bottom-right above the tab bar.

#### 2. Book Preview (full-screen Home subflow)
- Bar: `arrow_back` · "BOOK" · "READ" right.
- **Cover stage:** `#f0eded` band, centered 172×244 cover (Cover Lift shadow, 4px left spine `#11151c`).
- Title + italic author, centered.
- **Action row** (bordered, 4 cols): FAVORITE / DOWNLOAD / EDIT / DELETE.
- **Metadata** 2-col grid (WORD COUNT, GENRE, LANGUAGE, LAST OPENED).
- **Snippet** eyebrow → Korean passage + italic English gloss + chapter attribution.

### PART II — Reading

#### 3. Reader — Dictionary Lookup ★
**The dedicated `Fluent Fable Reader Screen` file is the authoritative spec for this screen** — what follows is the summary; consult that file for every state. Key facts:

- **Reader header** (56px, bottom hairline): `arrow_back_ios_new` · two-line "Chapter 4 / 달과 강" · right cluster (60px progress hairline + "64%") · `more_horiz`.
- **Page content:** Noto Serif KR 400 **18px / 2.0**, `#1b1c1c`. Word token states (see below).
- **Lookup bottom sheet:** `#ffffff`, top hairline, radius 16px 16px 0 0, **Sheet Lift** shadow. Grabber handle, headword row (chevrons step morphemes), definition row, **ROOT CHARACTERS carousel**, and a SAVE / TRANSLATE action row.

#### 4. Song Reader — lyric reader + lookup ★ (redesigned)
The song reader is no longer a passive lyric page — it now carries the **same persistent lookup sheet as the main reader**, plus a slide-up "roots" gesture. See **"Lyric Reader (Song Reader) states"** below for the full state list.
- **Bar** (52px): `arrow_back` left, centered Korean song title (Noto Serif 600 16px), `settings` right.
- **Lyric body:** centered. Eyebrow "전통 민요 · TRADITIONAL FOLK" + a 28px centered rule; stanzas (Noto Serif 400 **19px / 2.5**), with a "···" stanza separator. Lyric word tokens use the reader's model — **tapped** word = solid slate fill / white; **lookupable** word = 2px dotted `#75777b` underline.
- **Persistent lookup sheet** (bottom, `#ffffff`, radius 16px top, Sheet-Lift shadow): a **grab handle** with a "▲ SLIDE UP FOR ROOTS" hint, a headword bar (`희망 希望 hui-mang` w/ chevrons), the definition / loading / translation area, an **expandable ROOT CHARACTERS carousel** (희 / 望 cards with related words + mark-known toggles + "See more"), and an action row: `SAVE` + a button that **toggles `TRANSLATE` ⇄ `DICTIONARY`** (`translate` icon ⇄ `menu_book` icon) as you flip between dictionary and translation.

#### 5. New Song — live composer ★ (redesigned)
A fully interactive composer with a real on-screen Korean keyboard and autosave. See **"New Song Composer states"** below.
- **Bar** (52px): `close` + "CANCEL" left, "NEW SONG" (Inter 12px 700, +3.2px tracked caps) centered, **"SAVE"** right — its style changes from muted to active once the song has content (`saveStyle`).
- **Fields** (no boxes — bare inputs on paper): **제목 / Title** (Noto Serif 500 22px), **아티스트 / Artist** (Inter 15px), a hairline divider, then **가사를 입력하세요 / Lyrics** (Noto Serif 400 18px / 2.0 textarea, fills remaining height). Slate caret (`caret-color: #202631`); placeholders in `#9a9c9f`.
- **Status bar** (56px, top hairline): live character count left (`countText`); autosave status right (`statusText` — e.g. "SAVING…" → "DRAFT SAVED"). Composer drafts persist to `localStorage` (`ff_composer`).
- **On-screen Korean keyboard** (raised when Lyrics is focused): 두벌식 layout on a `#d4d0ce` deck — a **predictive suggestion strip** (e.g. 강물 / 강 / 강가, middle item highlighted), three jamo rows (ㅂㅈㄷㄱㅅㅛㅕㅑ… / ㅁㄴㅇㄹㅎㅗㅓ… / ⇧ ㅋㅌㅊㅍㅠㅜㅡ ⌫), and a bottom row (`123` · emoji · `한국어` spacebar · `↵`). White keys with a 1px bottom shadow; utility keys `#adb1ba`; home indicator below. This is a fidelity demo — **use the platform keyboard in production.**

### PART III — Study

#### 6. Vocabulary
- App-name bar "VOCABULARY".
- **Summary card:** 3-column stat grid (128 MATURED / 42 WAITING / 17 NOT SEEN) divided by hairlines; "REVIEW 12 DUE" + "KEEP READING" pills.
- **Filter tabs:** RECENT / STARRED / MATURITY / NOT SEEN.
- **Word rows** (hairline-separated): word + Hanja + optional star/"NEW"; definition; source · count · date; right-side 4-dot **maturity meter**.

#### 7. Word Detail
- Bar: `arrow_back` + "VOCABULARY" eyebrow; filled `star` right.
- Headword 정적 (Noto Serif 500 36px) + 靜寂 + *jeong-jeok*; "waiting" pill + "×3 encounters".
- "NOUN" + definition; "SEEN IN" context quotes; 2-col stat cards; **Hanja inset** with related compound rows.

#### 8. Flashcard Review (modal over Learn)
- Bar: `close` · "FLASHCARD" · "1 / 12".
- **Card:** flex-fill, `#fefdfc`, radius 10px. Centered word (Noto Serif 500 60px) + romanization + "TAP TO FLIP".
- Footer: full-width **SHOW ANSWER** + progress nub.

### PART IV — Desk & Identity

#### 9. Write — Archive
- App-name bar "WRITE" + `edit_square` right.
- "Archive" + "8 entries · Korean".
- **Filter tabs:** ALL / FREE / DIARY / ESSAY.
- **Entry rows:** title + "JUN 11 · 412 CHARS · DIARY" meta; **status badge** REVIEWED / DRAFT / SUBMITTED; chevron.

#### 10. Write — New Entry (composer, full-screen subflow) ★
- Bar: `close` + "CANCEL" · "NEW ENTRY" · "SAVE".
- **Entry-type selector:** DIARY / FREE / ESSAY pills + date right.
- **Prompt block:** 2px `#c5c6cb` left rule, "TODAY'S PROMPT" → Korean prompt → italic English gloss.
- **Title** + **body editor** (Noto Serif 400 16px / 2.0, dotted-underline saved word, blinking caret).
- **Vocabulary assist strip** (`#f4f1f1`): `menu_book` + "FROM YOUR VOCABULARY" + suggestion chips (tap inserts).
- **Bottom toolbar:** `translate` / `spellcheck` / `format_quote`; "168 chars" + "● SAVING…".

#### 11. Profile — Shelf, Settings & Account ★ (redesigned)
A scrollable, **fully themed** profile (light ↔ dark is a `t.*` token swap) with inline-edit, real toggle switches, and confirmation sheets. See **"Profile states"** below.
- **Bar** (52px): `menu` left, "FLUENT FABLE" centered (Inter 12px 700, +3.2px tracked caps).
- **Header:** 56px slate-circle avatar with the name's initial (Fraunces 500 24px, white); **inline-editable name** (tap → input + Save / Cancel); email (`alex.chen@gmail.com`) beneath.
- **COMPLETED BOOKS** eyebrow → **bookshelf**: rows of book spines standing on a shelf (a 6px `shelfBar` over a 10px `shelfBase`), variable heights to ~166px, tonal fills, vertical titles (`writing-mode: vertical-rl`, mixed Inter caps + Noto Serif). Empty shelf shows "Finish a book to fill your shelf" (italic Fraunces). States: `partial` / `empty` (and overflow).
- **SETTINGS** card (hairline-separated rows on `t.card`): **Target Language** (→ opens a language **bottom sheet**: flag · native · English · check on active), **User Language** (→ same sheet), **Daily Streak** (value + filled `local_fire_department` 🔥; when a guest, an italic "Sign in to save your streak" nudge appears), **Notifications** (iOS-style **toggle switch** — track + sliding knob), **Dark Mode** (toggle switch — flips the whole screen's theme in place).
- **ACCOUNT** card: signed-in → **Sign Out** + **Delete Account** (red `#c0362c`); signed-out → **SIGN IN** (solid slate) + **REGISTER** (slate outline).
- **Bottom sheets** (scrim `rgba(27,28,28,0.32)` + `ffScrim` fade, radius 16px top): language picker, **Sign Out** confirm, **Delete Account** confirm (destructive button uses a hold/confirm `deleteBtnStyle`). Dismiss by backdrop tap.
- **States to drive:** `DARK` appearance and `GUEST ⇄ SIGNED IN` (auth changes the streak nudge, the account card, and which sheets are reachable).

---

## Redesigned Screen States (drive from real app state)

Three screens carry meaningful interaction state beyond a single layout. Recreate each state.

### Lyric Reader (Song Reader) states
The bottom lookup sheet mirrors the main reader's, with one extra gesture:
- **Lyric word token:** default · lookupable (dotted `#75777b` underline) · tapped (solid slate fill, white).
- **Sheet — definition area:** `definition` (NOUN tag + gloss) · `loading` (two `ffShimmer` bars) · `translate` (result paragraphs). The action button reads **TRANSLATE** in definition mode and **DICTIONARY** in translate mode (toggles back).
- **Roots:** `collapsed` (sheet shows only headword + definition) ⇄ `expanded` — **slide the grab handle up** ("▲ SLIDE UP FOR ROOTS") to reveal the ROOT CHARACTERS carousel; each related word toggles unsaved (`#c5c6cb` ring) ↔ saved (filled slate + check), with "See more" expanding the card.
- **Save:** the `SAVE` pill toggles saved; saved lyric words gain the dotted underline.

### New Song Composer states
- **Save button:** `inactive` (empty song, muted) → `active` (has content) via `saveStyle`.
- **Field focus:** focusing Title/Artist focuses inline; **focusing Lyrics raises the Korean keyboard** (`kbOpen`). Tapping outside / a field blur lowers it.
- **Autosave:** `statusText` cycles "SAVING…" → "DRAFT SAVED"; `countText` updates live. Draft persists to `localStorage` (`ff_composer`) and rehydrates on mount.
- **Keyboard:** predictive suggestion strip updates as you type; otherwise a static 두벌식 layout. Production: platform keyboard + input handling.

### Profile states
- **Name:** `viewing` (tap to edit) ⇄ `editing` (input + Save / Cancel); avatar initial follows the name.
- **Bookshelf:** `partial` / `empty` ("Finish a book to fill your shelf") / overflow.
- **Toggles:** Notifications on/off; **Dark Mode** on/off — Dark re-themes the entire screen through the `t.*` token map (`bg`, `pri`, `sec`, `mut`, `eye`, `hair`, `card`, `bord`, `under`, `shelfBar`, `shelfBase`). The token approach is meant to extend app-wide.
- **Auth:** `signed-in` (Sign Out + Delete Account) ⇄ `guest` (SIGN IN + REGISTER, plus the "Sign in to save your streak" nudge on Daily Streak).
- **Bottom sheets:** Target/User-Language picker, Sign Out confirm, Delete Account confirm (destructive `deleteBtnStyle` / `deleting`), each over a scrim — exactly one open at a time.

---

## Standalone Specs (the four supporting files)

### A · Reader Screen — `Fluent Fable Reader Screen.dc.html`

The authoritative, state-by-state spec for **screen 3**. Six sections:

**1 · App Bar.** 56px, bottom hairline. Left `arrow_back_ios_new`; center two-line "Chapter 4" (Inter 15px 600) / "달과 강" (13px `#75777b`); right cluster = 60px progress hairline (64% slate fill) + "64%" + `more_horiz`. The `more_horiz` opens a **184px popover** (static mock): **Bookmarks · Notes · Font settings · Share**, each a 14px row with a leading Material icon, hairline-separated.

**2 · Reading Surface** (`#fbf9f8`, Noto Serif KR **18px / line-height 2.0**). Four word-token states:
| State | Treatment |
|---|---|
| **Clean** | plain ink `#1b1c1c`, no decoration |
| **Unknown / lookupable** | 1px **dotted `#9a9c9f`** underline |
| **Tapped (active lookup)** | solid slate `#202631` fill, white text, 3px radius |
| **Already saved** | soft grey `#e4e2e2` fill, ink text, 3px radius (persistent marker) |

> This refines the master-file shorthand: a **dotted underline** flags a word you *can* look up / haven't mastered; the **slate fill** is the transient tap highlight; a **grey fill** persists on words already saved to vocabulary.

**3 · Lookup Sheet.** Bottom sheet, top corners 16px, Sheet-Lift shadow, 36×4 grabber.
- **Headword bar — 3 variants:** (A) **Korean + Hanja** — `정적 靜寂 jeong-jeok` flanked by `chevron_left/right` that **step between morphemes** (‹ disabled at the first morpheme, › active); (B) **native Korean** — `갈대 gal-dae`, no Hanja, no arrows; (C) **not found** — headword + "No definition found" + the action row.
- **Definition area — 3 states:** **definition** ("NOUN" outline tag + numbered senses), **translate** (result paragraphs), **translate · loading** (two shimmer bars, `ffShimmer` 1.4s).
- **Action buttons — 2 states:** both at rest (`SAVE` / `TRANSLATE`, white) → saved + translate active (`SAVED` solid slate w/ FILL-1 bookmark · `TRANSLATE` on `#f0eded`). 52px tall, split by a hairline.
- **Root-characters carousel — related-word states (now THREE):**
  | State | Toggle (30px circle) |
  |---|---|
  | **Saved** | filled `#202631` + white `check` |
  | **Known** | 1.5px `#202631` **ring** + slate `check` |
  | **Unsaved** | 1.5px `#c5c6cb` ring, empty |

  Cards are `#fefdfc`, 1px `#e4e2e2`, 4px radius, with a 54×54 Hanja tile + "MEANING", a hairline, then "RELATED WORDS" rows. **"See more ⌄" expands the card in place** (revealing more related words) and flips to **"See less ⌃"** — no navigation.

**4 · Assembled — Lookup Open (interactive).** A live 390×844 reader: tap **TRANSLATE** (definition → 950ms loading → translation), toggle **SAVE**, expand **See more**, and **swipe** the 86%-width scroll-snap carousel (next card peeks ~14%).

**5 · Settings Panel** (font settings, static mock — confirms reader content is user-configurable). Rows: **Font Size** (− `18` +), **Line Spacing** (− `Relaxed` +), **Brightness** (slider at 62%).

**6 · Edge Cases.** e.g. **minimal sheet** — a short native word with a one-line definition and no carousel. Derive other lengths from the same rules.

### B · OCR Overlay — `Fluent Fable OCR Overlay.dc.html`

A floating **system overlay** that OCRs Korean text rendered by *any* app behind it (a webpage, a PDF, a message) and boxes **every word** it detects. Launched from the `screenshot_region` icon on Home. **This is the only surface that uses color beyond the slate** — see the One Ink Rule exception.

**Detection layer.** Every detected word gets its own box; the gaps between boxes are the spaces. Word states:
| Class | State | Treatment |
|---|---|---|
| `.ff-w` | **Detected** | `rgba(61,79,114,0.13)` fill, inset 1.5px `#3d4f72` outline, 2px radius |
| `.ff-wp` | **Pressed** | solid `#3d4f72` fill, white text → opens the definition panel |
| `.ff-wr` | **Region selected** | `rgba(61,79,114,0.24)` fill, 4px radius — a drag across words **merges the gaps** into one selection → opens translation |
| — | **No text found** | "텍스트를 찾을 수 없습니다" (Inter 13px `#75777b`) |

**Floating circle.** The only dark chrome: 56px, `rgba(32,38,49,0.9)` + 1px `#353c47`, carrying the **FF cream monogram** (the app-icon glyph, stroke-only). Three states — **default**; **dragging** (`scale(1.08)`, deeper shadow); **over close** (re-themes to `#2d1a1a` body / `#C0392B` border). Drag it anywhere; drop on the close target to dismiss.

**Close target.** Appears bottom-center while dragging. **Default:** `rgba(27,28,28,0.82)`, 160×48, muted "✕ CLOSE". **Activated:** `rgba(192,57,43,0.92)`, 200×56, white label, **pulses** (`ffPulse`).

**The nine frames** (390×844, riding over a Korean web article):
1. **Overlay active** — boxes drawn over the article, circle at rest (bottom-right), home indicator.
2. **Definition open** — tapped word goes solid; a bottom **definition panel** rises (Sheet-Lift): headword bar w/ chevrons, "NOUN" + senses, the **same ROOT CHARACTERS carousel** as the reader, and a `SAVE` / `TRANSLATE` row.
3. **Definition · Translate active** — `TRANSLATE` tab highlighted (`#f0eded`), about to swap.
4. **Translation open** — a region selection yields a translation panel: `translate` glyph + "한국어 → English" + "COPY", then the English result.
5. **Translation loading** — the same panel with two `ffShimmer` skeleton bars.
6. **Dragging to close** — dimmed scrim (`rgba(27,28,28,0.04)`), circle mid-screen scaled, close pill (default) at bottom.
7. **Over close target** — close pill red + pulsing, circle re-themed red, overlapping it.
8. **No text detected** — an image-only surface (gallery), centered dark pill with `search_off` + "텍스트를 찾을 수 없습니다", circle at rest.
9. **Word not found** — tapped word, definition panel shows headword + romanization + "No definition found" + action row.

> The OCR definition/translation panels deliberately **reuse the reader's lookup-sheet system** (radius, Sheet-Lift shadow, headword bar, carousel, action row) so an OCR lookup and an in-app lookup are visually identical. Build them from one shared component.

### C · Component States — `Component States.dc.html`

A contact sheet — **the build reference for every interactive element.** Each card shows the full state range on the `#fbf9f8` canvas:

- **Primary button** — DEFAULT (slate `#202631`, white, 3px radius, tracked caps + optional trailing icon) · PRESSED (`#0e1014` + `inset 0 2px 5px rgba(0,0,0,0.45)` + 1px down) · DISABLED (`#e4e2e2` / `#b0b2b6`).
- **Secondary button** — DEFAULT (1px `#c5c6cb` outline, ink label) · PRESSED (fills `#ece9e9`, border `#b0b2b6`, 1px down) · DISABLED (1px `#e4e2e2` / `#c5c6cb`).
- **Mark-known toggle** (vocab row action) — INACTIVE ("MARK KNOWN", tracked caps with a hairline underline) · ACTIVE ("✓ KNOWN", ink + check).
- **Add-to-vocab circle** (root-character chip) — NOT ADDED (1.5px `#c5c6cb` ring + `add`) · ADDED (filled slate + white `check`).
- **Pills & chips** — ACTIVE/FILLED (slate, white) · INACTIVE/OUTLINE (1px `#c5c6cb`) · SOFT/STATUS (`#f0eded`, e.g. "waiting"). 999px radius.
- **Text tabs** — ACTIVE (Inter 700, ink, 2px slate underline) · INACTIVE (500, `#9a9c9f`, no underline).
- **Maturity meter** — 4 dots, five levels: 0 NOT SEEN → 1 SEEN → 2 LEARNING → 3 FAMILIAR → 4 KNOWN; filled dot = `#202631`, empty = 1px `#b0b2b6` ring.
- **Reader word tokens** — DEFAULT · TRACKED (dotted underline) · SELECTED (slate fill, white). (Mirrors the Reader Screen surface states.)
- **Bookmark toggle** — UNSAVED (outline + `bookmark` FILL 0, "SAVE") · SAVED (slate fill + `bookmark` FILL 1, "SAVED").
- **Reading progress** — 3px `#eceaea` track, slate fill, shown at 8% / 64% / 100%.
- **FAB** — DEFAULT (52px slate + FAB shadow) · PRESSED (`#0e1014` + inset shadow + 1px down).

Treat this sheet as canonical for every state's exact swatch, radius, and tracking.

### D · App Icon — `App Icon FF.dc.html`

The product mark: a **squircle** filled `#333B46` with a single **cream `#FAF8F5` continuous-stroke monogram** — an abstracted **open book / facing "FF"** (two page-curves meeting at a central spine, with two short crossbars), drawn with round caps and joins. No text in the icon.

- **Corner radius:** 230 on the 1024 grid (~22.5%) — i.e. 86px at a 384px render, 27px at 120, 14px at 64, 7px at 32. Scale the radius with the size (iOS-style superellipse).
- **Stroke weight:** 46 on the 1024 grid for the icon; the **same glyph is reused** (stroke-only, no plate) as the OCR floating-circle mark for brand continuity.
- **Provided sizes in the file:** 384 (hero), 120, 64, 32.
- **Production:** supply as vector and export the full iOS/Android icon set (incl. maskable/adaptive). Background fill `#333B46`; mark `#FAF8F5`.

---

## Interactions & Behavior

Full behavioral spec lives in `reference/FEATURES_AND_INTERACTIONS.md` — the existing app's interaction inventory. **All of it still applies; this reskin changes appearance, not flows.** Design-relevant behaviors:

- **Word lookup:** tap a word → its highlight goes solid slate → scrim fades in → lookup sheet slides up. Dismiss by drag-down on the handle, backdrop tap, or back. ~250–300ms ease-out slide + fade; reverse on dismiss.
- **Root-characters carousel:** the lookup sheet's Hanja section is a **horizontally swipeable** deck (one card per Hanja). Swiping advances page dots. Each related word toggles **unsaved (`#c5c6cb` ring) → known (slate ring + check) → saved (filled slate + check)** in place. **"See more" expands the card** to reveal the full related-word list (grow the card; don't navigate); it flips to "See less." Known marks persist and feed the same related-known-words store as the existing Hanja flow.
- **Translation:** long-press / text-select → same sheet pattern; **definition → loading (~950ms shimmer) → translation**, with loading / result / error (not-found) states.
- **Save word:** the SAVE/SAVED toggle and any bookmark control toggle saved state; saved words gain the persistent grey fill in the reader and the dotted underline wherever they appear in song/body text.
- **Screen OCR overlay:** launch from the Home `screenshot_region` icon → a floating circle appears over whatever's on screen. The overlay OCRs the frame and **boxes every detected word**. **Tap** a box → definition panel. **Drag across** boxes → gaps merge into a region → translation panel. **Drag the circle onto the bottom close target** (which turns red and pulses) → dismiss. Handle the **no-text-found** and **word-not-found** states. Reuse the reader's lookup-sheet component for the panels.
- **Writing editor (New Entry):** choose type → Diary/Essay reveal a prompt; enter title + body. **Autosave** runs continuously ("SAVING…" → "DRAFT SAVED"). The **vocabulary assist strip** suggests saved words; tapping a chip inserts it at the caret.
- **Font settings:** Font Size, Line Spacing, and Brightness are user-adjustable and re-flow the reader live; the shown values are defaults.
- **Pressed state (all pills/buttons):** slate → `#0e1014` + inset shadow + 1px down; outline → `#ece9e9` fill + 1px down. **Disabled:** `#e4e2e2`/`#c5c6cb`. No background-shift hover states.
- **Segmented tabs / filters:** the 2px slate underline (or active pill) moves to the tapped item; content swaps (~200ms ease).
- **Progress bars/fills:** animate width on change; never re-animate on every mount.
- **No gamification motion:** no confetti, bounces, or streak celebrations. Motion is calm — short fades and slides, the OCR close-target pulse, and the blinking text caret.

## State Management

Reuse the app's existing stores. The reskin touches presentation of: current book + progress %, library filter + segment, saved-vocab set (drives grey fills + dotted underlines), **lookup-sheet state incl. active morpheme/root-character index and per-related-word saved/known toggles**, **OCR-overlay state (circle position, detection results, panel mode, region selection)**, SRS card queue + stat counts, write entries + status, draft composer state, reader font/spacing/brightness preferences, completed-books shelf, auth/guest, and preference values. No new data requirements beyond what `FEATURES_AND_INTERACTIONS.md` describes.

## Assets

- **Fonts:** Inter, Fraunces (incl. italic), Noto Serif KR (400/500/600/700) — all Google Fonts; **bundle them** (don't load over network at runtime). Equivalent Noto Serif SC/TC for Chinese profiles.
- **Icons:** **Material Symbols Outlined** (variable font) at `FILL 0, wght 300, GRAD 0, opsz 24` at rest (some filled states use `FILL 1`). Glyphs used across the package: `expand_more`, `expand_less`, `screenshot_region`, `arrow_back`, `arrow_back_ios_new`, `more_horiz`, `chevron_left/right`, `east`, `add`, `cloud_download`, `star`, `download`, `edit`, `delete`, `settings`, `close`, `bookmark`, `bookmarks`, `check`, `menu_book`, `translate`, `spellcheck`, `format_quote`, `edit_square`, `menu`, `search_off`, `sticky_note_2`, `text_fields`, `ios_share`, `light_mode`. Map to the codebase's existing icon set if it isn't already on Material Symbols.
- **App icon:** the FF monogram — vector, `#333B46` plate / `#FAF8F5` mark. Export the full platform icon set.
- **No raster imagery.** All book covers are **typographic tonal tiles** — no cover art in this design. The grey hatch placeholders in the OCR frames represent third-party app content behind the overlay, not Fluent Fable UI.

## Files

```
design_handoff_fluent_fable_kindle/
├── README.md                                  ← this file
├── design/
│   ├── Fluent Fable Kindle Final.dc.html      ← master mock · 11 screens + states
│   ├── Fluent Fable Reader Screen.dc.html     ← reader + lookup, state-by-state
│   ├── Fluent Fable OCR Overlay.dc.html       ← screen-OCR floating overlay · 9 frames
│   ├── Component States.dc.html               ← every component's state range
│   ├── App Icon FF.dc.html                    ← app icon (FF monogram) at multiple sizes
│   └── support.js                             ← runtime needed by the HTML files (NOT for production)
├── reference/
│   └── FEATURES_AND_INTERACTIONS.md           ← complete app feature & interaction inventory (behavior; aesthetic-agnostic)
└── visuals/                                   ← rendered PNG of each master screen (390×844)
    ├── 01-home-library.png
    ├── 02-book-preview.png
    ├── 03-reader-lookup-root-characters.png
    ├── 04-song-reader.png
    ├── 05-new-song.png
    ├── 06-vocabulary.png
    ├── 07-word-detail.png
    ├── 08-flashcard.png
    ├── 09-write-archive.png
    ├── 10-write-new-entry.png
    └── 11-profile.png
```
