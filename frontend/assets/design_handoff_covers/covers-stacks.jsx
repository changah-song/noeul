// covers-stacks.jsx — "Stacks" generative default book cover.
// Given only { title, author }, produces a deterministic minimalist cover:
// ascending geometric bars + the title/author set in serif. A hash of
// (title+author) picks one of 8 cozy palettes, so every book gets a
// unique-but-stable cover with no manual artwork.
//
// This is a DESIGN REFERENCE (React + inline styles for clarity). Reimplement
// in the target codebase's idiom (RN/SwiftUI/Flutter/CSS) — copy the tokens,
// geometry, and the hashing rule, not necessarily this literal markup.

// ── Palettes: cozy, literary, muted. bg = cover field, accent = bars, ink = text. ──
const CPAL = [
  { bg:'#e7ddc8', accent:'#bf5b3e', ink:'#2f2820' }, // cream / terracotta
  { bg:'#dde4d6', accent:'#5f7a4a', ink:'#27331f' }, // sage
  { bg:'#d7dfe7', accent:'#3f6184', ink:'#1f2a35' }, // slate blue
  { bg:'#ece1c8', accent:'#c0902f', ink:'#3a2f17' }, // mustard
  { bg:'#e9d9d6', accent:'#9c4a52', ink:'#3a1f22' }, // rose / maroon
  { bg:'#dcd6e2', accent:'#6a5495', ink:'#2a2235' }, // plum
  { bg:'#d9e1dd', accent:'#2f7d6b', ink:'#16332c' }, // teal
  { bg:'#e7ded2', accent:'#8a6741', ink:'#322517' }, // umber
];

// Deterministic 32-bit string hash (DJB-ish). Same input → same output, always.
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Pick the palette for a book from its title+author.
function palFor(book) { return CPAL[hashStr(book.title + book.author) % CPAL.length]; }

// Title point size by glyph count (excludes spaces) so long titles still fit.
function titleSize(title, base) {
  const n = title.replace(/\s/g, '').length;
  if (n <= 3) return base;
  if (n <= 5) return Math.round(base * 0.8);
  if (n <= 7) return Math.round(base * 0.66);
  return Math.round(base * 0.54);
}

const SERIF = "'Noto Serif KR', serif";        // title (matches app reading type)
const SANS  = "'DM Sans', system-ui, sans-serif"; // author / metadata
const COVER_W = 200, COVER_H = 298;             // 2:3 reference size — scales by ratio

// Cover frame: rounded corners, subtle drop shadow, faint left "spine" gradient.
function CoverFrame({ children, bg }) {
  return (
    <div style={{ width: COVER_W, height: COVER_H, background: bg, borderRadius: 4, overflow: 'hidden', position: 'relative', boxShadow: '0 1px 2px rgba(0,0,0,0.12)', fontFamily: SERIF }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 7, background: 'linear-gradient(90deg, rgba(0,0,0,0.10), rgba(0,0,0,0))', zIndex: 5, pointerEvents: 'none' }} />
      {children}
    </div>
  );
}

// ── The Stacks cover ──
// Title + author top-left; a column of 5 ascending bars bottom-left, each a
// little more opaque than the last. Bar widths are a fixed rhythm (not random)
// so the motif stays recognizable across the whole series.
const STACK_WIDTHS = [40, 64, 52, 80, 30]; // px at the 200px reference width

function CoverStacks({ book }) {
  const p = palFor(book);
  return (
    <CoverFrame bg={p.bg}>
      <div style={{ position: 'absolute', left: 20, right: 20, top: 24 }}>
        <div style={{ fontSize: titleSize(book.title, 26), fontWeight: 600, color: p.ink, lineHeight: 1.28, wordBreak: 'keep-all' }}>{book.title}</div>
        <div style={{ fontSize: 12, color: p.ink, opacity: 0.7, marginTop: 7, fontFamily: SANS }}>{book.author}</div>
      </div>
      <div style={{ position: 'absolute', left: 20, bottom: 26, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {STACK_WIDTHS.map((w, i) => (
          <div key={i} style={{ width: w, height: 7, borderRadius: 4, background: p.accent, opacity: 0.55 + i * 0.1 }} />
        ))}
      </div>
    </CoverFrame>
  );
}

Object.assign(window, { CPAL, hashStr, palFor, titleSize, SERIF, SANS, COVER_W, COVER_H, CoverFrame, STACK_WIDTHS, CoverStacks });
