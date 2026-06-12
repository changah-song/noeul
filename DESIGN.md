---
name: Fluent Fable
description: A focused reading companion for language learners — depth on demand, never imposed.
colors:
  accent: "#b8552e"
  accent-soft: "#f5e8e2"
  background-warm: "#f5f4f0"
  surface: "#fcfbf7"
  surface-muted: "#f0ece4"
  surface-elevated: "#ffffff"
  surface-strong: "#e7dfd1"
  border: "#ddd5c8"
  text: "#1a1a1a"
  text-muted: "#6f675d"
  text-subtle: "#978e81"
  success: "#2f7d4c"
  warning: "#b57618"
  danger: "#b64f44"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: 30
    fontWeight: "700"
    lineHeight: 38
    letterSpacing: 0.1
  title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: 24
    fontWeight: "500"
    lineHeight: 30
  section-title:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: 20
    fontWeight: "700"
    lineHeight: 26
    letterSpacing: 0.1
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: 15
    fontWeight: "400"
    lineHeight: 22
  label:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: 13
    fontWeight: "500"
    lineHeight: 18
    letterSpacing: 0.2
  caption:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: 12
    fontWeight: "500"
    lineHeight: 16
    letterSpacing: 0.2
  eyebrow:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: 11
    fontWeight: "700"
    lineHeight: 14
    letterSpacing: 0.8
rounded:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "22px"
  xl: "30px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
  xxxl: "40px"
components:
  card-elevated:
    backgroundColor: "{colors.surface-elevated}"
    rounded: "{rounded.lg}"
    padding: "20px"
  card-muted:
    backgroundColor: "{colors.surface-muted}"
    rounded: "{rounded.lg}"
    padding: "20px"
  card-strong:
    backgroundColor: "{colors.surface-strong}"
    rounded: "{rounded.lg}"
    padding: "20px"
  icon-button-neutral:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "12px 16px"
  icon-button-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "12px 16px"
  stat-chip-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  stat-chip-neutral:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
---

# Design System: Fluent Fable

## 1. Overview

**Creative North Star: "The Annotated Page"**

Fluent Fable is the experience of reading a beloved book with a knowledgeable friend nearby — someone who can instantly surface a word's etymology, break apart a character into its radicals, or translate a tricky sentence, then vanish so you can keep reading. The design carries this idea into every decision: the text is primary, the tooling is secondary, and depth arrives only when summoned.

The visual language is warm but precise. Not the warm of a café (soft, unfocused, inviting drift) but the warm of a reading lamp on a clear desk: contained heat, clear shadow edges, a surface that has been chosen and arranged. Surfaces layer in tone — from the warm neutral page to subtly tinted containers to crisp elevated cards — without resorting to heavy shadow or decorative flourish. The palette's terra cotta accent is the only moment of color saturation; it carries the weight of interactive elements the way a red pencil marks a manuscript.

This system explicitly rejects: the gamified reward loops of Duolingo and Quizlet (no streaks, badges, confetti, or cartoon characters), the clinical monotony of Anki (no default-gray grids that feel like homework), and the anonymous warmth of Kindle's sepia default (which has a point of view but not a voice).

**Key Characteristics:**
- Text-first hierarchy — UI chrome pulls back, content leads
- Depth on demand — rich information layers surface only when the user asks
- Warm neutrals grounded by a single terra cotta accent, not a spectrum of color
- Earned elevation — shadows appear in response to state, not as ambient decoration
- Bilingual typographic capability — Fraunces + DM Sans for Latin scripts; Noto Serif KR for Korean

## 2. Colors: The Annotated Palette

A restrained neutral ground with one committed accent. The palette reads as warm paper and terra cotta ink — the colors of marginalia, not marketing.

### Primary
- **Terra Cotta Ink** (`#b8552e`): The single accent color. Applied to active navigation states, interactive highlights, and call-to-action elements. Used sparingly — its rarity is its authority. No gradients, no soft glows; the color appears as a clean, opaque mark.
- **Terra Cotta Soft** (`#f5e8e2`): Tinted wash for accent-toned chips, icon button backgrounds, and selection states. Never the background of an entire screen.

### Neutral
- **Warm Page** (`#f5f4f0`): Primary screen background. The paper the reader sits on. Warm enough to feel intentional, neutral enough to disappear.
- **Clean Surface** (`#fcfbf7`): The lighter card surface. Used for elevated content containers (book tiles, expanded panels) that need to read as slightly lifted from the background.
- **Muted Parchment** (`#f0ece4`): For inset containers — definition panels, vocabulary chips, secondary list items. One tone darker than the page.
- **Strong Ground** (`#e7dfd1`): The deepest neutral surface. Used for selected/active states on containers and pressed states.
- **Ruled Line** (`#ddd5c8`): All borders and dividers. Quiet enough to structure without separating.
- **Deep Ink** (`#1a1a1a`): Primary text. Near-black, not pure black — the difference between a printed page and a screen.
- **Muted Ink** (`#6f675d`): Secondary text — labels, metadata, supporting information.
- **Subtle Ink** (`#978e81`): Tertiary text — placeholders, inactive states, eyebrow labels.

### Status
- **Grove Green** (`#2f7d4c`): Correct answers, saved words, success states.
- **Amber Warning** (`#b57618`): Informational warnings, near-due flashcard prompts.
- **Faded Brick** (`#b64f44`): Error states, missed answers. Close in hue to the accent but desaturated — wrong answers feel related to the reading context, not alarming.

### Named Rules
**The One Accent Rule.** Terra Cotta (`#b8552e`) is the only saturated hue in the system. It appears on interactive elements and active states only. If you're reaching for a second accent color, you're adding complexity the reader doesn't need.

**The Warm-Not-Generic Rule.** The neutral ground is warm because books are warm, not because "warm feels premium." Do not extend this warmth to decorative gradient overlays or tinted backgrounds behind hero text.

## 3. Typography

**Display / Serif Font:** Fraunces (with Georgia, serif fallback)
**Body / UI Font:** DM Sans (with system-ui, sans-serif fallback)
**Korean Serif:** Noto Serif KR (with serif fallback; Korean text in reading mode)

**Character:** Fraunces is an optically-variable serif with strong calligraphic presence — it reads as literary without tipping into costume. DM Sans is clean and humanist, comfortable at small sizes and in UI contexts. Together they pair on the serif-meets-humanist-sans axis, not the geometric-meets-geometric axis that produces anonymous "modern" UIs. Korean text in reading mode uses Noto Serif KR, which carries the same editorial seriousness as Fraunces in Latin contexts.

### Hierarchy
- **Display** (Fraunces Bold, 30pt, leading 38): Screen headings, book titles on the Home shelf. The reader's first orientation.
- **Title** (Fraunces Medium, 24pt, leading 30): Section headings, modal titles, flashcard prompts.
- **Section Title** (DM Sans Bold, 20pt, leading 26): List group headers, sheet panel headings. Sans at a larger size reads as a category label, not a literary moment.
- **Body** (DM Sans Regular, 15pt, leading 22): All UI body text — descriptions, labels, definition prose. Do not use body type in the ebook reader itself; that font and size is user-configurable.
- **Label** (DM Sans Medium, 13pt, leading 18): Buttons, chips, tab labels, metadata pairs. Medium weight distinguishes labels from body without requiring color.
- **Caption** (DM Sans Medium, 12pt, leading 16): Secondary metadata — page counts, timestamps, stat chip sub-labels.
- **Eyebrow** (DM Sans Bold, 11pt, leading 14, +0.8 tracking, UPPERCASE): Used sparingly. Section dividers where the uppercase distinguishes structural sections from content. Maximum one eyebrow per screen section.

### Named Rules
**The Serif-for-Content Rule.** Fraunces is for content hierarchy (titles, headings) and reader-facing moments. DM Sans carries all functional UI. The two fonts do not appear in the same visual role on the same screen.

**The Reader Font Rule.** Font choice and size in the ebook reading view is user-controlled (it is their reading experience). Design system typography governs the UI shell, not the page content.

## 4. Elevation

This system is flat by default. Surfaces are layered through tonal stepping — background → surface → surface-elevated — not through ambient shadow. Shadows are earned: they appear as a state response (hover, drag, sheet presentation) rather than as constant ambient decoration.

### Shadow Vocabulary
- **Card Lift** (`shadowColor: rgba(41, 28, 14, 0.08), offset: (0, 10), radius: 24`): Applied to elevated card containers — book tiles, content cards — when they need to read as interactive or raised above the baseline. Not applied at rest in list contexts.
- **Subtle Lift** (`shadowColor: rgba(41, 28, 14, 0.08), offset: (0, 4), radius: 12`): Applied to modal sheet handles, floating action buttons, and lightweight overlay surfaces. Lower visual impact; used when a card lift would feel too heavy.

### Named Rules
**The Flat-First Rule.** A surface has no shadow at rest. Shadow is a response to state (pressed, elevated, presented). If you're adding a shadow to make something "feel like a card," use tonal background stepping instead.

## 5. Components

### Cards
Three tones, one shape: `radii.lg` (22px) corner radius, 1px border, 20px internal padding. The border is `colors.border` (`#ddd5c8`) on elevated cards; transparent on muted and strong.

- **Elevated** (`#ffffff` surface, `#ddd5c8` border, card-lift shadow): For primary content containers — book tiles, featured items. Only elevated cards carry the card shadow.
- **Muted** (`#f0ece4` surface, no border, no shadow): For inset secondary content — definition panels, expandable detail sections.
- **Strong** (`#e7dfd1` surface, no border, no shadow): For selected or active container states. The deepest neutral in the card family.

**Never nest elevated cards.** Muted or strong cards may sit inside an elevated container; elevated cards do not nest.

### Icon Buttons
Pill shape (`radii.pill`, 999px), 1px border, 12px vertical × 16px horizontal padding. Icon and text label arranged in a horizontal row, 8px gap.

- **Neutral** (`#fcfbf7` surface, `#ddd5c8` border): Default state. Use for non-primary actions (share, filter, edit).
- **Accent** (`#f5e8e2` background, no border): Selected or contextually active state. The soft terra cotta wash signals "this relates to the primary interaction."
- **Pressed state:** `opacity: 0.82` across all tones. No background color shift; opacity keeps the press response consistent without adding new color states.
- **Disabled state:** `opacity: 0.5`.

### Stat Chips
`radii.md` (16px) radius, 1px border, 12px vertical × 16px horizontal padding. Display a numeric value above a text label.

- **Accent tone** (`#f5e8e2` background, no border): Highlighted stats — streak-equivalent metrics, primary vocabulary counts.
- **Neutral tone** (`#fcfbf7` background, `#ddd5c8` border): Secondary stats.
- **Muted tone** (`#f0ece4` background, no border): De-emphasized or background stats.

### Navigation (Tab Bar)
Height: 72px. Background: `#faf6ee` (near-surface warm). Top border: 1px `#e4dac6`. No elevation shadow — the tab bar is part of the page floor, not floating above it.

- **Active icon/label:** `#b8552e` (Terra Cotta Ink). The accent marks which room you are in.
- **Inactive icon/label:** `#b3a892` (muted warm gray). Present but undemanding.
- Labels displayed in DM Sans, 12pt, below the icon. No all-caps.

### Signature Component: Dictionary Lookup Panel
When a user taps a word, the definition panel rises as a bottom sheet. It uses a **Muted card** (`#f0ece4`) as the root surface, with:
- The target word in Display style (Fraunces Bold, 30pt)
- Part of speech as an Eyebrow label
- Definition body in Body style (DM Sans, 15pt)
- Hanja/radical breakdown in a nested Strong card
- Action row (save word, add to deck) in Neutral IconButtons

The panel must not compete with the reading surface above it. Shadow: Subtle Lift only on the drag handle bar.

## 6. Do's and Don'ts

### Do:
- **Do** let reading content own the screen. UI chrome — headers, tab bars, action buttons — stays at the periphery.
- **Do** use terra cotta (`#b8552e`) exclusively for interactive and active states. Its scarcity is its signal.
- **Do** use tonal surface stepping (`background-warm → surface → surface-elevated`) to create depth before reaching for shadows.
- **Do** use Fraunces for content hierarchy and DM Sans for functional UI. Keep the pairing clean.
- **Do** size and render CJK text (Korean, Chinese) at appropriate line heights; 22pt is minimum for comfortable Hangul/Hanzi reading.
- **Do** respect the user's chosen font and size in the reader — design system typography governs the shell, not the page.
- **Do** earn shadows with state. Shadows appear on interaction (hover, drag, sheet open), not at rest.

### Don't:
- **Don't** add gamification UI — streaks, confetti, mascot characters, or score badges. Per PRODUCT.md: readers, not gamers.
- **Don't** use clinical card grids styled like Anki or Quizlet. No white-on-white uniform card matrices with no typographic investment.
- **Don't** reproduce Duolingo's color saturation or playful illustration style. The register here is calm and focused, not encouraging and cartoonish.
- **Don't** use a second accent color. The accent is terra cotta and only terra cotta. Adding a second saturated color breaks the One Accent Rule.
- **Don't** use `border-left` greater than 1px as a colored stripe on cards, callouts, or list items. Use tonal background or full borders.
- **Don't** apply gradient text (`background-clip: text`). Emphasis via weight (Fraunces Bold) or size, not visual effect.
- **Don't** nest elevated cards inside elevated cards. Muted or strong surfaces inside elevated, not elevated inside elevated.
- **Don't** use eyebrow labels on every section. One per screen section, maximum. Eyebrows used reflexively turn into wallpaper.
- **Don't** use orange-amber (`#c87d00`) as the primary accent. The system has been unified to terra cotta; amber reads as a holdover and breaks palette coherence.
