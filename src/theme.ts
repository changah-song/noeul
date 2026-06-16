/**
 * FluentFable — "Slate & Stone" Design Theme
 * Generated from:
 *   design_handoff_fluent_fable_kindle/README.md (v3)
 *   design/Fluent Fable OCR Overlay.dc.html     (inspected)
 *   reference/FEATURES_AND_INTERACTIONS.md
 *
 * SOURCE OF TRUTH: Where this file and the HTML design files disagree,
 * the HTML wins. Update this file to match, then re-audit any component
 * that uses the changed token.
 *
 * ─── THE FIVE RULES ────────────────────────────────────────────────────────
 *
 * 1. ONE INK RULE
 *    Colors.inkSlate (#202631) is the ONLY interactive color:
 *    active tab underline, primary buttons, progress fills, FAB bg,
 *    saved/known toggle filled state, dictionary highlight fill,
 *    active carousel page dots, "more" links, blinking caret.
 *    Never add a second saturated color. Differentiate with weight,
 *    tracking, and tone only.
 *
 * 2. THREE FONT ROLES — never swap them
 *    Inter        → all functional UI chrome (labels, body copy,
 *                   buttons, metadata, OCR panels)
 *    Fraunces     → literary/section hierarchy (section titles,
 *                   modal bar titles, stat numerals, screen headings)
 *                   + italic ONLY for romanizations & literary captions
 *    NotoSerifKR  → anything in the learning language (Korean text,
 *                   headwords, reader body, book cover titles)
 *
 * 3. ITALICS POLICY
 *    Fraunces italic = romanizations (jeong-jeok) and literary captions
 *    ONLY. Bar titles are upright tracked caps (not italic).
 *
 * 4. HAIRLINES OVER SHADOWS
 *    Structure comes from 1px borders, not shadows. Only four in-app
 *    shadows: lookup sheet, FAB, book preview cover, OCR bubble.
 *    The showcase frame shadow must NOT ship as in-app chrome.
 *
 * 5. NO HARDCODING
 *    Every hex value, font size, spacing value, and radius in a
 *    component must reference this file. If a value is missing, add
 *    it here first.
 */

// ─── Colors ──────────────────────────────────────────────────────────────────

export const Colors = {
  // ── The one interactive ink ──
  // Active tab underline, primary buttons, progress fills, FAB,
  // saved/known filled state, dictionary highlight, active dots,
  // "more" links, blinking caret, mark-known filled ring.
  inkSlate:     '#202631',
  inkSlateDeep: '#11151c',  // Book-cover spine edge / deepest tone only
  coverSlate:   '#353c47',  // Darkest typographic book-cover background

  // ── Text ──
  text:          '#1b1c1c',  // Primary text, active tab label
  textSecondary: '#44474b',  // Icon strokes, secondary headings, action-row captions
  textMuted:     '#5c5e63',  // Definitions, descriptions, metadata, eyebrow labels
  textTertiary:  '#75777b',  // Romanizations, helper copy, field labels
  textSubtle:    '#9a9c9f',  // Placeholders, inactive eyebrows/tabs, counts,
                             // autosave indicator, COPY label

  // ── Backgrounds ──
  bgPage:       '#fbf9f8',  // Screen bg on EVERY screen. Also tab bar.
  surface:      '#ffffff',  // Inputs, most cards, lookup sheet bg
  surfaceCard:  '#fefdfc',  // Flashcard + Root-Character carousel cards
  surfaceMuted: '#f0eded',  // Hanja insets, download tile, chip fills,
                             // TRANSLATE button active bg, skeleton base,
                             // Book Preview cover band
  surfaceAssist: '#f4f1f1', // Writing-editor vocabulary assist strip

  // ── Cover tones (typographic only — no raster art) ──
  coverMid: '#75777b',  // Mid-tone typographic book cover

  // ── Borders & dividers ──
  divider:      '#eceaea',  // In-card dividers / row separators — 1px
  border:       '#e4e2e2',  // Card and element borders — 1px
                             // Also: tab bar top border, sheet top hairline
  borderStrong: '#c5c6cb',  // Input borders, outline pills, inactive mark-known
                             // ring, prompt block left rule (2px), inactive entry pills
  frame:        '#b0b2b6',  // Device-frame border, low-emphasis icon strokes,
                             // inactive dot edge, grid/list toggle inactive

  // ── Dots ──
  dotInactive: '#d2d0d0',  // Inactive carousel page dot
} as const;

export type ColorToken = keyof typeof Colors;

// ─── OCR Overlay Colors ───────────────────────────────────────────────────────
//
// The OCR overlay sits over arbitrary screen content (webpages, PDFs, other apps),
// not the app's own UI. These values are sourced directly from inspecting
// Fluent Fable OCR Overlay.dc.html and are kept separate from the main palette
// because they must contrast over unknown backgrounds.

export const OCRColors = {
  // ── Word detection boxes ──
  // Every detected word gets a box with this fill + inset outline.
  detectionFill:         'rgba(61, 79, 114, 0.13)',  // light navy, low opacity
  detectionBorder:       '#3d4f72',                   // light navy solid, 1.5px inset
  detectionRadius:       2,

  // Pressed state (word tapped — opens definition)
  detectionPressedFill:  '#3d4f72',    // solid fill
  detectionPressedText:  '#ffffff',

  // Region selected state (drag to select — opens translation)
  detectionRegionFill:   'rgba(61, 79, 114, 0.24)',  // higher opacity than default
  detectionRegionBorder: '#3d4f72',
  detectionRegionRadius: 4,

  // ── Floating circle ──
  bubbleBg:     'rgba(32, 38, 49, 0.90)',  // inkSlate at 90%
  bubbleBgDrag: 'rgba(32, 38, 49, 0.85)',  // slightly lighter while dragging
  bubbleBorder: Colors.coverSlate,          // #353c47

  // Dragged over close target — circle shifts to warn
  bubbleBgOverClose:     '#2d1a1a',
  bubbleBorderOverClose: '#C0392B',

  // ── Close target pill ──
  closeTargetBg:     'rgba(27, 28, 28, 0.82)',
  closeTargetBorder: Colors.coverSlate,
  closeTargetLabel:  Colors.textSubtle,

  // Activated (bubble hovering over it — grows + turns red)
  closeTargetActiveBg:     'rgba(192, 57, 43, 0.92)',
  closeTargetActiveBorder: '#e05a4a',
  closeTargetActiveLabel:  '#ffffff',

  // ── Translation banner (dark floating panel) ──
  // Intentionally #1b1c1c base — utility surface, not branded inkSlate
  bannerBg:         'rgba(27, 28, 28, 0.82)',
  bannerText:       '#ffffff',
  bannerMetaText:   Colors.textSubtle,   // language label + COPY
  bannerSkeletonFill: 'rgba(255, 255, 255, 0.12)',  // skeleton lines on dark bg
} as const;

// ─── Dark Mode Token Overrides ────────────────────────────────────────────────
//
// Toggled globally from Profile. These replace their light-mode counterparts
// when the dark theme is active. Currently mocked on Profile only — extend
// app-wide when implementing.

export const DarkColors = {
  bgPage:       '#11151c',
  surface:      '#1b1c1c',
  surfaceMuted: '#202631',
  text:         '#f0eded',
  textMuted:    '#5c5e63',
  border:       '#353c47',
  divider:      '#202631',
  shelfBar:     '#44474b',
  // These do NOT change in dark mode:
  // inkSlate, inkSlateDeep, coverSlate — unchanged
  // Avatar bg stays #202631
} as const;

// ─── Typography ──────────────────────────────────────────────────────────────
//
// FONT LOADING: Bundle all three families via expo-font. Do NOT load at runtime.
//   Inter:         400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold)
//   Fraunces:      400, 500, 600 + italic 400, italic 500
//   Noto Serif KR: 400, 500, 600, 700
//   (Chinese profiles will also need Noto Serif SC / Noto Serif TC)
//
// ICONS: Material Symbols Outlined (variable font)
//   Rest:   FILL 0, wght 300, GRAD 0, opsz 24
//   Active: FILL 1 (saved star, filled bookmark)
//
// Glyphs in use:
//   expand_more, screenshot_region, arrow_back, arrow_back_ios_new,
//   more_horiz, chevron_left, chevron_right, east, add, cloud_download,
//   add_circle, star, download, edit, delete, settings, close, bookmark,
//   check, menu_book, translate, spellcheck, format_quote, edit_square,
//   menu, search_off

export const FontFamily = {
  // Inter — functional UI
  inter:         'Inter',
  interMedium:   'Inter-Medium',
  interSemiBold: 'Inter-SemiBold',
  interBold:     'Inter-Bold',

  // Fraunces — literary hierarchy + romanizations
  fraunces:             'Fraunces',
  frauncesItalic:       'Fraunces-Italic',        // ONLY: romanizations & literary captions
  frauncesMedium:       'Fraunces-Medium',
  frauncesMediumItalic: 'Fraunces-MediumItalic',  // ONLY: romanizations & literary captions
  frauncesSemiBold:     'Fraunces-SemiBold',

  // Noto Serif KR — learning language
  notoSerifKR:         'NotoSerifKR-Regular',
  notoSerifKRMedium:   'NotoSerifKR-Medium',
  notoSerifKRSemiBold: 'NotoSerifKR-SemiBold',
  notoSerifKRBold:     'NotoSerifKR-Bold',

  // Icons
  materialSymbols: 'MaterialSymbolsOutlined',
} as const;

/**
 * Named text style roles.
 *
 * REACT NATIVE NOTES:
 * - lineHeight is absolute px (fontSize × multiplier), NOT a CSS multiplier.
 * - letterSpacing is in logical px matching README px values directly.
 * - textTransform: 'uppercase' is supported in RN.
 * - To override color: spread and override:
 *     { ...TextStyles.eyebrow, color: Colors.textSubtle }
 */
export const TextStyles = {

  // ── Showcase only (not in app UI) ──
  display: {
    fontFamily:    FontFamily.frauncesMedium,
    fontSize:      50,
    lineHeight:    55,    // 50 × 1.1
    letterSpacing: -0.5,  // −0.01em at 50px
  },

  // ── Section dividers ("The Library", "Reading", "Study", "Desk & Identity") ──
  partTitle: {
    fontFamily: FontFamily.frauncesMedium,
    fontSize:   26,
  },

  // ── Screen headings ──
  screenHeadingSerif: {
    // "Archive", "Alex Chen", "Completed Bookshelf", "Preferences"
    fontFamily: FontFamily.frauncesSemiBold,
    fontSize:   30,  // use 32 for "Archive" and profile name
    color:      Colors.text,
  },
  screenHeadingSans: {
    // "Welcome back." on Home
    fontFamily:    FontFamily.interSemiBold,
    fontSize:      28,
    letterSpacing: -0.56,  // −0.02em
    color:         Colors.text,
  },

  // ── App-name bar title ──
  // "FLUENT FABLE", "BOOK", "VOCABULARY", "WRITE"
  appBarTitle: {
    fontFamily:    FontFamily.interBold,
    fontSize:      12,
    letterSpacing: 3.2,
    textTransform: 'uppercase' as const,
    color:         Colors.text,
  },

  // ── Screen / modal bar title ──
  // "FLASHCARD", "NEW SONG", "NEW ENTRY" — upright Fraunces, NOT italic
  screenBarTitle: {
    fontFamily:    FontFamily.fraunces,
    fontSize:      13,
    letterSpacing: 4,
    textTransform: 'uppercase' as const,
    color:         Colors.text,
  },

  // ── Eyebrow labels ──
  // "LIBRARY", "CURRENT READING", "ROOT CHARACTERS", "MEANING",
  // "RELATED WORDS", "COMPOSITION", "COLLECTION", "TODAY'S PROMPT",
  // "FROM YOUR VOCABULARY", "HANJA CHARACTER"
  eyebrow: {
    fontFamily:    FontFamily.interSemiBold,
    fontSize:      9,    // 9–10px; use 10 for wider sections
    letterSpacing: 1.6,  // 1.6–2.6px; use 2.6 for tighter sections
    textTransform: 'uppercase' as const,
    color:         Colors.textMuted,
  },
  eyebrowSubtle: {
    fontFamily:    FontFamily.interSemiBold,
    fontSize:      9,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
    color:         Colors.textSubtle,  // inactive / placeholder eyebrows
  },

  // ── Stat numerals ──
  statNumeral: {
    fontFamily: FontFamily.frauncesMedium,
    fontSize:   26,  // 24–26px
    color:      Colors.text,
  },

  // ── Body UI copy ──
  bodyUISmall: {
    fontFamily: FontFamily.inter,
    fontSize:   13,
    lineHeight: 19,  // 13 × 1.45
    color:      Colors.textMuted,
  },
  bodyUI: {
    fontFamily: FontFamily.inter,
    fontSize:   14,
    lineHeight: 21,  // 14 × 1.5
    color:      Colors.textMuted,
  },
  bodyUILarge: {
    fontFamily: FontFamily.inter,
    fontSize:   15,
    lineHeight: 25,  // 15 × 1.67
    color:      Colors.textMuted,
  },

  // ── Labels (buttons, chips, tab bar, toolbar) ──
  labelSmall: {
    // Status badges: "REVIEWED", "DRAFT", "SUBMITTED", "PDF", "NEW", "ACTIVE"
    fontFamily:    FontFamily.interSemiBold,
    fontSize:      9,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  label: {
    fontFamily:    FontFamily.interSemiBold,
    fontSize:      11,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
  labelBold: {
    fontFamily:    FontFamily.interBold,
    fontSize:      10,
    letterSpacing: 1.8,
    textTransform: 'uppercase' as const,
  },

  // ── Romanization ──
  // Fraunces italic — ONLY for romanized readings and literary captions
  romanization: {
    fontFamily: FontFamily.frauncesItalic,
    fontSize:   14,  // 12–17px by context
    color:      Colors.textTertiary,
  },
  romanizationLarge: {
    fontFamily: FontFamily.frauncesItalic,
    fontSize:   17,  // lookup sheet headword romanization
    color:      Colors.textTertiary,
  },

  // ── Korean reader body (user-configurable — these are DEFAULTS only) ──
  koreanReaderBody: {
    fontFamily: FontFamily.notoSerifKR,
    fontSize:   18,  // user-configurable via Font Settings
    lineHeight: 37,  // 18 × 2.05 — user-configurable
    color:      Colors.text,
  },

  // ── Korean titles & headwords ──
  koreanTitle: {
    // Book grid titles, Write Archive entry titles, headwords in lists
    fontFamily: FontFamily.notoSerifKRSemiBold,
    fontSize:   16,  // 16–23px by context
    color:      Colors.text,
  },
  koreanCurrentReading: {
    // Current-reading card title on Home
    fontFamily: FontFamily.notoSerifKRSemiBold,
    fontSize:   19,
    color:      Colors.text,
  },
  koreanHeadwordLookup: {
    // Lookup sheet (reader, song, OCR)
    fontFamily: FontFamily.notoSerifKRSemiBold,
    fontSize:   28,
    color:      Colors.text,
  },
  koreanHeadwordDetail: {
    // Word Detail screen
    fontFamily: FontFamily.notoSerifKRMedium,
    fontSize:   36,
    color:      Colors.text,
  },
  koreanHeadwordFlashcard: {
    // Flashcard front face
    fontFamily: FontFamily.notoSerifKRMedium,
    fontSize:   60,
    color:      Colors.inkSlate,
  },
  koreanSongLyric: {
    // Song reader lyric body
    fontFamily: FontFamily.notoSerifKR,
    fontSize:   19,
    lineHeight: 48,  // 19 × 2.5
    color:      Colors.text,
    textAlign:  'center' as const,
  },
  koreanPrompt: {
    // Write entry today's prompt block
    fontFamily: FontFamily.notoSerifKRMedium,
    fontSize:   16,
    color:      Colors.text,
  },
  koreanEditorTitle: {
    // Write entry title field
    fontFamily: FontFamily.notoSerifKRSemiBold,
    fontSize:   23,
    color:      Colors.text,
  },
  koreanEditorBody: {
    // Write entry body editor
    fontFamily: FontFamily.notoSerifKR,
    fontSize:   16,
    lineHeight: 32,  // 16 × 2.0
    color:      Colors.text,
  },

  // ── Hanja glyphs ──
  hanjaGlyph: {
    // Root-character tile in lookup carousel (standard)
    fontFamily: FontFamily.notoSerifKRMedium,
    fontSize:   32,  // 32–38px; use 38 for Word Detail inset
    color:      Colors.inkSlate,
  },

  // ── Completed bookshelf spine titles ──
  spineTitle: {
    fontFamily: FontFamily.notoSerifKR,
    fontSize:   9,
    color:      '#ffffff',  // override to Colors.text on light spines
  },

  // ── Tab bar ──
  tabActive: {
    fontFamily:    FontFamily.interBold,
    fontSize:      10,
    letterSpacing: 1.8,
    textTransform: 'uppercase' as const,
    color:         Colors.text,   // #1b1c1c — NOT inkSlate
  },
  tabInactive: {
    fontFamily:    FontFamily.interMedium,
    fontSize:      10,
    letterSpacing: 1.8,
    textTransform: 'uppercase' as const,
    color:         Colors.textSubtle,
  },

  // ── Metadata / attribution ──
  meta: {
    fontFamily:    FontFamily.inter,
    fontSize:      10,
    letterSpacing: 0.4,
    color:         Colors.textSubtle,
  },

  // ── OCR translation banner ──
  ocrBannerMeta: {
    // "한국어 → English" language label + COPY button
    fontFamily:    FontFamily.inter,
    fontSize:      11,
    letterSpacing: 0.8,
    color:         Colors.textSubtle,
  },
  ocrBannerText: {
    // Translated text on dark banner bg
    fontFamily: FontFamily.inter,
    fontSize:   15,
    lineHeight: 24,  // 15 × 1.6
    color:      '#ffffff',
  },
} as const;

// ─── Spacing ─────────────────────────────────────────────────────────────────
// Scale: 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 22 / 24 / 26 / 28

export const Spacing = {
  xs:  4,
  sm:  6,
  md:  8,
  lg:  10,
  xl:  12,
  xl2: 14,
  xl3: 16,
  xl4: 18,
  xl5: 22,
  xl6: 24,
  xl7: 26,
  xl8: 28,

  // Semantic aliases
  screenHorizontal:      24,  // Standard horizontal padding
  screenHorizontalDense: 20,  // Dense bars
  cardPadding:           16,  // Standard card internal padding
  cardPaddingLarge:      18,
  cardPaddingCompact:    12,  // OCR overlay compact panels
  sectionGap:            24,  // Inter-section gap (22–28)
  flashcardPadding:      32,
} as const;

// ─── Border Radii ─────────────────────────────────────────────────────────────

export const Radii = {
  frame:        34,   // Device frame (showcase only)
  sheet:        16,   // Bottom-sheet top corners
  flashcard:    10,   // Flashcard review card
  ocrBanner:    10,   // OCR translation banner
  card:          4,   // Collection cards, vocab card, carousel cards, stat cards,
                      // lookup action buttons, entry-type pills
  input:         3,   // Text inputs, Hanja tile, suggestion chips
  cover:         2,   // Typographic book covers, progress bars, status badges,
                      // OCR detection boxes (default)
  pill:        999,   // Type pills, status dots, mark-known rings, FAB,
                      // OCR close target
  badge:         2,   // Status badges ("REVIEWED", "NEW", "PDF", "ACTIVE")
} as const;

// ─── Shadows ─────────────────────────────────────────────────────────────────
//
// Four in-app shadows only. The showcase frame shadow must NOT ship.

export const Shadows = {
  // Lookup / song bottom sheet
  sheet: {
    shadowColor:   '#1b1c1c',
    shadowOffset:  { width: 0, height: -10 },
    shadowOpacity: 0.08,
    shadowRadius:  30,
    elevation:     8,
  },

  // Home compose FAB
  fab: {
    shadowColor:   '#1b1c1c',
    shadowOffset:  { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius:  16,
    elevation:     10,
  },

  // Book Preview large cover tile
  coverLift: {
    shadowColor:   '#1b1c1c',
    shadowOffset:  { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius:  28,
    elevation:     12,
  },

  // OCR overlay floating circle
  ocrBubble: {
    shadowColor:   '#000000',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius:  16,
    elevation:     12,
  },

  // ⚠️ SHOWCASE ONLY — DO NOT SHIP as in-app chrome
  // showcaseFrame: { shadowColor: '#1b1c1c', shadowOffset: { width: 0, height: 24 }, shadowOpacity: 0.10, shadowRadius: 48 }
} as const;

// ─── Component Layout Constants ───────────────────────────────────────────────

export const Layout = {
  // ── Tab bar ──
  tabBarHeight:             64,
  tabBarBorderWidth:        1,
  tabBarBorderColor:        Colors.border,
  tabActiveUnderlineHeight: 2,
  tabActiveUnderlineColor:  Colors.text,  // #1b1c1c — NOT inkSlate

  // ── Navigation bars ──
  appBarHeight:       56,
  statusBarHeight:    44,
  readerHeaderHeight: 56,

  // ── FAB ──
  fabSize: 52,

  // ── Book covers (typographic — no raster art) ──
  bookCoverAspectRatio:    2 / 3,
  bookPreviewCoverWidth:   172,
  bookPreviewCoverHeight:  244,
  bookGridCoverSpineWidth: 4,    // left spine accent

  // ── Bottom sheet ──
  sheetGrabberWidth:  36,
  sheetGrabberHeight: 4,
  sheetGrabberColor:  Colors.border,

  // ── Progress bar ──
  progressTrackHeight: 3,
  progressTrackColor:  Colors.divider,
  progressFillColor:   Colors.inkSlate,

  // ── Hanja tiles ──
  hanjaTileSize:        54,  // Lookup sheet standard
  hanjaTileSizeCompact: 44,  // OCR overlay compact panels
  hanjaTileSizeDetail:  64,  // Word Detail inset

  // ── Mark-known toggle ring ──
  markKnownSize:        30,
  markKnownSizeCompact: 26,  // OCR overlay compact panels
  markKnownBorderWidth: 1.5, // inactive ring stroke

  // ── Vocab maturity meter ──
  maturityDotCount: 4,
  maturityDotSize:  8,

  // ── Root-character carousel ──
  carouselCardFlex:           0.86,  // next card peeks ~14%
  carouselPageDotSize:        6,
  carouselPageDotSizeCompact: 5,  // OCR overlay

  // ── Flashcard ──
  flashcardPadding: 32,
  flashcardRadius:  10,

  // ── Completed bookshelf spines ──
  spineHeightMin:  114,
  spineHeightMax:  166,
  spineWidthMin:    26,
  spineWidthMax:    44,
  shelfBarHeight:    6,
  shelfBaseHeight:  10,
  shelfBarColor:   Colors.textSubtle,
  shelfBaseColor:  Colors.border,

  // ── Write editor ──
  writeToolbarHeight:  56,
  writeCaretWidth:      2,
  writeCaretColor:     Colors.inkSlate,
  assistStripHeight:   48,

  // ── Lookup sheet action buttons ──
  lookupButtonHeight:        52,
  lookupButtonHeightCompact: 44,  // OCR overlay

  // ── OCR overlay ──
  ocrBubbleSize:             56,
  ocrBubbleIconSize:         28,
  ocrBubblePressedScale:     1.08,  // scale up while dragging
  ocrCloseTargetWidth:       160,
  ocrCloseTargetHeight:       48,
  ocrCloseTargetActiveWidth:  200,  // grows when bubble hovers over it
  ocrCloseTargetActiveHeight:  56,
  ocrCloseTargetBottom:        32,  // px above bottom safe area
  ocrBannerInset:              16,  // horizontal inset from screen edges
  ocrBannerRadius:             10,
  ocrBannerMaxLines:            4,  // truncate translation at 4 lines
  ocrDetectionPadding:    { vertical: 1, horizontal: 3 },
  ocrDetectionPaddingRegion: { vertical: 2, horizontal: 4 },
} as const;

// ─── Motion ──────────────────────────────────────────────────────────────────
//
// Motion is calm: short fades and slides only.
// No confetti, bounces, streak celebrations, or gamification animation.

export const Motion = {
  // Lookup / song sheet open
  sheetOpenDuration:    275,  // ms, ease-out
  sheetDismissDuration: 225,  // ms, ease-in

  // Segmented tab / filter indicator move
  tabTransitionDuration: 200,  // ms, ease

  // Write editor blinking caret (step-end, ~1.1s loop)
  caretBlinkDuration: 1100,  // ms

  // OCR close target slide up when drag starts
  ocrCloseTargetEnterDuration: 200,  // ms, ease-out
  // OCR close target grow on bubble hover
  ocrCloseTargetGrowDuration:  150,  // ms, ease-out
  // OCR close target pulse while activated (scale 1 → 1.04 → 1 loop)
  ocrCloseTargetPulseDuration: 400,  // ms
  // OCR translation banner slide up
  ocrBannerEnterDuration:  240,  // ms, ease-out
  ocrBannerDismissDuration: 180,  // ms, ease-in

  // "COPIED" label revert
  copiedRevertDelay: 1500,  // ms

  // Autosave "SAVING…" → "DRAFT SAVED" debounce
  autosaveDebounceDuration: 800,  // ms

  // All pills/buttons
  pressedOpacity:  0.82,
  disabledOpacity: 0.50,
} as const;

// ─── Icon Defaults (Material Symbols Outlined) ────────────────────────────────

export const IconDefaults = {
  fill:        0,
  weight:      300,
  grade:       0,
  opticalSize: 24,
  size:        24,
  color:       Colors.textSecondary,

  // Active / filled state
  fillActive:  1,
  colorActive: Colors.inkSlate,
} as const;
