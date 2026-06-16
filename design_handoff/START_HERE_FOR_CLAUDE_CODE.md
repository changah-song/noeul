# START HERE — Claude Code kickoff (Fluent Fable "Slate & Stone" reskin)

Read this first, then `README.md` for the full spec.

## The situation (read this — it changes the job)

This is **not** a greenfield build. The Fluent Fable app **already exists** as a React Native / Expo
codebase, and its design system **already matches these mocks**. Your job is **reconciliation, not
recreation**: bring each existing screen up to the fidelity of the mocks, reusing what's already there.

Two facts that make this accurate and fast:

1. **The design tokens are already ported.** `frontend/theme/tokens.js` already encodes this exact
   "Slate & Stone" system — same hex (`inkSlate #202631`, `bgPage #fbf9f8`, `ocrNavy #3d4f72`, …),
   same radii, the Sheet-Lift / FAB / Cover-Lift shadows in `elevation`, and the layout constants in
   `layout` (tab bar 64, FAB 52, reader header 56, cover 172×244, etc).
2. **The screens already exist** and map almost 1:1 to the mocks.

## Design authority — the mocks win (read this carefully)

The design in `design/` is **authoritative for all appearance**. Existing code is authoritative only for
**logic, data, navigation, and i18n** — never for how things look. Where they conflict on appearance,
**change the code to match the mock, never the reverse.** "Reconcile, don't rewrite" applies to *behavior*;
it does **not** mean "keep the old styling."

To guarantee existing code can never override the design:

- **Single source of truth.** All styling must come from `frontend/theme/` (`tokens.js`, `typography.js`,
  `spacing.js`) — and those files are defined *by these mocks*. **Never write a literal color, size,
  radius, or shadow in a screen or component.** If a value a mock needs isn't in the theme yet, add it
  there (matching the mock exactly), then import it. Consider a lint rule banning hex literals outside
  `theme/`.
- **No second source of truth.** Delete `legacySpacing` from `spacing.js` (it's currently referenced
  nowhere) and remove any other pre-reskin / "Annotated Page" (terra-cotta / DM Sans) values if they ever
  surface, so they can't be imported by mistake. There must be exactly one token set, and it must match
  the mocks.
- **Audit before you build.** Diff the current `theme/*` values against the README token tables and the
  `.dc.html` files. Fix any mismatch **in the theme**, not by overriding in a screen. (At handoff time the
  tokens already matched — keep it that way.)
- **Acceptance gate.** A screen is "done" only when it matches its `visuals/*.png`. If the result doesn't
  match, the code is wrong — fix the code, never soften the design to fit existing styling.

## Hard rules (these are what make it accurate)

- **Import from `frontend/theme/tokens.js`. Never hardcode a hex value, radius, shadow, or size.**
  If a value in a mock isn't in `tokens.js` yet, add it there as a named token, then use it. This is
  the single most important rule — the tokens already match, so reusing them keeps everything pixel-exact
  and consistent.
- **The `.dc.html` files in `design/` are the source of truth.** Every style is inline — open them and
  read exact values directly. Where the README and the HTML disagree, **the HTML wins.** Where two design
  files disagree, the more specific file wins for its subject.
- **Reconcile, don't rewrite.** Edit the existing screens/components in place. Keep current navigation,
  state, data, and i18n wiring. This reskin changes **appearance, not flows**.
- **Work one screen at a time.** Finish and verify a screen before starting the next.
- **Verify against `visuals/*.png`.** After each screen, diff your result against the matching numbered
  render — not against memory.

## Screen → file map

| Mock (in `design/`) | Visual | Implement in |
|---|---|---|
| Home / Library, Book Preview (screens 1–2) | `visuals/01`, `02` | `frontend/screens/Home.js` (+ `components/Home`) |
| Reader + dictionary lookup (screen 3) — **authoritative: `Fluent Fable Reader Screen.dc.html`** | `visuals/03` | `frontend/screens/Read.js` (+ `components/Read`) |
| Song Reader, New Song composer (screens 4–5) | `visuals/04`, `05` | `Read.js` / `components/Songs` |
| Vocabulary, Word Detail, Flashcard (screens 6–8) | `visuals/06`, `07`, `08` | `frontend/screens/Learn.js` (+ `components/Learn`) |
| Write Archive, New Entry (screens 9–10) | `visuals/09`, `10` | `frontend/screens/Write.js` |
| Profile (screen 11) | `visuals/11` | `frontend/screens/Profile.js` |
| Auth states | — | `frontend/screens/Auth.js` (+ `components/Auth`) |
| Screen-OCR overlay — **`Fluent Fable OCR Overlay.dc.html`** | — | `frontend/screens/ScreenshotOcr.js` |

## Reference files, in priority order

1. **`design/*.dc.html`** — exact look & states (source of truth).
2. **`design/Component States.dc.html`** — canonical swatches for every pressed / disabled / active /
   inactive state. Use it instead of guessing interaction states.
3. **`README.md`** — tokens, per-screen layout, behaviors, assets (the map).
4. **`reference/FEATURES_AND_INTERACTIONS.md`** — behavior/flows (aesthetic-agnostic; still applies).
5. **`visuals/*.png`** — rendered targets to diff against.

## Build the lookup sheet once

The **dictionary lookup sheet** (grabber → headword bar with morpheme chevrons → definition/loading/
translate area → **ROOT CHARACTERS carousel** → SAVE / TRANSLATE action row) appears **identically** in
the Reader, the Song Reader, and the OCR overlay. Build it as **one shared component** and mount it in all
three — don't fork it three ways. The Reader Screen file is its authoritative spec.

## Don't ship the showcase scaffolding

The mocks are presentation files. **Do not** port: the grey backdrop, the phone bezel/drop-shadow, the
state-toggle chips above the phones (e.g. `CURRENT READING: IN PROGRESS / EMPTY / FINISHED`), the on-screen
Korean keyboard, or the hardcoded `9:41` status bar. Those exist to show every state from one file — wire
the underlying states to the app's real data/events, and use the platform status bar + keyboard.

## Suggested order

1. Skim `README.md` + this file. Open `tokens.js` and confirm the token names you'll reference.
2. Reader (`Read.js`) first — it's the heart of the app and defines the shared lookup sheet. Build the
   sheet as a shared component here.
3. Home → Learn → Write → Profile → Auth.
4. OCR overlay last (it reuses the lookup sheet).
5. App icon: export the FF monogram (`design/App Icon FF.dc.html`) to the full iOS/Android icon set.

After each screen: import-only-from-tokens check, then diff against the matching `visuals/*.png`.
