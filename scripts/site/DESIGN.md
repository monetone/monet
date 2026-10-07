---
name: Monet Progress Board (site/)
description: The public build-progress page, dressed by Monet UI — an inspector panel stack that reports on the suite in the suite's own vocabulary.
colors:
  desktop-0: "#0b0e14"
  desktop-2: "#1a1f2c"
  glass-0: "rgba(255, 255, 255, 0.04)"
  glass-1: "rgba(255, 255, 255, 0.06)"
  glass-2: "rgba(255, 255, 255, 0.09)"
  stroke-soft: "rgba(255, 255, 255, 0.06)"
  stroke-medium: "rgba(255, 255, 255, 0.10)"
  stroke-strong: "rgba(255, 255, 255, 0.16)"
  hi-top: "rgba(255, 255, 255, 0.22)"
  text-1: "rgba(255, 255, 255, 0.92)"
  text-2: "rgba(255, 255, 255, 0.62)"
  text-3: "rgba(255, 255, 255, 0.52)"
  text-disabled: "rgba(255, 255, 255, 0.30)"
  accent-raster: "oklch(0.78 0.14 200)"
  accent-vector: "oklch(0.80 0.14 70)"
  accent-audio: "oklch(0.74 0.16 305)"
  accent-motion: "oklch(0.75 0.18 350)"
  accent-game: "oklch(0.80 0.16 150)"
  alarm-red: "oklch(0.72 0.17 25)"
  chrome-veil: "rgba(11, 14, 20, 0.72)"
  matrix-head-veil: "rgba(14, 18, 26, 0.94)"
  matrix-sticky: "#12151d"
  matrix-sticky-hover: "#191d27"
  recess: "rgba(0, 0, 0, 0.16)"
  wash-cool: "rgba(70, 130, 190, 0.16)"
  wash-warm: "rgba(150, 70, 160, 0.10)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Display\", \"Inter Display\", system-ui, sans-serif"
    fontSize: "clamp(30px, 4.6vw, 56px)"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "-0.033em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Display\", \"Inter Display\", system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.018em"
  lede:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Inter\", system-ui, sans-serif"
    fontSize: "clamp(15px, 1.35vw, 17px)"
    fontWeight: 400
    lineHeight: 1.62
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Inter\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Inter\", system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.08em"
  mono:
    fontFamily: "\"JetBrains Mono\", \"SF Mono\", ui-monospace, Menlo, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    fontFeature: "tabular-nums"
rounded:
  window: "14px"
  panel: "10px"
  control: "7px"
  pill: "999px"
  meter: "2px"
  meter-lg: "3px"
  squircle: "24%"
spacing:
  gutter: "clamp(20px, 5vw, 64px)"
  panel-inset: "22px"
  panel-inset-narrow: "16px"
  panel-gap: "clamp(44px, 6vw, 80px)"
  opening-top: "clamp(56px, 11vw, 128px)"
  hairline: "0.5px"
components:
  panel:
    backgroundColor: "{colors.glass-1}"
    rounded: "{rounded.window}"
  panel-head:
    backgroundColor: "{colors.recess}"
    padding: "18px 22px 16px"
  section-label:
    textColor: "{colors.text-3}"
    typography: "{typography.label}"
  chrome:
    backgroundColor: "{colors.chrome-veil}"
    height: "48px"
  meter-track:
    backgroundColor: "{colors.glass-0}"
    height: "4px"
    rounded: "{rounded.meter}"
  meter-track-lg:
    height: "6px"
    rounded: "{rounded.meter-lg}"
  meter-track-sm:
    height: "3px"
  meter-fill-built:
    backgroundColor: "color-mix(in oklch, var(--accent) 34%, transparent)"
  meter-fill-covered:
    backgroundColor: "var(--accent)"
  chip-maturity:
    backgroundColor: "{colors.glass-1}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.pill}"
    height: "22px"
    padding: "0 10px"
  chip-maturity-production:
    backgroundColor: "color-mix(in oklch, var(--accent) 20%, transparent)"
    textColor: "{colors.text-1}"
  gap-pill:
    backgroundColor: "{colors.glass-0}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  matrix-cell:
    rounded: "{rounded.control}"
    size: "26px"
  strip-app:
    backgroundColor: "{colors.glass-0}"
    padding: "22px 10px 18px"
  strip-app-hover:
    backgroundColor: "{colors.glass-2}"
---

# Design System: Monet Progress Board (site/)

**Scope: this file documents `site/` only — the public build-progress web page.**
It is not a description of the Monet UI design system and must not be read as one.

**The authority is Monet UI**, at
`packages/monet-ui/packages/monet-core/tokens.css` and `styles.css`. This page
inherits that world rather than inventing one; PRODUCT.md records it as a brand
commitment ("the suite dresses itself"). Everything below is one of three things,
and each is labelled as such:

- **Adopted** — a token or component metric copied verbatim from Monet UI.
- **Deviated** — a Monet UI value this surface deliberately changed, with the reason.
- **Introduced** — a pattern that exists here and nowhere in the app design system.

When Monet UI changes, the adopted values here should change with it. The deviations
and introductions are this surface's own and are the parts to think about before editing.

**Source of truth for the CSS is `scripts/site/build.mjs`** — the whole stylesheet
lives in its `css()` function and is inlined into `site/index.html` at generation
time. Edit the generator, never `index.html`. As of this writing the two are
byte-identical.

## Overview

**Creative North Star: "The Suite's Own Inspector Dock"**

The page refuses the card-grid-of-apps that every status page ships. Instead it
renders as one of the tools it reports on: a stack of full-width inspector panels
under a sticky 48px window chrome, where each app is a row of readouts and each
feature area is a labelled meter. The argument is that a tool reporting on itself
should speak in the vocabulary it already uses to report a value — so a
completion percentage is drawn the way Monet UI draws a slider, not the way a
marketing page draws a progress bar.

Density is deliberately app-like rather than web-like: 0.5px hairlines instead of
gaps, 10–13px labels, tabular monospace for every number, and a single lifted
plane per panel. The one concession to the web is reading size — body text is 14px
here against Monet UI's 12px window base, because this is read at browser distance
by someone who is not already inside the app.

The material is Monet UI's whole: a cool near-black desktop, three glass depths,
hairline strokes, a 14px window radius, and per-app accents that tint highlights
and never structure. Nothing here is skeuomorphic and nothing is decorative — the
one authored animation exists to make a number's arrival legible, not to entertain.

**Key Characteristics:**
- Inspector panel stack, not a card grid — full-width panels, hairline-separated.
- Every number is monospace and tabular; every percentage is also drawn.
- Accent tints highlights only; all structure is neutral stroke tokens.
- Exactly one drop shadow (the panel) and exactly one authored motion (the meter).
- Dark only. No light theme, despite Monet UI shipping one.

## Colors

The palette is Monet UI's dark desktop, unaltered in hue and altered in exactly one
place: the third text tint.

### Primary

The five per-app accents are the only chromatic elements. They are assigned per
scope through `--accent`, which every component on the page reads — the same
contract Monet UI's components use. The page default is raster; each app panel and
each matrix column sets its own via an inline `--accent` and everything inside it
retints. Accents are shared by discipline, not unique per app: two apps carry
raster, two carry motion.

- **Raster Cyan** (`accent-raster`): *Adopted.* The page-level default accent.
- **Vector Amber** (`accent-vector`): *Adopted.*
- **Audio Violet** (`accent-audio`): *Adopted.*
- **Motion Magenta** (`accent-motion`): *Adopted.*
- **Jouer Green** (`accent-game`): *Introduced here, adopted from an app.* This is
  the one accent that does **not** exist in `tokens.css`, which defines only four.
  It is declared in `apps/jouer/src/styles.css`, where Jouer registers it and forces
  it onto `--accent` so the shared components theme green. Carried onto this page so
  Jouer shows its real color. **This is a finding about the suite, not a new shared
  token:** the design system has four accent identities and the suite ships five.
  Do not treat `accent-game` as promotable to `tokens.css` without that decision
  being made properly upstream.

### Tertiary

- **Alarm Red** (`alarm-red`): *Introduced.* Used once, on the `+N failing` count
  beside a test total. It is declared inline in the rule, not as a token, and it is
  the only hue on the page outside the accent family. If a second failure state ever
  needs a color, promote this to a token first.

### Neutral

All *adopted* verbatim from `tokens.css` unless noted:

- **Desktop Ground** (`desktop-0`): the page background, washed by two large radial
  gradients (`wash-cool` at 12%/-10%, `wash-warm` at 92%/4%, both `fixed`). *Deviated:*
  Monet UI applies an equivalent wash inside `.monet-window::before` at different
  values and positions; this page paints its own on `body` at a scale suited to a
  full viewport.
- **Glass 0 / 1 / 2** (`glass-0`, `glass-1`, `glass-2`): the three surface depths in
  use — meter tracks and gap pills at 0, panels and chips at 1, hover at 2.
- **Strokes** (`stroke-soft`, `stroke-medium`, `stroke-strong`): every divider, border
  and separator on the page. `stroke-soft` is the workhorse (15 uses); it is the
  hairline that does all the structural work. `stroke-strong` is now down to three uses —
  the skip-link ring and the matrix scrollbar thumb. It is a **stroke** token; it was
  briefly used to tint a glyph and failed the contrast floor doing so. Do not use it as a
  foreground color.
- **Top Highlight** (`hi-top`): the `inset 0 0.5px 0` catchlight on the chrome, the
  panels, and the missing-icon placeholder.
- **Text 1 / 2** (`text-1`, `text-2`): primary and secondary text, adopted unchanged.
  16.3:1 and 7.7:1 on the desktop ground.

**Deviated — the two text tints:**

- **Text 3** (`text-3`) is **0.52 here, 0.38 in Monet UI.** On this page every slot
  that uses it carries real information at small size — feature-area detail, capability
  notes, counts, the measurement date, column headers. Monet UI's 0.38 measures about
  3.5:1 on `#0b0e14` (the build's own comment records 3.3:1; either figure is below the
  4.5:1 floor PRODUCT.md commits to). Raised to 0.52 it measures 5.7:1 on the flat
  ground and 5.4:1 over the brightest part of the gradient wash. **In the desktop app
  chrome the original 0.38 stands** — there it dresses inert chrome labels next to the
  thing they label, which is a different problem.
- **Text Disabled** (`text-disabled`) is **0.30 here, 0.22 in Monet UI**, raised for
  the same reason. It measures 2.6:1, which is below the readable floor either way, so it
  survives on this page in exactly two places, both of them separator dots: the `·` in an
  app's subtitle and the `·` between the two numbers in a suite-strip cell. Neither carries
  information — the text either side of it does. Separator glyphs are the only thing
  `--text-disabled` is permitted to dress here.

### Introduced — the opaque sticky set

Three colors exist only because a sticky element cannot be translucent without
smearing the content scrolling under it:

- **`matrix-sticky` / `matrix-sticky-hover`**: the frozen capability row-label column.
- **`matrix-head-veil`**: the matrix header row.
- **`chrome-veil`**: `desktop-0` at 72%, under a `blur(24px) saturate(160%)`.

These are hand-picked opaque neighbours of the desktop tones, not tokens. If the
desktop tones ever change, these four values must be re-picked by hand.

### Named Rules

**The Accent-Tints-Never-Structures Rule.** Inherited verbatim from `tokens.css`
("only used in highlights, never structural") and held throughout: accents appear
in meter fills, capability glyphs, the production chip, focus rings and link hover.
Every border, divider and separator on this page is a neutral stroke token. Never
draw a line in an accent.

**The Raised Third Tint Rule.** `--text-3` is 0.52 on this surface and 0.38 in the
app. The difference is not drift — it is the price of using that tint for content
instead of chrome. If you find yourself adding a `--text-3` slot that carries no
information, use `--text-2` or restructure; do not lower the token back.

**The One Alarm Rule.** Red appears exactly once on this page, on a failing test
count. Anything else that wants to be red is asking to be a percentage instead.

## Typography

**Display Font:** the system display stack, `--font-display` (SF Pro Display / Inter Display)
**Body Font:** the system UI stack, `--font-ui` (SF Pro Text / Inter)
**Label/Mono Font:** `--font-mono` (JetBrains Mono / SF Mono)

All three stacks are *adopted* verbatim.

**No webfont — a decision, not an omission.** Monet UI pins the system stack, and the
publish folder is uploaded as-is with no build step and no runtime dependency, so there is
nowhere for a font file to come from and nothing permitted to fetch one. Do not add an
`@import` or a font `<link>`.

The consequence is real and should be understood rather than discovered: **the page only
looks like the apps on Apple hardware.** A Windows reader gets Segoe UI, a Linux reader
gets Roboto or whatever the system resolves, and `JetBrains Mono` is only used if the
reader happens to have it installed — otherwise the numbers fall through to SF Mono,
`ui-monospace`, or Menlo. Every metric on this page is chosen to survive that: nothing
depends on a specific glyph width, the mono readouts are boxed to a `34px` minimum rather
than measured in `ch`, and `tabular-nums` is requested from whatever font arrives. If you
change type sizes, check the result in a non-Apple stack before calling it done.

**Character:** the native macOS voice, used quietly. Display weight never exceeds 600,
tracking tightens as size grows (`-0.033em` at the headline, `-0.018em` at 19px,
`-0.005em` at 12.5px), and every quantity switches to monospace so columns of numbers
align down the page.

### Hierarchy

- **Display** (600, `clamp(30px, 4.6vw, 56px)`, 1.06, `-0.033em`): the single `h1`.
  Capped at `21ch` with `text-wrap: balance` so it breaks into three even lines.
- **Headline** (600, 19px, 1.2, `-0.018em`): the app name in each panel header.
- **Lede** (400, `clamp(15px, 1.35vw, 17px)`, 1.62): the two opening paragraphs, capped
  at `--measure` (68ch).
- **Body** (400, 14px, 1.5): the page base. *Deviated:* Monet UI's `.monet-window` base
  is 12px. Reading distance, not app density.
- **Label** (600, 10px, `0.08em`, uppercase, `text-3`): *Adopted verbatim* from
  `.monet-section-label`, which is 10px/600/0.08em/uppercase/`--text-3`. Only the margin
  differs (0 here, `4px 0 8px` there). Used for every panel heading, the feature-area
  column header, and the "Not yet" label.
- **Mono readout** (400, 11.5px, `tabular-nums`): the built/tested percentages. Smaller
  monospace variants at 12px (per-app stats), 12.5px, 10.5px (strip totals, measurement
  date) and 9.5px (the `%` sign, dimmed to `text-3`).

### Named Rules

**The Tabular Readout Rule.** Every number on this page is `--font-mono` with
`font-variant-numeric: tabular-nums` — measurement date, strip percentages, area
readouts, suite totals, per-app file and test counts. Prose is never monospace and
numbers are never proportional. This is what lets 60-odd meters read as one column.

**The Two-Number Rule.** A percentage never appears alone. Built and tested are always
adjacent, in a fixed order, with built in `text-2` and tested in `text-1` so the eye
can tell them apart without reading the header. Each is right-aligned in a `34px`
minimum box.

## Layout

A single centred column, `max-width: 1440px`, with a fluid `--gutter` of
`clamp(20px, 5vw, 64px)`. Prose is separately capped at `--measure: 68ch`; the method
columns tighten further to `46ch`. Both are *introduced* — Monet UI has no measure token
because app panels are never this wide.

The page is a stack, not a grid. Sections are panels separated by `clamp(44px, 6vw, 80px)`;
inside a panel, rows are separated by a 0.5px `stroke-soft` hairline with no gap at all.
The app list is one continuous dock: `.panel-apps` has no bottom padding and each `.app`
carries a `border-top` hairline, with the first suppressed — the same adjacency rule
`.monet-panel + .monet-panel` uses in Monet UI.

Internal padding is `22px` at the sides on desktop, dropping to `16px` below 720px. This
is the page's one horizontal rhythm; panel heads, the matrix key, the method block, the
foundation rows and the app panels all sit on it.

Three grids do the real work:

- **The suite strip**: `repeat(7, 1fr)` with a `1px` gap over a `stroke-soft` background,
  so the gap itself draws the dividers. It reflows to 4 columns at 1080px and then **stops
  being a grid at 720px** — `grid-template-columns: 1fr`, with each cell turning into a
  horizontal row (34px icon, name, meter, numbers). See the rule below; this is deliberate
  anti-pattern avoidance, not a responsive convenience.
- **The app header**: `56px | 1fr | auto | minmax(190px, 260px)` — icon, identity, maturity
  chip, master meter. Below 1080px the meter drops to its own full-width row and turns
  horizontal; below 720px the chip does too.
- **The feature-area row**: `minmax(120px, 168px) | minmax(90px, 1fr) | auto | minmax(0, 1.35fr)`
  — name, meter, readouts, detail. Below 1080px the detail wraps to a full-width line;
  below 460px the meter does.

The capability matrix scrolls horizontally inside its own container, which carries a
**styled thin scrollbar** (`scrollbar-width: thin`, an 8px WebKit track, `stroke-strong`
thumb) as its scroll cue — without one, the only signal that the table continues is a
column clipped at the panel edge, which reads as a rendering bug rather than an invitation.

Its row-label column freezes (`position: sticky; left: 0`, opaque `#12151d`, `::after`
hairline) **only inside `@media (max-width: 1080px)`** — the widths where the table actually
overflows. Pinning it at desktop painted an opaque panel-within-a-panel seam down a table
that already fit.

Breakpoints: 1080px, 900px (method columns collapse), 860px (chrome legend hides), 720px,
460px. *Introduced* — Monet UI has no breakpoints; it renders in a fixed window.

### Named Rules

**The Hairline Stack Rule.** Separation on this page is a 0.5px `stroke-soft` line, never
a gap and never a card. If two things need distinguishing, put a hairline between them and
keep them the same width.

**The Readout-Row-At-Every-Width Rule.** The suite strip is a row of readouts, not a grid of
cards, at every viewport. Seven items never divide evenly into 2 or 3 columns, so the obvious
narrow-screen reflow produces both visible empty cells and — worse — exactly the
card-grid-of-apps scaffold this page's thesis refuses. Below 720px it becomes one readout per
row, which is what the strip always meant. Do not restore a 2- or 3-column grid at any width.

## Elevation & Depth

Almost flat. Depth is carried by tonal layering — three glass tints over a dark ground —
plus a 0.5px top catchlight, exactly as in the app. There is **one** surface shadow on the
whole page.

### Shadow Vocabulary

- **Panel lift** (`box-shadow: 0 24px 80px -8px rgba(0, 0, 0, 0.55), inset 0 0.5px 0 var(--hi-top)`):
  the only elevated surface. *Deviated:* Monet UI's `--shadow-window` is three layers
  (`0 24px 80px -8px`, `0 8px 24px -4px`, and a `0 0 0 0.5px` white ring). This page keeps
  the first layer and replaces the rest with the top catchlight, since the panel already
  carries a real `0.5px` border.
- **Icon lift** (`drop-shadow(0 6px 14px rgba(0,0,0,0.45))` in the strip,
  `drop-shadow(0 6px 16px rgba(0,0,0,0.5))` in app headers): *Introduced.* App icons are
  PNGs with transparency, so they take a `filter` drop-shadow rather than a box-shadow.
- **Accent glow** (`box-shadow: 0 0 8px var(--accent)`): on the meter's lit fill only.
  *Adopted verbatim* from `.monet-slider .fill`.
- **Track recess** (`inset 0 0.5px 0 rgba(0, 0, 0, 0.3)`): *Adopted verbatim* from
  `.monet-slider`.

Blur is used at two strengths, both inlined as literal values rather than referenced as
tokens (the page's `:root` does not declare `--blur-*`): `blur(40px) saturate(180%)` on
panels — Monet UI's `--blur-strong`, and the same value `.monet-panel` uses — and
`blur(24px) saturate(160%)` on the sticky chrome, which is `--blur-medium`.

### Named Rules

**The Single Lifted Plane Rule.** Only `.panel` leaves the desktop. Nothing nested inside a
panel gets its own shadow — rows, chips, cells and meters are all drawn with hairlines,
tonal fills and inset highlights. If a new element seems to need a shadow, it probably wants
to be a panel or wants a hairline.

## Shapes

Four radii, all *adopted*: `14px` for the panel (Monet UI's window radius), `10px` for the
suite strip, `7px` for controls — the capability cell, the focus ring, the skip link — and
the pill for status badges. Three more exist and each has a reason: `2px` and `3px` on the
meter tracks (a 4px and a 6px track, fully rounded), and `24%` on the missing-icon
placeholder, which is the squircle proportion of the real app icons.

The form language is rectangles with soft corners and hairline edges. Nothing is circular
except the meter track ends; there are no capsules other than the two badge families, no
angled edges, and no clipping tricks — except one: the missing-icon placeholder is filled
with a `-45deg` repeating stripe at `rgba(255,255,255,0.05)`, so an app with no icon of its
own says so rather than borrowing another app's.

## Components

### The Two-Stage Meter — *Introduced. This surface's one genuinely new component.*

The signature element, and the thing to understand before editing anything else.

- **Structure:** one track carrying two fills. A faint fill scaled to `built`, and a lit
  fill scaled to `built × tested`.
- **Why the product:** test coverage is expressed as a share of what exists, not of the
  whole feature area. An app that is 20% built with 90% of that tested must not be able to
  render a nearly-full bar. The two raw percentages are printed beside the meter, so the
  drawing and the numbers say the same thing.
- **Track:** *adopted verbatim* from `.monet-slider` — `height: 4px`, `border-radius: 2px`,
  `background: var(--glass-0)`, `box-shadow: inset 0 0.5px 0 rgba(0,0,0,0.3)`. Two size
  variants: `meter-lg` at 6px (app master), `meter-sm` at 3px (suite strip, chrome legend).
- **Faint fill:** `color-mix(in oklch, var(--accent) 34%, transparent)`.
- **Lit fill:** `var(--accent)` at `opacity: 0.92`, with `box-shadow: 0 0 8px var(--accent)`
  *inherited verbatim* from `.monet-slider .fill`. (Monet UI's slider fill sits at
  `opacity: 0.85`; this is the one numeric difference.)
- **Load-bearing implementation detail:** both fills are full-width boxes squeezed with
  `transform: scaleX()` from `transform-origin: left center`, **never `width`**. There are
  82 meters down a very long page; animating width would run layout on all of them. The
  scale factors are emitted into the markup as unitless custom properties (`--built`,
  `--covered`). **Do not convert these to width-based fills.**
- **Default state is the answered state.** `.meter .built` and `.meter .covered` render at
  `scaleX(var(--built))` and `scaleX(var(--covered))` in the base stylesheet, with no script
  involved. A one-line inline script in `<head>` sets `document.documentElement.className = "js"`,
  and `.js .meter .built, .js .meter .covered { transform: scaleX(0) }` is the **only** thing
  that rewinds them so they can animate in. Every animation rule is correspondingly scoped:
  `.js .is-lit .meter …`, and the legend's always-filled exemption is `.js .legend .meter …`.

**The Answered-By-Default Rule.** The meter's resting CSS is its filled state; `.js` is what
empties it. Invert that — put `scaleX(0)` in the base rule and the value behind a class — and
a host CSP that blocks the inline script silently serves 82 empty bars on a page whose entire
job is showing numbers. This is the single easiest thing to break here while making a change
that looks correct in a browser with scripting on. If you touch the meter, load the page with
JavaScript disabled and confirm the bars are still full.

### Readout Labels — *Introduced.*

Each percentage beside a meter carries **two** labels, not one:

- A verbose `.sr-only` label for assistive tech (`" built"`, `" of that covered by tests"`),
  present at every width.
- A one-word `.mini` label (`built`, `tested`) — `aria-hidden`, `display: none` by default,
  `font-ui` at 9px with `0.04em` tracking in `text-3`, so it reads as a label rather than a
  second number. It becomes `display: inline` at ≤460px, where the `.area-head` BUILT/TESTED
  column header is itself hidden. Its spacing comes from its own `margin-left: 3px`, not
  from the row's flex `gap`, which is zeroed at that width — a gap would also push the `%`
  sign away from the number it belongs to.

The reason is scroll distance, not width: an app's feature-area list runs well past ten rows,
so on a phone the column header has left the screen long before the numbers have. Rather than
ask the reader to remember which of two adjacent percentages is which, each number carries its
own word at exactly the width where the header stops helping.

### The Capability Matrix Glyphs — *Introduced.*

Four states, drawn as SVG in one stroke weight. No emoji, no typographic substitutes, no
check marks. All four are authored in a 12-unit `viewBox` and **rendered at 14px** in the
table (11px in the key below it).

- **Present:** solid rounded square (`rx 2.5`), filled `currentColor`.
- **Partial:** the same square, half filled, outline at `stroke-width: 1`.
- **Absent:** outline only.
- **Not applicable:** a centred horizontal rule.

Tinting is *not* uniform: present takes the column app's accent, partial takes that accent
at 62%, and **both negative states are `text-3`** — neutral, so absence never reads as an
app's color, but not faint. Absent was previously `stroke-strong`, which measured 1.65:1 on
the panel ground, under the **3:1 that WCAG 1.4.11 asks of a meaningful graphic**. At
`text-3` it measures 5.5:1. That 3:1 floor is the binding constraint here, and it applies
with particular force to this glyph: on a page built to show gaps, "absent" is the mark a
contributor is actually shopping for, so it must not be the faintest thing in the grid.

Shape is still the primary channel rather than tint. Each cell carries `role="img"` with a
full `aria-label` (`"App — Capability: Absent. note"`) and `tabindex="0"`, so all 70 notes
are reachable by keyboard rather than by mouse hover alone. Keep both attributes if you
change the glyphs.

### App Screenshots — *Introduced.*

Each app panel opens with a two-column `.app-intro` grid — `minmax(0, 1.15fr) minmax(0, 1fr)`,
`align-items: start` — screenshot left, description and the "Not yet" gap pills right. The gaps
were moved up out of `.app-foot` for this: with the prose alone the right column left a tall
void beside a 16:9 image. Below 1080px the grid collapses to one column.

The image sits in `figure.shot`, wrapped in an `<a>` to the full-size file. The frame is a
`--radius-panel` clip with `overflow: hidden`, a `0 18px 44px -12px` shadow and a `0.5px`
inset stroke; on hover it lifts 2px and the inset stroke takes 40% of the app's accent — the
only place a screenshot picks up its app's colour. `figcaption` is `text-3` at 10.5px.

Every image is `loading="lazy"` with explicit `width`/`height` so the panel does not reflow as
it loads. Sources are WebP at 1440px wide, q78 — roughly 2x the ~620px display width, and 15–60KB
each, so all seven together come to 228KB against the icon set's 418KB.

**The rule that matters is not visual:** these are real captures of the running apps, produced
by `scripts/site/shots.mjs`, which only resizes and re-encodes. An app with no usable capture
sets no `shot` and its prose takes the full width via `.is-textonly` — there is deliberately no
placeholder, no gradient stand-in and no mock-up. Every app has a capture today. If you ever
find yourself sourcing an image for this slot from anywhere but a running app, the pattern has
been broken.

### Panels

- **Corner:** `14px` (`--radius-window`).
- **Background:** `glass-1` under `blur(40px) saturate(180%)` — *adopted* from `.monet-panel`.
- **Border:** `0.5px solid var(--stroke-soft)`.
- **Shadow:** the panel lift; see Elevation.
- **Header band:** `padding: 18px 22px 16px`, `background: rgba(0, 0, 0, 0.16)`,
  `border-bottom: 0.5px solid var(--stroke-soft)` — this recessed treatment is *adopted*
  from `.monet-tabs`, the app's in-panel tab strip, which uses the same fill and the same
  bottom hairline.

### Status Chips

- **Maturity chip:** `height: 22px`, `padding: 0 10px`, pill radius, `glass-1`,
  `10.5px/500`, `inset 0 0 0 0.5px var(--stroke-medium)`. Text color steps down by
  maturity: production and beta at `text-1`, alpha at `text-2`, scaffold at `text-3`. The
  production variant additionally fills with `color-mix(in oklch, var(--accent) 20%, transparent)`
  and rings itself at 45%.
- *Deviated:* Monet UI's `.monet-chip` is `24px` tall with `--radius-control` (7px), `text-1`,
  11px, and an `inset 0 0.5px 0 var(--hi-top)` catchlight. This page's chip is shorter,
  fully rounded, and hairline-ringed instead of catchlit. The build records no rationale for
  the divergence; recorded as observed.
- **Gap pill** (the "Not yet" items): the same badge family — pill radius, `glass-0`,
  `3px 9px`, `inset 0 0 0 0.5px var(--stroke-soft)`, `text-2`.

### Links and Interactive Rows

- **Suite strip cell:** icon, name, meter and both percentages on `glass-0` — stacked as a
  column at wide widths, relaid as a horizontal row below 720px. Hover lifts to `glass-2`
  over `0.18s ease` and the icon rises `translateY(-2px) scale(1.03)` over
  `0.22s cubic-bezier(0.2, 0.8, 0.2, 1)`; the icon lift is dropped in the row layout, where
  there is no room for it to travel. Both easings are Monet UI's idiom (`0.18s ease` and
  `cubic-bezier(.2,.8,.2,1)` appear throughout `styles.css`). The two numbers follow the
  page's built/tested convention — `.n-built` in `text-2`, `.n-tested` in `text-1`, separated
  by a `text-disabled` dot.
- **Matrix column header:** an anchor that takes `var(--accent)` on hover — the only place
  text turns accent-colored.
- **Focus — two rings, deliberately.** The general one, `:where(a, .cell-in):focus-visible`,
  is **outset**: `0 0 0 1px accent@75%` plus `0 0 0 4px accent@26%` at `--radius-control`,
  with `outline: none`. *Deviated:* Monet UI's ring is `inset 0 0 0 1px accent@70%` plus
  `0 0 0 3px accent@28%` — same two-layer accent pattern, outset inner ring and slightly
  different values here.
  **`.strip-app:focus-visible` is the exception and uses an inset ring**:
  `inset 0 0 0 2px accent@80%` plus `inset 0 0 0 5px accent@22%`. The strip clips its
  overflow and its cells paint edge to edge, so an outset ring is both cut off at the
  container boundary and painted over by the next sibling cell. This is the page's primary
  navigation, so the ring goes on the inside where it survives. Do not fold this back into
  the general selector.
- **Skip link:** hidden via `.sr-only`, and on focus becomes a fixed `desktop-2` chip at
  top-left with a `stroke-strong` ring.

### Chrome Strip

`48px` tall — *adopted*, this is `--monet-h-titlebar-mac`, the app title bar height. Sticky,
`chrome-veil` under `blur(24px) saturate(160%)`, a bottom hairline and a `hi-top` inset
catchlight. Contents: wordmark, a title separated by a left hairline, spacer, the
illustrative legend meter, and the measurement date in mono. Below 860px the legend and
title are hidden and only the wordmark and date remain.

### Motion

Motion belongs to the meter, so it is documented here rather than as a world of its own.
There is exactly one authored moment on the entire page.

Meters settle into value on scroll-into-view. An `IntersectionObserver`
(`rootMargin: "0px 0px -12% 0px"`, `threshold: 0.12`) adds `.is-lit` to three group types —
`.areas`, `.strip`, `.app-master` — and unobserves immediately, so it fires once. The fills
transition `transform` over `0.7s cubic-bezier(0.16, 1, 0.3, 1)`, an exponential ease-out.
Within a `.areas` group the meters stagger by `32ms` each, capped at `240ms`, and the lit
fill trails its own faint fill by a further `100ms`.

The values are already in the markup — the animation only animates their arrival and never
gates the content. Every animating rule is scoped under `.js` (see the Answered-By-Default
Rule), so with scripting off the meters are simply drawn at value and nothing moves. Under
`prefers-reduced-motion: reduce` the script calls `lightAll()` immediately so every meter is
pre-filled at its real value, and the stylesheet clamps all durations to `0.001ms`. The same
pre-filled path runs when `IntersectionObserver` is absent.

Everything else on the page is instant except two hover transitions on the suite strip.

### Named Rules

**The One Moment Rule.** This page has one authored animation and it is attached to **one
component class**. It is not a page-entrance system: sections do not fade in, panels do not
rise on scroll, and nothing staggers except meters within a single app's feature list. The
scroll observer exists to time the meter, not to animate the document. Do not add a second
moment, and do not generalize this one into a per-section entrance — the restraint is what
makes the single movement legible as a reading rather than as decoration. If something new
needs to feel alive, give it the strip's `0.18s ease` hover and nothing more.

## Do's and Don'ts

### Do:
- **Do** edit `scripts/site/build.mjs`; `site/index.html` is generated output.
- **Do** take new values from `packages/monet-ui/packages/monet-core/tokens.css` first. If
  a token exists there, copy it verbatim rather than picking a neighbour.
- **Do** set `--accent` on a container and let children read `var(--accent)`. That is Monet
  UI's contract and every component here follows it.
- **Do** animate meters with `transform: scaleX()` from a left origin. Width-based fills
  would put 82 elements through layout on a very long page.
- **Do** load the page with JavaScript disabled after touching the meter. Filled bars is the
  correct result; empty bars means the `.js` inversion got flipped.
- **Do** keep every number in `--font-mono` with `tabular-nums`, and keep built and tested
  adjacent and distinguishable by weight of color (`text-2` vs `text-1`).
- **Do** give any drawn state a text equivalent — the matrix cells carry a full `aria-label`
  and every meter is accompanied by its two raw percentages.
- **Do** keep anything that carries a note reachable by keyboard. The capability cells are
  `tabindex="0"` for exactly this reason; a hover-only note is invisible to half the audience.
- **Do** hold meaningful graphics at 3:1 or better (WCAG 1.4.11) and text at 4.5:1. Both
  floors have already forced a value change on this page.
- **Do** separate things with a `0.5px var(--stroke-soft)` hairline.

### Don't:
- **Don't** lower `--text-3` back to Monet UI's 0.38 on this surface. It fails the 4.5:1
  floor on this ground and every slot using it here carries information.
- **Don't** use `--text-disabled` for anything a reader has to read. It is 2.6:1. Its only
  sanctioned use here is a `·` separator glyph.
- **Don't** put the meter's value behind a class and `scaleX(0)` in the base rule. The
  filled state is the default; `.js` is what empties it.
- **Don't** give the suite strip a 2- or 3-column grid at narrow widths. Below 720px it is
  one readout per row, deliberately.
- **Don't** fold `.strip-app:focus-visible` into the general focus selector. It needs an
  inset ring because the strip clips its overflow.
- **Don't** tint a glyph with a `stroke-*` token. Those are for strokes; `stroke-strong` is
  1.65:1 as a foreground and already failed this once.
- **Don't** draw structure in an accent. Borders, dividers and separators are neutral stroke
  tokens; accents tint fills, glyphs, glows and focus rings only.
- **Don't** add a second drop shadow. Only `.panel` is lifted.
- **Don't** add a web font, an icon library, or any external request. The page ships as one
  self-contained `index.html` plus `icons/`, with no build step and no runtime dependency.
- **Don't** turn the panel stack into a card grid. The stack is the thesis of the page.
- **Don't** promote `--accent-game` into `tokens.css` as a fifth shared accent without that
  decision being made upstream. Here it is a carry from `apps/jouer/src/styles.css`.
- **Don't** assume a light theme works. Monet UI ships an opt-in `[data-theme="light"]`
  palette; this page declares `<meta name="color-scheme" content="dark">`, never sets the
  attribute, and hardcodes four opaque dark values for the sticky elements. Supporting light
  here is real work, not a toggle.

## Notes for the next editor

- The page's `:root` copies Monet UI's token block wholesale, so `--glass-3`, `--desktop-1`,
  `--hi-bottom` and `--on-accent` are declared but never used. They are harmless; they are
  also not evidence that anything uses them.
- `--shadow-window` and the `--blur-*` tokens are **not** declared here — their values are
  inlined literally at the two places they are needed. If Monet UI retunes them, this page
  will not follow automatically.
- `--gutter` and `--measure` are this page's own tokens. Monet UI has neither, because app
  panels are never this wide.
- The direction-contract comment at the top of `<body>` describes 64px strip icons; the
  built value is 60px (48px below 720px). The built value is the truth.
