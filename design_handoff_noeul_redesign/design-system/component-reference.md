# Noeul component reference

Reference implementations and API specs for the design-system components, grouped by category. These are references to adapt into the target codebase — not drop-in production code.


## core

### Badge

**Usage**

Tiny uppercase tag — for a book format, a level, or a status. Near-square corners, wide tracking.

```jsx
<Badge tone="slate">EPUB</Badge>
<Badge tone="outline">A2</Badge>
<Badge tone="soft">Public domain</Badge>
```

**API (`Badge.d.ts`)**

```ts
import { ReactNode, CSSProperties } from 'react';

/**
 * A tiny uppercase tag for levels, file formats, and status. Soft sunset
 * tints (coral / rose / amber), a neutral glass chip, a hairline outline,
 * or a filled gradient. Soft-square radius, wide tracking.
 */
export interface BadgeProps {
  children?: ReactNode;
  /** @default "neutral" */
  tone?: 'neutral' | 'solid' | 'outline' | 'coral' | 'rose' | 'amber';
  style?: CSSProperties;
}

export function Badge(props: BadgeProps): JSX.Element;
```

**Reference implementation (`Badge.jsx`)**

```jsx
import React from 'react';

/**
 * Noeul Badge — a tiny uppercase tag for levels, formats (EPUB), and status.
 * Soft sunset tints (coral / rose / amber), a neutral glass chip, a hairline
 * outline, or a filled gradient. Soft-square radius, wide tracking.
 */
export function Badge({ children, tone = 'neutral', style = {}, ...rest }) {
  const tones = {
    neutral: { background: 'var(--surface-muted)', color: 'var(--text-muted)', border: '1px solid transparent' },
    solid:   { background: 'var(--gradient-accent)', color: 'var(--glyph-cream)', border: '1px solid transparent' },
    outline: { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' },
    coral:   { background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid transparent' },
    rose:    { background: 'rgba(216, 92, 118, 0.14)', color: 'var(--accent-2)', border: '1px solid transparent' },
    amber:   { background: 'rgba(238, 154, 76, 0.16)', color: 'var(--accent-3)', border: '1px solid transparent' },
  };
  const t = tones[tone] || tones.neutral;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: 'var(--font-ui)',
        fontWeight: 700,
        fontSize: '10px',
        letterSpacing: '1.4px',
        textTransform: 'uppercase',
        padding: '3px 8px',
        borderRadius: 'var(--radius-xs)',
        ...t,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
```

### Button

**Usage**

Slate CTA button — filled slate with cream text by default; use it for the single primary action on a screen.

```jsx
<Button variant="primary" onClick={start}>Get the app</Button>
<Button variant="secondary" shape="pill">See it in action</Button>
<Button uppercase shape="square" size="sm">Continue</Button>
```

Variants: `primary` (filled slate), `secondary` (hairline ghost), `text` (bare link), `danger` (outlined red). Shapes: `pill` for marketing/web, `square` for in-app controls. Set `uppercase` for the app's wide-tracked label style. Press state is a subtle 1px drop + darken — never a bounce.

**API (`Button.d.ts`)**

```ts
import { ReactNode, CSSProperties } from 'react';

/**
 * The sunset CTA button. Filled coral→rose gradient with cream text and a
 * soft glow (primary), a frosted-glass ghost (secondary), a bare coral link
 * (text), or an outlined destructive (danger).
 */
export interface ButtonProps {
  children?: ReactNode;
  /** Visual weight. @default "primary" */
  variant?: 'primary' | 'secondary' | 'text' | 'danger';
  /** @default "md" */
  size?: 'sm' | 'md' | 'lg';
  /** Pill (default), soft square (in-card), or round (icon-ish). @default "pill" */
  shape?: 'pill' | 'square' | 'round';
  /** Uppercase wide-tracked label, like the app's controls. @default false */
  uppercase?: boolean;
  disabled?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
}

export function Button(props: ButtonProps): JSX.Element;
```

**Reference implementation (`Button.jsx`)**

```jsx
import React from 'react';

/**
 * Noeul Button — the sunset CTA.
 * Primary is a coral→rose gradient with cream text and a soft accent glow;
 * secondary is a frosted-glass ghost; text is a bare coral link. Pills by
 * default, soft square for in-card actions. Quiet press = slight fade + 1px drop.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  shape = 'pill',
  uppercase = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  style = {},
  ...rest
}) {
  const radius =
    shape === 'square'
      ? 'var(--radius-md)'
      : shape === 'round'
      ? 'var(--radius-sm)'
      : 'var(--radius-pill)';

  const sizes = {
    sm: { padding: '9px 18px', font: '14px' },
    md: { padding: '13px 26px', font: '15px' },
    lg: { padding: '16px 32px', font: '16px' },
  };
  const s = sizes[size] || sizes.md;

  const variants = {
    primary: {
      background: 'var(--gradient-accent)',
      color: 'var(--glyph-cream)',
      border: '1px solid transparent',
      boxShadow: 'var(--shadow-accent)',
    },
    secondary: {
      background: 'var(--surface-glass)',
      color: 'var(--text)',
      border: '1px solid var(--surface-glass-border)',
      backdropFilter: 'blur(var(--glass-blur))',
      WebkitBackdropFilter: 'blur(var(--glass-blur))',
    },
    text: { background: 'transparent', color: 'var(--accent)', border: '1px solid transparent', padding: '8px 4px' },
    danger: { background: 'transparent', color: 'var(--danger)', border: '1px solid var(--border-strong)' },
  };
  const v = variants[variant] || variants.primary;

  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-xs)',
        fontFamily: 'var(--font-ui)',
        fontWeight: uppercase ? 700 : 600,
        fontSize: uppercase ? '11px' : s.font,
        letterSpacing: uppercase ? 'var(--tracking-tab)' : '0',
        textTransform: uppercase ? 'uppercase' : 'none',
        padding: v.padding || s.padding,
        borderRadius: radius,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 'var(--opacity-disabled)' : 1,
        transition: 'filter var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease)',
        WebkitFontSmoothing: 'antialiased',
        ...v,
        ...style,
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'translateY(1px)'; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = 'none'; }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.filter = 'none';
        if (variant === 'secondary' && !disabled) e.currentTarget.style.background = 'var(--surface-glass)';
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (variant === 'primary') e.currentTarget.style.filter = 'brightness(1.05)';
        if (variant === 'secondary') e.currentTarget.style.background = 'var(--surface-strong)';
      }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
```

### Card

**Usage**

Flat container with a 1px hairline border and a small (4px) radius — the default surface for grouping content. No shadow.

```jsx
<Card tone="elevated"><h3>Continue reading</h3></Card>
<Card tone="muted" radius="lg">A tinted block, borderless.</Card>
```

Tones: `elevated` (white), `card` (off-white reading surface), `muted` (tinted, borderless), `strong` (pressed fill), `page` (warm paper). Reach for `radius="lg"` only on sheets and flashcards.

**API (`Card.d.ts`)**

```ts
import { ReactNode, CSSProperties } from 'react';

/**
 * A frosted-glass surface over the sunset sky. The default `glass` tone is
 * translucent white with a light hairline and a backdrop blur; `solid` /
 * `muted` / `accent` / `reader` swap the fill. Soft 20px corners.
 */
export interface CardProps {
  children?: ReactNode;
  /** @default "glass" */
  tone?: 'glass' | 'solid' | 'muted' | 'accent' | 'reader';
  /** @default true */
  padded?: boolean;
  /** @default "lg" */
  radius?: 'sm' | 'md' | 'lg' | 'xl';
  /** Add a soft luminous lift shadow. @default false */
  glow?: boolean;
  style?: CSSProperties;
}

export function Card(props: CardProps): JSX.Element;
```

**Reference implementation (`Card.jsx`)**

```jsx
import React from 'react';

/**
 * Noeul Card — a frosted-glass surface over the sunset sky. The default
 * `glass` tone is translucent white with a light hairline and a backdrop
 * blur; `solid` / `muted` / `accent` swap the fill. Soft 20px corners.
 */
export function Card({
  children,
  tone = 'glass',
  padded = true,
  radius = 'lg',
  glow = false,
  style = {},
  ...rest
}) {
  const tones = {
    glass: {
      background: 'var(--surface-glass)',
      border: '1px solid var(--surface-glass-border)',
      backdropFilter: 'blur(var(--glass-blur))',
      WebkitBackdropFilter: 'blur(var(--glass-blur))',
    },
    solid: { background: 'var(--surface)', border: '1px solid var(--border)' },
    muted: { background: 'var(--surface-muted)', border: '1px solid transparent' },
    accent: { background: 'var(--accent-soft)', border: '1px solid transparent' },
    reader: {
      background: 'var(--reader-paper)',
      border: '1px solid var(--reader-paper-border)',
      backdropFilter: 'blur(var(--glass-blur))',
      WebkitBackdropFilter: 'blur(var(--glass-blur))',
    },
  };
  const radii = { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', xl: 'var(--radius-xl)' };
  const t = tones[tone] || tones.glass;

  return (
    <div
      style={{
        borderRadius: radii[radius] || radii.lg,
        padding: padded ? 'var(--space-lg)' : 0,
        fontFamily: 'var(--font-ui)',
        color: 'var(--text)',
        boxShadow: glow ? 'var(--shadow-glass)' : 'none',
        ...t,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
```

### ProgressBar

**Usage**

Thin slate progress fill on a faint track — reading progress, review completion. Optional label/detail row above.

```jsx
<ProgressBar progress={0.62} label="Continue" detail="62%" />
<ProgressBar progress={0.25} height={4} />
```

**API (`ProgressBar.d.ts`)**

```ts
import { CSSProperties } from 'react';

/**
 * A thin slate progress fill on a faint track, with an optional uppercase
 * label and a right-aligned detail (e.g. "62%" or "page 24 of 96").
 */
export interface ProgressBarProps {
  /** 0–1. @default 0 */
  progress?: number;
  label?: string;
  detail?: string;
  /** Track height in px. @default 8 */
  height?: number;
  fillColor?: string;
  trackColor?: string;
  style?: CSSProperties;
}

export function ProgressBar(props: ProgressBarProps): JSX.Element;
```

**Reference implementation (`ProgressBar.jsx`)**

```jsx
import React from 'react';

/**
 * FluentFable ProgressBar — a thin slate fill on a faint track. Optional
 * label + detail row above. Used for reading progress and review.
 */
export function ProgressBar({
  progress = 0,
  label = null,
  detail = null,
  height = 8,
  fillColor = 'var(--reader-progress-fill)',
  trackColor = 'var(--reader-progress-track)',
  style = {},
  ...rest
}) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div style={{ fontFamily: 'var(--font-ui)', ...style }} {...rest}>
      {(label || detail) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' }}>
          {label ? (
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</span>
          ) : <span />}
          {detail ? (
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{detail}</span>
          ) : null}
        </div>
      )}
      <div style={{ height, width: '100%', background: trackColor, borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: fillColor, borderRadius: 'var(--radius-pill)', transition: 'width var(--dur-tab) var(--ease)' }} />
      </div>
    </div>
  );
}
```

### StatChip

**Usage**

Compact stat block — a Fraunces value stacked over a tiny caption label. The brand's restrained alternative to streak counters.

```jsx
<StatChip value="248" label="words met" />
<StatChip value="12" label="this week" tone="neutral" />
```

**API (`StatChip.d.ts`)**

```ts
import { CSSProperties } from 'react';

/**
 * A compact stat block: a colored value over a small caption label. Used on
 * Home and Vocab to surface quiet context (words met, books, minutes) —
 * never a streak counter to chase.
 */
export interface StatChipProps {
  value: string | number;
  label: string;
  /** @default "glass" */
  tone?: 'glass' | 'accent' | 'muted';
  /** Accent color for the value glyph. @default "var(--accent)" */
  accent?: string;
  style?: CSSProperties;
}

export function StatChip(props: StatChipProps): JSX.Element;
```

**Reference implementation (`StatChip.jsx`)**

```jsx
import React from 'react';

/**
 * Noeul StatChip — a compact stat block used on Home and Vocab. A colored
 * glyph + a bold value, over a small caption. Sits on glass or a soft tint.
 * Stats are quiet context here, never a streak counter to chase.
 */
export function StatChip({ value, label, tone = 'glass', accent = 'var(--accent)', style = {}, ...rest }) {
  const tones = {
    glass: {
      background: 'var(--surface-glass)',
      border: '1px solid var(--surface-glass-border)',
      backdropFilter: 'blur(var(--glass-blur))',
      WebkitBackdropFilter: 'blur(var(--glass-blur))',
    },
    accent: { background: 'var(--accent-soft)', border: '1px solid transparent' },
    muted: { background: 'var(--surface-muted)', border: '1px solid transparent' },
  };
  const t = tones[tone] || tones.glass;

  return (
    <div
      style={{
        minWidth: 86,
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 'var(--space-xxs)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 15px',
        fontFamily: 'var(--font-ui)',
        ...t,
        ...style,
      }}
      {...rest}
    >
      <span style={{ fontWeight: 800, fontSize: '20px', lineHeight: 1.05, letterSpacing: '-0.5px', color: accent }}>{value}</span>
      <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>{label}</span>
    </div>
  );
}
```

## forms

### Input

**Usage**

Hairline text field on a white surface; focus draws the slate border. Pair with an uppercase label.

```jsx
<Input label="Email" placeholder="you@example.com" type="email" />
<Input label="Username" invalid helper="That name is taken." />
```

**API (`Input.d.ts`)**

```ts
import { CSSProperties } from 'react';

/**
 * Hairline text field on a white surface with a 3px radius; focus draws the
 * slate border. Optional uppercase label and helper/error text below.
 */
export interface InputProps {
  label?: string;
  helper?: string;
  value?: string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  invalid?: boolean;
  style?: CSSProperties;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function Input(props: InputProps): JSX.Element;
```

**Reference implementation (`Input.jsx`)**

```jsx
import React from 'react';

/**
 * Noeul Input — a frosted-glass text field with a soft hairline, 11px radius.
 * Focus draws the coral accent border. Optional label + helper text.
 */
export function Input({
  label = null,
  helper = null,
  value,
  placeholder = '',
  type = 'text',
  disabled = false,
  invalid = false,
  style = {},
  ...rest
}) {
  const [focused, setFocused] = React.useState(false);
  const borderColor = invalid
    ? 'var(--danger)'
    : focused
    ? 'var(--accent)'
    : 'var(--border-strong)';

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', fontFamily: 'var(--font-ui)', ...style }}>
      {label && (
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</span>
      )}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '15px',
          color: 'var(--text)',
          background: disabled ? 'var(--surface-muted)' : 'var(--surface-glass)',
          backdropFilter: 'blur(var(--glass-blur))',
          WebkitBackdropFilter: 'blur(var(--glass-blur))',
          border: `1px solid ${borderColor}`,
          borderRadius: 'var(--radius-sm)',
          padding: '12px 14px',
          outline: 'none',
          boxShadow: focused && !invalid ? '0 0 0 3px var(--accent-soft)' : 'none',
          transition: 'border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)',
          opacity: disabled ? 'var(--opacity-disabled)' : 1,
        }}
        {...rest}
      />
      {helper && (
        <span style={{ fontSize: '12px', color: invalid ? 'var(--danger)' : 'var(--text-tertiary)' }}>{helper}</span>
      )}
    </label>
  );
}
```

### Switch

**Usage**

Slate toggle switch — the control from flashcard and settings rows.

```jsx
<Switch checked={showHanja} onChange={setShowHanja} />
```

**API (`Switch.d.ts`)**

```ts
import { CSSProperties } from 'react';

/**
 * A toggle switch whose track fills with the coral→rose gradient when on, and
 * a frosted glass track when off. The thumb slides cream.
 */
export interface SwitchProps {
  checked?: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
  style?: CSSProperties;
}

export function Switch(props: SwitchProps): JSX.Element;
```

**Reference implementation (`Switch.jsx`)**

```jsx
import React from 'react';

/**
 * Noeul Switch — a toggle whose track fills with the coral→rose gradient when
 * on, and a frosted glass track when off. The thumb slides cream.
 */
export function Switch({ checked = false, disabled = false, onChange, style = {}, ...rest }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={{
        width: 46,
        height: 28,
        borderRadius: 'var(--radius-pill)',
        border: `1px solid ${checked ? 'transparent' : 'var(--border-strong)'}`,
        background: checked ? 'var(--gradient-accent)' : 'var(--surface-strong)',
        boxShadow: checked ? 'var(--shadow-accent)' : 'none',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 'var(--opacity-disabled)' : 1,
        transition: 'background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)',
        padding: 0,
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 20 : 2,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: '#ffffff',
          boxShadow: '0 1px 3px rgba(43,20,26,0.28)',
          transition: 'left var(--dur-fast) var(--ease)',
        }}
      />
    </button>
  );
}
```

## navigation

### SectionHeader

**Usage**

Section opener — eyebrow over a Fraunces title, with an optional action on the right.

```jsx
<SectionHeader eyebrow="Your shelf" title="Continue reading"
  action={<Button variant="text" size="sm">See all</Button>} />
```

**API (`SectionHeader.d.ts`)**

```ts
import { ReactNode, CSSProperties } from 'react';

/**
 * Section opener — uppercase eyebrow, Fraunces title, muted subtitle, with an
 * optional right-aligned action (a "See all" link or button).
 */
export interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  style?: CSSProperties;
}

export function SectionHeader(props: SectionHeaderProps): JSX.Element;
```

**Reference implementation (`SectionHeader.jsx`)**

```jsx
import React from 'react';

/**
 * FluentFable SectionHeader — an eyebrow + serif title + muted subtitle,
 * with an optional action on the right. The standard way to open a section.
 */
export function SectionHeader({ eyebrow = null, title, subtitle = null, action = null, style = {}, ...rest }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 'var(--space-md)',
        fontFamily: 'var(--font-ui)',
        ...style,
      }}
      {...rest}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xxs)' }}>
        {eyebrow && (
          <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{eyebrow}</span>
        )}
        {title && (
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: '19px', lineHeight: 1.25, color: 'var(--text)' }}>{title}</span>
        )}
        {subtitle && (
          <span style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.45 }}>{subtitle}</span>
        )}
      </div>
      {action && <div style={{ flex: 'none' }}>{action}</div>}
    </div>
  );
}
```

### TabBar

**Usage**

The app's bottom navigation — uppercase text labels, no icons. Active tab is bold with a 2px slate underline.

```jsx
<TabBar active="Read" onSelect={setTab} />
```

**API (`TabBar.d.ts`)**

```ts
import { CSSProperties } from 'react';

/**
 * The app's bottom tab bar — text-only uppercase labels with a 2px slate
 * underline on the active tab. No icons, by brand decision.
 */
export interface TabBarProps {
  /** @default ['Home','Read','Vocab','Write','Profile'] */
  tabs?: string[];
  active?: string;
  onSelect?: (tab: string) => void;
  style?: CSSProperties;
}

export function TabBar(props: TabBarProps): JSX.Element;
```

**Reference implementation (`TabBar.jsx`)**

```jsx
import React from 'react';

/**
 * Noeul TabBar — a frosted bottom navigation. Text-only labels in uppercase
 * wide tracking; the active tab is bold coral with a 2px gradient underline.
 * Words over glyphs — the bar stays quiet.
 */
export function TabBar({ tabs = ['Home', 'Read', 'Vocab', 'Write', 'Profile'], active = 'Home', onSelect, style = {}, ...rest }) {
  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 64,
        background: 'var(--surface-glass)',
        backdropFilter: 'blur(var(--glass-blur))',
        WebkitBackdropFilter: 'blur(var(--glass-blur))',
        borderTop: '1px solid var(--border)',
        fontFamily: 'var(--font-ui)',
        ...style,
      }}
      {...rest}
    >
      {tabs.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onSelect && onSelect(tab)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              paddingBottom: 18,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                fontSize: '10px',
                fontWeight: isActive ? 700 : 500,
                letterSpacing: '1.8px',
                textTransform: 'uppercase',
                color: isActive ? 'var(--accent)' : 'var(--text-subtle)',
                paddingBottom: isActive ? 5 : 7,
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {tab}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
```

## reading

### BookCover

**Usage**

The signature slate book cover — generated when a book has no artwork. Left spine, two cream rules, serif title. Korean titles auto-use the KR serif.

```jsx
<BookCover title="운수 좋은 날" author="현진건" />
<BookCover title="The Wings" author="Yi Sang" width={140} height={200} />
```

Pass `field` / `spine` / `ink` to tint a cover from an imported book's extracted palette.

**API (`BookCover.d.ts`)**

```ts
import { CSSProperties } from 'react';

/**
 * The generated default book cover — a warm sunset gradient field with a soft
 * top-right glow, a dark left edge, and the title set bottom-left. The brand's
 * signature object; covers a 2:3 aspect by default. Korean titles auto-switch
 * to the KR reading serif.
 */
export interface BookCoverProps {
  title?: string;
  author?: string;
  /** @default 172 */
  width?: number;
  /** @default 244 */
  height?: number;
  /** Cover field — any CSS background (defaults to the sunset cover gradient). */
  field?: string;
  /** Ink color for title + author (defaults to cream). */
  ink?: string;
  style?: CSSProperties;
}

export function BookCover(props: BookCoverProps): JSX.Element;
```

**Reference implementation (`BookCover.jsx`)**

```jsx
import React from 'react';

/**
 * Noeul BookCover — the generated default cover: a warm sunset gradient field
 * with a soft top-right glow, a dark left edge, and the title set bottom-left.
 * The brand's signature object. Korean titles render in the KR reading serif.
 */
export function BookCover({
  title = 'Untitled',
  author = '',
  width = 172,
  height = 244,
  field = 'var(--gradient-cover)',
  ink = '#ffffff',
  style = {},
  ...rest
}) {
  const isKorean = /[\u3131-\u318e\uac00-\ud7a3]/.test(title);
  const scale = Math.min(width / 172, height / 244);
  const titleSize = Math.max(15, Math.round(24 * scale));
  const pad = Math.round(16 * scale);

  return (
    <div
      style={{
        width,
        height,
        background: field,
        borderRadius: Math.round(13 * scale),
        boxShadow: 'var(--shadow-cover)',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: pad,
        ...style,
      }}
      {...rest}
    >
      {/* top-right sun glow */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(130% 90% at 82% 2%, rgba(255,255,255,0.30), transparent 56%)' }} />
      {/* dark left edge */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.max(4, Math.round(6 * scale)), background: 'rgba(0,0,0,0.16)' }} />
      {author && (
        <span
          style={{
            position: 'relative',
            fontFamily: 'var(--font-ui)',
            fontSize: Math.max(8, Math.round(10 * scale)),
            fontWeight: 700,
            letterSpacing: Math.max(1.2, 1.4 * scale),
            textTransform: 'uppercase',
            color: ink,
            opacity: 0.82,
            marginBottom: Math.round(6 * scale),
          }}
        >
          {author}
        </span>
      )}
      <span
        style={{
          position: 'relative',
          fontFamily: isKorean ? 'var(--font-kr)' : 'var(--font-display)',
          fontWeight: isKorean ? 600 : 500,
          fontSize: titleSize,
          lineHeight: 1.2,
          color: ink,
        }}
      >
        {title}
      </span>
    </div>
  );
}
```

### WordChip

**Usage**

An inline reading-text word with its highlight state. Drop several inside a reading paragraph to recreate the reader's marked text.

```jsx
<p style={{ fontFamily: 'var(--font-kr)', fontSize: 22 }}>
  그는 <WordChip state="same">날개</WordChip>가 돋친 듯이{' '}
  <WordChip state="tapped">운수</WordChip> 좋은 날을 기다렸다.
</p>
```

States: `same` / `above` / `unknown` (underlines), `tapped` / `saved` (slate pills), `plain`.

**API (`WordChip.d.ts`)**

```ts
import { ReactNode, CSSProperties } from 'react';

/**
 * A single word of reading text with its highlight state — the underline keys
 * (level-same green, level-above amber, unknown dotted) or the tapped/saved
 * slate pill. Inherits font size so it sits inline in a reading paragraph.
 */
export interface WordChipProps {
  children?: ReactNode;
  /** @default "plain" */
  state?: 'plain' | 'same' | 'above' | 'unknown' | 'tapped' | 'saved';
  /** Use the Korean reading serif. @default true */
  korean?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
}

export function WordChip(props: WordChipProps): JSX.Element;
```

**Reference implementation (`WordChip.jsx`)**

```jsx
import React from 'react';

/**
 * FluentFable WordChip — a token of reading text with a level underline, or
 * the tapped/saved slate pill. The reader's core interaction made reusable.
 */
export function WordChip({ children, state = 'plain', korean = true, style = {}, ...rest }) {
  const base = {
    fontFamily: korean ? 'var(--font-kr)' : 'var(--font-ui)',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    color: 'var(--reader-body-ink)',
    cursor: 'pointer',
    transition: 'background-color var(--dur-fast) var(--ease)',
  };
  const states = {
    plain: {},
    same: { borderBottom: '2px solid var(--reader-level-same)', paddingBottom: 1 },
    above: { borderBottom: '2px solid var(--reader-level-above)', paddingBottom: 1 },
    unknown: { borderBottom: '2px dotted var(--reader-unknown)', paddingBottom: 1 },
    tapped: { background: 'var(--reader-tapped-bg)', color: 'var(--reader-tapped-text)', borderRadius: 'var(--radius-xs)', padding: '1px 6px', boxShadow: '0 4px 13px var(--accent-muted)' },
    saved: { background: 'var(--reader-saved-bg)', color: 'var(--reader-saved-text)', borderRadius: 'var(--radius-xs)', padding: '1px 6px' },
  };
  return (
    <span style={{ ...base, ...(states[state] || states.plain), ...style }} {...rest}>
      {children}
    </span>
  );
}
```
