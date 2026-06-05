# Handoff: "Stacks" default book cover

## Overview
A **generative default cover** for public-domain books that have no artwork. Given only a book's **title** and **author**, it renders a minimalist geometric cover: the title + author set in serif, with a column of ascending bars as the graphic motif. A hash of `title + author` deterministically selects one of 8 cozy palettes, so:
- every book gets a cover automatically (no manual design),
- the same book **always** renders the same cover (stable across sessions/devices),
- covers across a shelf feel like one coherent series.

This is the chosen style (#8 of 8 explored). It belongs to the **Fluent Fable** Korean‑reading app; titles are typically Korean and use the app's serif (Noto Serif KR).

## About these files
These are **design references** built in HTML/React with inline styles for clarity — **not production code to paste in directly.** Recreate the design in the target codebase's environment (React Native, SwiftUI, Flutter, React/CSS, an SVG generator, etc.) using its own patterns. Port the **tokens, geometry, type rules, and the hashing rule** documented below.

## Fidelity
**High‑fidelity.** Colors, proportions, type sizing, and the bar rhythm are final. Reproduce exactly.

## Files
| File | Purpose |
|---|---|
| `Stacks Cover - Reference.html` | Open this — live render of the cover across 8 sample books. |
| `covers-stacks.jsx` | The reference implementation (palettes, hash, sizing, cover component). |
| `README.md` | This spec. |

---

## The generative rule (the important part)

1. **Hash** the string `title + author` with a stable 32‑bit hash:
   ```
   hashStr(s): h = 0; for each char c: h = (h*31 + code(c)) >>> 0; return h
   ```
   Must be deterministic and identical on every platform (use unsigned 32‑bit math).

2. **Palette** = `CPAL[ hashStr(title+author) % 8 ]`. Eight palettes, each `{ bg, accent, ink }`:

   | # | bg (cover field) | accent (bars) | ink (text) | mood |
   |---|---|---|---|---|
   | 0 | `#e7ddc8` | `#bf5b3e` | `#2f2820` | cream / terracotta |
   | 1 | `#dde4d6` | `#5f7a4a` | `#27331f` | sage |
   | 2 | `#d7dfe7` | `#3f6184` | `#1f2a35` | slate blue |
   | 3 | `#ece1c8` | `#c0902f` | `#3a2f17` | mustard |
   | 4 | `#e9d9d6` | `#9c4a52` | `#3a1f22` | rose / maroon |
   | 5 | `#dcd6e2` | `#6a5495` | `#2a2235` | plum |
   | 6 | `#d9e1dd` | `#2f7d6b` | `#16332c` | teal |
   | 7 | `#e7ded2` | `#8a6741` | `#322517` | umber |

3. **Render** the cover with that palette (geometry below). No other randomness — the bar widths are fixed for everyone so the motif stays recognizable.

---

## Layout spec (reference size 200 × 298 px, ratio ≈ 2:3)

All values are at the 200px‑wide reference; **scale proportionally** for other sizes (e.g. ×2 for a 400px render, or use relative units).

**Frame**
- Size 200 × 298, `background: bg`, `border-radius: 4`, `overflow: hidden`.
- Drop shadow `0 1px 2px rgba(0,0,0,0.12)`.
- Faint spine: a 7px‑wide strip on the **left edge**, full height, `linear-gradient(90deg, rgba(0,0,0,0.10), rgba(0,0,0,0))`, non‑interactive, above the field.

**Title + author block** — anchored top‑left:
- Position: `top: 24`, `left: 20`, `right: 20`.
- **Title**: serif (Noto Serif KR), weight 600, color `ink`, `line-height: 1.28`, `word-break: keep-all` (don't split Korean words mid‑token).
  - Font size by glyph count (spaces excluded), base = 26:
    - ≤3 glyphs → 26px · ≤5 → 21px (×0.8) · ≤7 → 17px (×0.66) · else → 14px (×0.54).
- **Author**: sans (DM Sans), 12px, color `ink` at **0.7 opacity**, `margin-top: 7`.

**Bars (the motif)** — anchored bottom‑left:
- Container: `left: 20`, `bottom: 26`, vertical stack, `gap: 7`.
- **5 bars**, widths in order **`[40, 64, 52, 80, 30]` px**, each `height: 7`, `border-radius: 4`, `background: accent`.
- Opacity ramps per bar: `0.55 + index * 0.1` → `0.55, 0.65, 0.75, 0.85, 0.95` top→bottom.

That's the entire composition: warm field, top‑left type, bottom‑left ascending bars.

---

## Type & assets
- **Fonts:** Noto Serif KR (title), DM Sans (author). Self‑host or use platform equivalents. Keep the title serif so generated covers sit naturally next to real cover art.
- **No raster assets.** Everything is solid fills + rounded rectangles; trivially reproducible as CSS/SVG/native shapes. An SVG generator is a great fit if you want covers as cacheable images.
- **Long titles:** the size ramp handles up to ~8 glyphs gracefully; for very long titles, allow 2–3 lines (the block has room) or clamp.

## Integration notes (Fluent Fable)
Use this anywhere a book lacks a cover:
- **Home → My library** grid cells (full‑width cover, ~170px tall): render at that size by scaling the 2:3 spec.
- **Continue / list rows**: small thumbnail (e.g. 46×62) — the bars + title still read; drop the author if space is tight.
- **Profile bookshelf spines** are a *different* (spine‑on) treatment and do **not** use this cover; keep them as‑is.

## Reference implementation
See `covers-stacks.jsx` — `CoverStacks({ book })` plus the `CPAL`, `hashStr`, `palFor`, and `titleSize` helpers. It matches this spec exactly; treat the JSX as pseudo‑code for your platform.
