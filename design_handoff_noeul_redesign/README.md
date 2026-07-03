# Handoff: Noeul (노을) — Korean reading-app redesign

## Overview
Noeul is a Korean-language **extensive-reading** app: users read public-domain
Korean literature and study vocabulary as they go. This package is the visual
and interaction spec for redesigning an **existing** app to match the "Sunset &
Paper" direction — a warm, literary, glass-over-gradient aesthetic with a light
("day") and dark ("dusk") theme sharing one coral/rose/amber accent trio.

The design covers ten screens: Home, Reader, Library, Writing Logs, Writing
Canvas, Flashcards, Vocab List, Vocab Detail, and a Profile/Config center, plus
the tap-to-define lookup sheet and reader settings sheet.

## About the design files
The files in this bundle are **design references built in HTML/CSS/JS** —
prototypes that show the intended look and behavior. They are **not** production
code to copy verbatim. Your task is to **recreate these designs inside the
existing app's environment** (whatever it is — React/React Native, SwiftUI,
Flutter, Vue, etc.), using that codebase's established components, navigation,
state, and data layer. If the app has no established UI environment yet, pick
the most appropriate framework for the platform and implement the designs there.

Treat the exact colors, typography, spacing, radii, and shadows as
authoritative — those are captured as real design tokens (see below). Treat the
prototype's hard-coded content (the Korean story text, the dictionary entries,
the sample vocab) as **placeholder data**; wire the real content and data
sources from the existing app.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, shadows, and
interaction states are all specified. Recreate the UI pixel-accurately using the
codebase's own libraries. The one caveat: the prototype is framed inside a 390×844
iOS device mock — that frame (`.device`, notch, status bar, home indicator) is
scaffolding for the preview only; do not reproduce it. Build the screen contents
to fill the app's real viewport.

## Design tokens
All tokens live in `design-system/tokens/` and are the single source of truth.
`design-system/styles.css` `@import`s the four files below. Everything themeable
is a CSS custom property; the light theme is canonical and
`[data-theme="dusk"]` overrides it for dark mode. Port these to the target
platform's token system (Tailwind config, a theme object, SwiftUI Color set,
etc.).

### Color — `tokens/colors.css`
The palette is "Sunset & Paper." Key values (light / dusk):

- Accent trio — coral `--accent` `#E0654A` / `#FF7A52`; rose `--accent-2`
  `#D85C76` / `#F1789A`; amber `--accent-3` `#EE9A4C` / `#F4B25C`; pressed
  `--accent-pressed` `#C9506A` / `#F1789A`.
- Ink — `--text` `#2B2433` / `#F6EAE3`, then `--text-secondary`, `--text-muted`,
  `--text-tertiary`, `--text-subtle` stepping lighter.
- Surfaces are **frosted glass over a gradient sky**: `--surface-glass`
  `rgba(255,255,255,0.55)` (dusk `rgba(255,255,255,0.08)`) with a
  `--surface-glass-border` hairline and `--glass-blur: 18px`
  (`backdrop-filter: blur(18px)`).
- Page background is a multi-stop `--gradient-page` (two radial warm glows over a
  vertical peach→sand gradient in light; plum→coral glow over near-black in dusk).
- Signature gradients: `--gradient-accent` (coral→rose, buttons/CTAs/FABs),
  `--gradient-progress` (amber→rose), `--gradient-sunset` (the brand mark),
  `--gradient-cover` (default book cover).
- Status: `--success` `#1F8A5B`, `--warning` `#C77A2E`, `--danger` `#C0362C`.
- A full **reader surface subsystem** (`--reader-*`): frosted paper, hairlines,
  and the three "level" colors used to signal word difficulty — `same` = amber,
  `above` = coral, `unknown` = rose.

### Typography — `tokens/typography.css` + `tokens/fonts.css`
Three families, all Google Fonts:
- `--font-display` — **Fraunces** (serif) — titles, book covers, quotes.
- `--font-ui` — **Inter** — body, labels, controls.
- `--font-kr` — **Noto Serif KR** — all Korean/target-language text.

Type scale (px, with paired line-heights): hero 28/34, title 24/30, section
19/24, body-lg 17/24, body 14/20, body-sm 13/18, caption 11/15, micro 10/13.
Weights 400/500/600/700. Eyebrows and labels are uppercase with wide tracking
(`--tracking-eyebrow: 2px`, `--tracking-label: 1.6px`, app-bar title `3.2px`).
Semantic roles `.nl-hero`, `.nl-title`, `.nl-section-title`, `.nl-body`,
`.nl-eyebrow`, `.nl-label`, `.nl-kr` are defined — mirror these as text styles.

### Spacing, radii, shadows, motion — `tokens/spacing.css`
- Spacing scale: xxs 4, xs 7, sm 11, md 15, lg 19, xl 24, xxl 30, xxxl 40.
- Screen insets: 20px horizontal, 18 top, 26 bottom.
- Radii: xs 8, sm 11, md 14 (buttons), lg 20 (glass cards — the default),
  xl 28 (sheets/hero), pill 999.
- Shadows are luminous and sunset-tinted: `--shadow-glass` `0 10px 30px
  rgba(80,30,30,0.10)`, `--shadow-soft`, `--shadow-cover`, `--shadow-accent`
  `0 8px 18px rgba(224,101,74,0.40)` (glow under accent buttons/FABs).
- Motion: `--ease: cubic-bezier(0.4,0,0.2,1)`, `--dur-fast: 150ms`,
  `--dur-sheet: 275ms`, `--dur-tab: 200ms`, pressed opacity 0.82.
- Layout constants: appbar 52, reader header 56, FAB 52, tab bar 64,
  screen max-width 560, book-cover aspect 0.6667 (2:3).

## Component library
`design-system/component-reference.md` documents every reusable piece — usage
notes, typed API, and a reference implementation each. Adapt these to the
codebase's component conventions rather than importing them directly. Groups:
- **core** — Button, Card (glass), Badge, ProgressBar, StatChip.
- **forms** — Input, Switch (the pill toggle used throughout settings).
- **navigation** — TabBar (bottom, 64px), SectionHeader.
- **reading** — BookCover (2:3, gradient/image), WordChip (the tappable reader token).

## Screens / views
The prototype router is a simple `go('screen-<id>')` that toggles a `.active`
class with a 260ms slide-up (`screenIn`). Recreate as real navigation. Each
`<section class="screen" data-screen-label="…">` is one screen.

### Home (`#screen-home`)
- **Purpose:** launch point — resume reading, jump to practice, enter library.
- **Layout:** scrolling column, 20px insets. Hero greeting, a "continue reading"
  glass card with book cover + progress, a **"Enter library"** press row (text +
  arrow on the left, a circular glass **scan-a-page** button on the right —
  note this order, it was set intentionally), then a "Practice" section of
  entry cards (writing, flashcards, vocab).

### Reader (`#screen-reader`)
- **Purpose:** the core extensive-reading surface.
- **Layout:** slim header (56px) with back, chapter title, TOC, and settings
  (gear) buttons over a hairline; a frosted `--reader-paper` body; a progress
  bar; a paged story.
- **The reading model — critical:** body text is split into **tokens** (`.tok`,
  one per eojeol/word) interleaved with **dimmed grammatical particles**
  (`.dim`). Each token carries a difficulty **level** class — `same` (amber),
  `above` (coral), `unknown` (rose) — surfaced as a soft **heat-map**
  background/glow (`.heat-on`), NOT underlines. Tapping a token opens the lookup
  sheet. (There was previously a "hanja ruby" annotation rendered above words;
  it has been removed — do not reintroduce ruby annotations in the reader body.)
- **Reader settings sheet:** bottom sheet with font-size stepper (15–24px),
  line-spacing stepper, a dark-mode toggle, a heat-map toggle, and a
  "Root-word analysis" toggle (pops through to hanja morphemes inside lookups).

### Lookup sheet (tap-to-define, inside Reader)
- Bottom sheet keyed off a `DICT` map. Shows the word (Noto Serif KR),
  romanization, POS, a Korean-dictionary gloss, a contextual gloss, a
  translate toggle, the source sentence, and a save action. A "not found"
  variant handles words with no entry.

### Library (`#screen-library`)
- Grid/list of book covers (2:3, `--gradient-cover` or image) with title,
  author, and a progress ring/bar. "Bring your own EPUB" affordance.

### Writing Logs (`#screen-write-logs`)
- List of past writing entries (date, prompt, excerpt) leading into the canvas.

### Writing Canvas (`#screen-write-canvas`)
- Full-height composition surface with a top bar (back + save/done). Prompt at
  top, free-writing area below.

### Flashcards (`#screen-flashcards`)
- SRS review. A center **flip card** (`flipCard()` toggles `.flipped`) — front:
  Korean word; back: hanja (if any), romanization, definition. Progress bar
  across a 24-card deck; next/prev advance and reset the flip.

### Vocab List (`#screen-vocab`)
- Tabbed list (all / starred / by level) of saved words with stats header.
  Rows open Vocab Detail.

### Vocab Detail (`#screen-vocab-detail`)
- Large word, hanja, romanization; definition + context; a **"related by
  hanja"** card that pages through words sharing a hanja morpheme
  (`hanjaNav(±1)`, expandable via `toggleHanjaMore()`); a star toggle and a
  "mark known" action.

### Profile / Config (`#screen-profile`)
- Settings center: profile summary, an **Appearance** theme picker
  (light / dusk, `setTheme(name)` sets `data-theme` on the root), and toggle
  rows for various preferences (the pill `.rtoggle` / Switch component).

## Interactions & behavior
- **Navigation:** `go(id)` swaps screens with a 260ms `cubic-bezier(.4,0,.2,1)`
  slide-up. Recreate as native/router transitions.
- **Theme:** `setTheme('light'|'dusk')` toggles the root `data-theme`; every
  color flows from tokens so no per-component work is needed. Persist the choice.
- **Press feedback:** `.press` scales to 0.97 and drops to 0.9 opacity on active
  over 120ms — apply to all tappable elements.
- **Bottom sheets** (lookup, TOC, reader settings): scrim + sheet both get a
  `.show` class; slide up over ~275ms.
- **Reader:** tap token → lookup; gear → settings sheet; font/space steppers
  clamp (font 15–24); heat-map and morph toggles flip classes.
- **Flashcards:** tap card to flip; next/prev reset flip and advance the deck
  progress bar.
- **Persistence:** the prototype keeps most state in memory. In the real app,
  reading position, saved vocab, SRS state, theme, and reader-type prefs should
  persist.

## State (what the real app needs)
- Current book + chapter + scroll/paging position (persisted).
- Per-word difficulty level and known/saved status (drives the heat-map).
- Saved-vocab collection with star + SRS scheduling for flashcards.
- Theme (`light`/`dusk`) and reader type prefs (font size, line spacing,
  heat-map on/off, root-word analysis on/off).
- Dictionary lookups — the prototype hard-codes a `DICT`; wire the real
  dictionary + contextual gloss source.

## Assets
- **Fonts:** Fraunces, Inter, Noto Serif KR (Google Fonts — see
  `tokens/fonts.css`). The existing app bundles these as FFDisplay / FFSans /
  FFSerif respectively; use the app's bundled faces on native.
- **Icons:** the prototype uses **Lucide** (`scan-line`, `arrow-right`, `star`,
  gear, chevrons, etc.). Map to the app's existing icon set.
- **Imagery:** book covers use gradient fields (`--gradient-cover`) or cover
  images; no proprietary art is included here.

## Screenshots
`screenshots/light/` and `screenshots/dusk/` hold a rendered capture of every
screen in both themes (numbered 1–9): 1 home, 2 reader, 3 library,
4 writing-logs, 5 writing-canvas, 6 flashcards, 7 vocab-list, 8 vocab-detail,
9 profile. Compare the two folders side by side to see the light/dusk treatment
of the same layout. (Captures include the 390×844 iOS device frame used by the
prototype mock — ignore the frame/notch; build to the app's real viewport.)

## Files in this bundle
- `prototype/Noeul Prototype.html` — the full interactive prototype (all screens,
  all interactions). Open in a browser to explore; toggle the theme from the
  Profile screen.
- `design-system/styles.css` — token entry point (`@import`s the four token files).
- `design-system/tokens/{colors,typography,spacing,fonts}.css` — the tokens.
- `design-system/component-reference.md` — every component's usage notes, typed
  API, and reference implementation, grouped by category.

## Suggested approach for Claude Code
1. Port the tokens first (colors, type, spacing, radii, shadows, motion) into
   the app's theme system, with the light/dusk split.
2. Build/adapt the shared components (Button, glass Card, Switch, TabBar,
   BookCover, WordChip, ProgressBar) against those tokens.
3. Rebuild screens one at a time against the existing data/nav layer, starting
   with Home → Reader → Lookup (the core loop), then Library, Vocab, Flashcards,
   Writing, and Profile.
4. Verify both themes and all interaction states against the prototype.
