// Generates site/index.html — the public Monet progress board.
//
//   node scripts/site/build.mjs
//
// site/ is exactly what gets uploaded: index.html plus icons/. This generator
// and its data live outside it, so the publish folder stays clean. The script
// exists so the numbers can be refreshed without hand-editing ~75 meter rows:
// update progress.json, re-run, commit the regenerated page.
//
// Where the numbers come from is stated on the page itself, in "How these
// numbers were made". Keep that section truthful when you change anything here.

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(new URL(import.meta.url)));
const OUT = join(HERE, "..", "..", "site");

const DATA = JSON.parse(readFileSync(join(HERE, "progress.json"), "utf8"));

/* ── helpers ───────────────────────────────────────────────────────── */

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const num = (n) => n.toLocaleString("en-US");

// The accent identities are Monet UI's, verbatim from
// packages/monet-ui/packages/monet-core/tokens.css.
// `game` is Jouer's own, declared in apps/jouer/src/styles.css rather than in
// the shared tokens — carried here so the page shows each app its real colour.
const ACCENT_VAR = {
  raster: "--accent-raster",
  vector: "--accent-vector",
  audio: "--accent-audio",
  motion: "--accent-motion",
  game: "--accent-game",
};

/* ── capability matrix glyphs ──────────────────────────────────────────
   Drawn, not typographic: one 12px box, one stroke weight, four states.
   full = solid, partial = half-solid, none = empty outline, na = rule.   */

const GLYPH = {
  full: `<svg class="g" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2.5" fill="currentColor"/></svg>`,
  partial: `<svg class="g" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 1h5A2.5 2.5 0 0 1 11 3.5v5A2.5 2.5 0 0 1 8.5 11H6V1Z" fill="currentColor"/><rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1"/></svg>`,
  none: `<svg class="g" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1"/></svg>`,
  na: `<svg class="g" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.5" width="8" height="1" rx="0.5" fill="currentColor"/></svg>`,
};

const LEVEL_WORD = {
  full: "Present",
  partial: "Partial",
  none: "Absent",
  na: "Not applicable",
};

/* ── the two-stage meter ───────────────────────────────────────────────
   One track carries both numbers without letting them lie about each other.

     ghost fill  = implemented%           … how much of the area exists
     solid fill  = implemented × tested%  … how much of the area is built AND covered

   Because coverage is a share of what is built, an app that is 20% built with
   90% of that tested cannot render a nearly-full bar. The readouts state both
   raw percentages beside it.                                                 */

function meter(implemented, tested, cls = "") {
  const covered = (implemented * tested) / 100;
  // Emitted as unitless scale factors: the fills are full-width boxes squeezed
  // with scaleX, so the animation stays on the compositor instead of running
  // layout on ~75 bars down an 18,000px page.
  return `<span class="meter ${cls}" style="--built:${(implemented / 100).toFixed(
    4
  )};--covered:${(covered / 100).toFixed(4)}">
  <span class="track"><span class="built"></span><span class="covered"></span></span>
</span>`;
}

function readouts(implemented, tested) {
  // Each number carries two labels: the full one for screen readers, and a
  // one-word `mini` that becomes visible on narrow screens, where the column
  // header has long since scrolled out of view.
  return `<span class="vals">
  <span class="v v-built"><b>${implemented}</b><i>%</i><span class="sr-only"> built</span><span class="mini" aria-hidden="true">built</span></span>
  <span class="v v-tested"><b>${tested}</b><i>%</i><span class="sr-only"> of that covered by tests</span><span class="mini" aria-hidden="true">tested</span></span>
</span>`;
}

/* ── sections ──────────────────────────────────────────────────────── */

function suiteStrip(apps) {
  return apps
    .map((a) => {
      const accent = `var(${ACCENT_VAR[a.accent]})`;
      const icon = a.icon
        ? `<img src="icons/${a.key}.png" width="128" height="128" alt="" loading="lazy" decoding="async">`
        : `<span class="icon-missing" aria-hidden="true"></span>`;
      return `<a class="strip-app" href="#${a.key}" style="--accent:${accent}">
  <span class="strip-icon">${icon}</span>
  <span class="strip-name">${esc(a.name.replace(/^Monet /, ""))}</span>
  ${meter(a.implementedOverall, a.testedOverall, "meter-sm")}
  <span class="strip-num"><b class="n-built">${a.implementedOverall}<i>%</i></b> built
  <span class="dot">·</span> <b class="n-tested">${a.testedOverall}<i>%</i></b> tested</span>
</a>`;
    })
    .join("\n");
}

function matrix(apps, capabilities) {
  const head = apps
    .map(
      (a) =>
        `<th scope="col" style="--accent:var(${ACCENT_VAR[a.accent]})"><a href="#${a.key}">${esc(
          a.name.replace(/^Monet /, "")
        )}</a></th>`
    )
    .join("");

  const rows = capabilities
    .map((cap) => {
      const cells = apps
        .map((a) => {
          const c = a.capabilities.find((x) => x.id === cap.id) || {
            level: "none",
            note: "",
          };
          const label = `${a.name} — ${cap.label}: ${LEVEL_WORD[c.level]}${
            c.note ? `. ${c.note}` : ""
          }`;
          return `<td class="cell is-${c.level}" style="--accent:var(${ACCENT_VAR[a.accent]})">
  <span class="cell-in" role="img" tabindex="0" aria-label="${esc(label)}" title="${esc(
    `${LEVEL_WORD[c.level]}${c.note ? ` — ${c.note}` : ""}`
  )}">${GLYPH[c.level]}</span>
</td>`;
        })
        .join("");
      return `<tr><th scope="row"><span class="cap-name">${esc(
        cap.label
      )}</span><span class="cap-note">${esc(cap.blurb)}</span></th>${cells}</tr>`;
    })
    .join("\n");

  return `<table class="matrix">
  <caption class="sr-only">Shared capabilities across the seven Monet apps</caption>
  <thead><tr><th scope="col" class="corner">Capability</th>${head}</tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

function appPanel(a) {
  const accent = `var(${ACCENT_VAR[a.accent]})`;
  const icon = a.icon
    ? `<img src="icons/${a.key}.png" width="128" height="128" alt="${esc(
        a.name
      )} app icon" loading="lazy" decoding="async">`
    : `<span class="icon-missing" role="img" aria-label="${esc(
        a.name
      )} has no icon of its own"></span>`;

  const areas = a.areas
    .map(
      (r) => `<li class="area">
  <span class="area-name">${esc(r.name)}</span>
  ${meter(r.implemented, r.tested)}
  ${readouts(r.implemented, r.tested)}
  <span class="area-detail">${esc(r.detail)}</span>
</li>`
    )
    .join("\n");

  // Naming the two numeric columns once per app beats asking the reader to
  // remember which of two adjacent percentages is which.
  const areasHead = `<li class="area area-head" aria-hidden="true">
  <span class="area-name">Feature area</span>
  <span></span>
  <span class="vals"><span class="v">built</span><span class="v">tested</span></span>
  <span></span>
</li>`;

  const gaps = a.notableGaps?.length
    ? `<div class="gaps">
  <span class="gaps-label">Not yet</span>
  <ul>${a.notableGaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
</div>`
    : "";

  // A real capture of the app's own UI. Apps with no usable capture simply omit it
  // and the prose takes the full width — never a placeholder or a stand-in image.
  const shot = a.shot
    ? `<figure class="shot">
  <a href="shots/${a.key}.webp" target="_blank" rel="noopener" aria-label="Open the ${esc(
        a.name
      )} screenshot full size">
    <img src="shots/${a.key}.webp" width="1440" height="840" loading="lazy" decoding="async"
         alt="${esc(a.shotAlt || a.name + " running")}">
  </a>
  <figcaption>${esc(a.shotCaption || "The app running")}</figcaption>
</figure>`
    : "";

  return `<section class="app" id="${a.key}" style="--accent:${accent}">
  <header class="app-head">
    <span class="app-icon">${icon}</span>
    <span class="app-id">
      <h3>${esc(a.name)}</h3>
      <span class="app-sub">${esc(a.tagline)} <span class="sep">·</span> in the manner of ${esc(
        a.peer
      )}</span>
    </span>
    <span class="app-state">
      <span class="chip chip-${a.maturity}">${esc(a.maturityLabel)}</span>
    </span>
    <span class="app-master">
      ${meter(a.implementedOverall, a.testedOverall, "meter-lg")}
      ${readouts(a.implementedOverall, a.testedOverall)}
    </span>
  </header>

  <div class="app-intro${a.shot ? "" : " is-textonly"}">
    ${shot}
    <div class="app-brief">
      <p class="app-desc">${esc(a.description)}</p>
      ${gaps}
    </div>
  </div>

  <ul class="areas">
${areasHead}
${areas}
  </ul>

  <footer class="app-foot">
    <dl class="stats stats-wide">
      <div><dt>Source files</dt><dd>${num(a.stats.sourceFiles)}</dd></div>
      <div><dt>Lines</dt><dd>${num(a.stats.linesOfCode)}</dd></div>
      <div><dt>Unit test files</dt><dd>${num(a.stats.testFiles)}</dd></div>
      <div><dt>Unit tests passing</dt><dd${
        a.testsFailing ? ' class="warn"' : ""
      }>${num(a.testsPassing)}${
        a.testsFailing ? ` <span class="fail">+${a.testsFailing} failing</span>` : ""
      }</dd></div>
    </dl>
  </footer>
</section>`;
}

/* ── page ──────────────────────────────────────────────────────────── */

const { apps, capabilities, suite, measuredOn } = DATA;

const totalTests = apps.reduce((n, a) => n + a.testsPassing, 0);
const totalFailing = apps.reduce((n, a) => n + (a.testsFailing || 0), 0);
const totalLoc = apps.reduce((n, a) => n + a.stats.linesOfCode, 0);
const totalTestFiles = apps.reduce((n, a) => n + a.stats.testFiles, 0);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monet — build progress across seven desktop apps</title>
<meta name="description" content="What is built, what is tested and what is missing across all seven Monet desktop apps, measured from source.">
<meta name="color-scheme" content="dark">
<script>document.documentElement.className="js"</script>
<link rel="icon" href="icons/vision.png" type="image/png">
<meta property="og:title" content="Monet — build progress">
<meta property="og:description" content="What is built, what is tested and what is missing across all seven Monet desktop apps, measured from source.">
<meta property="og:image" content="icons/vision.png">
<meta property="og:type" content="website">
<style>
${css()}
</style>
</head>
<body>
<!--
  IMPECCABLE DIRECTION CONTRACT — seed f17a57a0 (surface scope, mode: read)
  THESIS: A progress board rendered as the suite's own inspector dock. It refuses the
    card-grid-of-apps that every status page ships; the tool reports on itself in the
    vocabulary it already uses to report a value.
  OWN-WORLD: Monet UI, inherited whole — desktop #0b0e14, three glass depths, 0.5px
    hairlines, 14px window radius, 4px slider tracks, 10px/0.08em section labels, and
    the four oklch accents tinting highlights only, never structure.
  STORY: A developer sees which of seven apps are real, how much of each is covered by
    tests, and precisely where the gaps are — then knows where to help.
  FIRST VIEWPORT: sticky chrome strip; one plain statement; then all seven apps as a
    single readout row, icons at 60px over two-stage meters, ordered most-built first;
    below 720px the row becomes one app per line, never a grid of equal cells.
  FORM: inspector panel stack — candidate 5 of the ordered grounded list.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
    review, the verdict, and DESIGN.md.
-->

<a class="sr-only skip" href="#apps">Skip to the apps</a>

<header class="chrome">
  <div class="chrome-in">
    <span class="wordmark">Monet</span>
    <span class="chrome-title">Build progress</span>
    <span class="chrome-spacer"></span>
    <span class="legend" aria-hidden="true">
      <span class="legend-meter">${meter(70, 60, "meter-sm")}</span>
      <span class="legend-txt"><b>built</b> · <b class="lit">covered by tests</b></span>
    </span>
    <span class="measured">Measured ${esc(measuredOn)}</span>
  </div>
</header>

<main>

<section class="opening">
  <h1>Seven desktop creative apps, one shared substrate. Here is how far each one actually is.</h1>
  <p class="lede">${esc(suite.blurb)}</p>

  <nav class="strip" aria-label="The seven apps, ordered by how much is built">
${suiteStrip(apps)}
  </nav>

  <dl class="totals">
    <div><dt>Apps</dt><dd>${apps.length}</dd></div>
    <div><dt>Unit tests passing</dt><dd>${num(totalTests)}</dd></div>
    <div><dt>Unit test files</dt><dd>${num(totalTestFiles)}</dd></div>
    <div><dt>Lines of source</dt><dd>${num(totalLoc)}</dd></div>
  </dl>
</section>

<section class="panel panel-matrix" aria-labelledby="matrix-h">
  <div class="panel-head">
    <h2 class="section-label" id="matrix-h">Shared capabilities</h2>
    <p class="panel-note">The substrate is the product. These ten rows are the things an
    app gets by being part of the monorepo rather than by being written twice.</p>
  </div>
  <div class="matrix-scroll">
${matrix(apps, capabilities)}
  </div>
  <div class="matrix-key" aria-hidden="true">
    <span><span class="k">${GLYPH.full}</span>present</span>
    <span><span class="k">${GLYPH.partial}</span>partial</span>
    <span><span class="k">${GLYPH.none}</span>absent</span>
    <span><span class="k">${GLYPH.na}</span>not applicable</span>
  </div>
</section>

<section class="panel panel-apps" id="apps" aria-labelledby="apps-h">
  <div class="panel-head">
    <h2 class="section-label" id="apps-h">The apps</h2>
    <p class="panel-note">Ordered by how much is built. Each row of an app is one feature
    area: the faint fill is how much of it exists, the lit fill is how much of it is also
    under test.</p>
  </div>
${apps.map(appPanel).join("\n")}
</section>

<section class="panel panel-found" aria-labelledby="found-h">
  <div class="panel-head">
    <h2 class="section-label" id="found-h">What they share</h2>
  </div>
  <ul class="founds">
${suite.sharedFoundations
  .map(
    (f) => `    <li><span class="found-name">${esc(f.name)}</span><span class="found-detail">${esc(
      f.detail
    )}</span></li>`
  )
  .join("\n")}
  </ul>
</section>

<section class="panel panel-method" aria-labelledby="method-h">
  <div class="panel-head">
    <h2 class="section-label" id="method-h">How these numbers were made</h2>
  </div>
  <div class="method">
    <div class="method-points">
      <p><b>Test counts are measured.</b> Every app's unit suite was run on ${esc(
        measuredOn
      )}; the figures are what the runner reported. ${num(totalTests)} passing${
        totalFailing
          ? `, and ${totalFailing} failing — the failure is named on the app it belongs to rather than quietly rounded away`
          : ""
      }.</p>
      <p><b>Percentages are judgements, not instrumented coverage.</b> Each app was
      audited against the scope its industry counterpart implies, area by area, citing
      files. A second pass then tried to knock the numbers down, and where it produced
      file-level evidence — a test that did not touch the path it claimed, a line count
      that had quietly swallowed the test files — the lower number is the one printed
      here.</p>
      <p><b>Coverage is a share of what exists.</b> An area that is a quarter built with
      all of that quarter tested reads 25% and 100%, and its bar stays a quarter full.
      This is why a young app cannot borrow the look of a finished one.</p>
    </div>
    <p class="method-caveat">Not measured, and deliberately not claimed anywhere on this
    page: statement-level coverage, performance, release readiness, or a date for any of
    the gaps listed above.</p>
  </div>
</section>

</main>

<footer class="foot">
  <span>Monet — ${apps.length} apps, one monorepo.</span>
  <span class="foot-dim">Generated from source by <code>site/build.mjs</code>. Measured ${esc(
    measuredOn
  )}.</span>
</footer>

<script>
${js()}
</script>
</body>
</html>
`;

writeFileSync(join(OUT, "index.html"), html);
console.log(
  `site/index.html — ${apps.length} apps, ${capabilities.length} capabilities, ${num(
    totalTests
  )} tests, ${(html.length / 1024).toFixed(0)}KB`
);

/* ── styles ────────────────────────────────────────────────────────── */

function css() {
  return `
/* Tokens lifted verbatim from packages/monet-ui/packages/monet-core/tokens.css.
   This page is dressed by the same design system as the apps it reports on. */
:root {
  --font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
  --font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter Display", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace;

  --desktop-0: #0b0e14;
  --desktop-1: #131722;
  --desktop-2: #1a1f2c;

  --glass-0: rgba(255, 255, 255, 0.04);
  --glass-1: rgba(255, 255, 255, 0.06);
  --glass-2: rgba(255, 255, 255, 0.09);
  --glass-3: rgba(255, 255, 255, 0.13);

  --stroke-soft: rgba(255, 255, 255, 0.06);
  --stroke-medium: rgba(255, 255, 255, 0.10);
  --stroke-strong: rgba(255, 255, 255, 0.16);

  --hi-top: rgba(255, 255, 255, 0.22);

  --text-1: rgba(255, 255, 255, 0.92);
  --text-2: rgba(255, 255, 255, 0.62);
  /* Deviation from the app tokens, deliberate: --text-3 is 0.38 in the desktop
     chrome, which lands at 3.3:1 on this ground. Every slot using it here holds
     real information (feature detail, counts, capability notes) at small size,
     so it is raised to 5.5:1. --text-disabled lands at 2.6:1 and is therefore
     used only for the purely decorative separator glyph, never for text. */
  --text-3: rgba(255, 255, 255, 0.52);
  --text-disabled: rgba(255, 255, 255, 0.30);

  --radius-window: 14px;
  --radius-panel: 10px;
  --radius-control: 7px;
  --radius-pill: 999px;

  --accent-raster: oklch(0.78 0.14 200);
  --accent-vector: oklch(0.80 0.14 70);
  --accent-audio:  oklch(0.74 0.16 305);
  --accent-motion: oklch(0.75 0.18 350);
  /* Jouer's own, from apps/jouer/src/styles.css — not one of the four shared
     identities, which is itself a small fact about the suite. */
  --accent-game:   oklch(0.80 0.16 150);

  --accent: var(--accent-raster);

  --gutter: clamp(20px, 5vw, 64px);
  --measure: 68ch;
}

*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-1);
  background: var(--desktop-0);
  /* the desktop the apps float on: a cool ground, warmed where light collects */
  background-image:
    radial-gradient(120ch 80ch at 12% -10%, rgba(70, 130, 190, 0.16), transparent 60%),
    radial-gradient(90ch 70ch at 92% 4%, rgba(150, 70, 160, 0.10), transparent 62%);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

h1, h2, h3 { font-family: var(--font-display); font-weight: 600; margin: 0; }

a { color: inherit; }

.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.skip:focus {
  position: fixed; top: 10px; left: 10px; z-index: 100;
  width: auto; height: auto; clip: auto; margin: 0;
  padding: 8px 14px; border-radius: var(--radius-control);
  background: var(--desktop-2); color: var(--text-1);
  box-shadow: 0 0 0 1px var(--stroke-strong);
}

:where(a, .cell-in):focus-visible {
  outline: none;
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--accent) 75%, transparent),
    0 0 0 4px color-mix(in oklch, var(--accent) 26%, transparent);
  border-radius: var(--radius-control);
}
/* The strip clips its overflow and its cells paint edge to edge, so an outset
   ring is both cut off and painted over by the next sibling. This is the page's
   primary navigation, so it gets the ring on the inside. */
.strip-app:focus-visible {
  outline: none;
  box-shadow:
    inset 0 0 0 2px color-mix(in oklch, var(--accent) 80%, transparent),
    inset 0 0 0 5px color-mix(in oklch, var(--accent) 22%, transparent);
}

/* ── chrome strip ── (the apps' titlebar metric: 48px) ── */
.chrome {
  position: sticky; top: 0; z-index: 20;
  height: 48px;
  background: rgba(11, 14, 20, 0.72);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-bottom: 0.5px solid var(--stroke-soft);
  box-shadow: inset 0 0.5px 0 var(--hi-top);
}
.chrome-in {
  height: 100%;
  max-width: 1440px; margin: 0 auto;
  padding: 0 var(--gutter);
  display: flex; align-items: center; gap: 14px;
}
.wordmark {
  font-family: var(--font-display);
  font-size: 15px; font-weight: 600; letter-spacing: -0.01em;
  color: var(--text-1);
}
.chrome-title {
  font-size: 11px; color: var(--text-3);
  padding-left: 14px; border-left: 0.5px solid var(--stroke-medium);
  line-height: 1;
}
.chrome-spacer { flex: 1; }
.legend { display: flex; align-items: center; gap: 9px; }
.legend-meter { width: 54px; display: block; }
.legend-txt { font-size: 11px; color: var(--text-3); white-space: nowrap; }
.legend-txt b { font-weight: 500; color: var(--text-2); }
.legend-txt b.lit { color: var(--text-1); }
.measured {
  font-family: var(--font-mono);
  font-size: 10.5px; color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
@media (max-width: 860px) {
  .legend, .chrome-title { display: none; }
}

main { max-width: 1440px; margin: 0 auto; padding: 0 var(--gutter); }

/* ── opening ── */
.opening { padding: clamp(56px, 11vw, 128px) 0 clamp(40px, 6vw, 72px); }
.opening h1 {
  font-size: clamp(30px, 4.6vw, 56px);
  line-height: 1.06;
  letter-spacing: -0.033em;
  text-wrap: balance;
  max-width: 21ch;
}
.lede {
  margin: 28px 0 0;
  max-width: var(--measure);
  font-size: clamp(15px, 1.35vw, 17px);
  line-height: 1.62;
  color: var(--text-2);
}
.lede-2 { margin-top: 14px; }

/* the suite as one readout row — this is the thesis, not a card grid */
.strip {
  margin-top: clamp(40px, 6vw, 72px);
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  background: var(--stroke-soft);
  border: 0.5px solid var(--stroke-soft);
  border-radius: var(--radius-panel);
  overflow: hidden;
}
.strip-app {
  display: flex; flex-direction: column; align-items: center;
  gap: 10px;
  padding: 22px 10px 18px;
  background: var(--glass-0);
  text-decoration: none;
  transition: background 0.18s ease;
}
.strip-app:hover { background: var(--glass-2); }
.strip-icon {
  width: 60px; height: 60px; display: block;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.45));
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.strip-app:hover .strip-icon { transform: translateY(-2px) scale(1.03); }
.strip-icon img { width: 100%; height: 100%; display: block; }
.icon-missing {
  display: block; width: 100%; height: 100%;
  border-radius: 24%;
  background: var(--glass-1);
  box-shadow: inset 0 0 0 1px var(--stroke-medium), inset 0 1px 0 var(--hi-top);
  /* an app with no icon of its own says so, rather than borrowing another's */
  background-image: repeating-linear-gradient(
    -45deg, transparent 0 5px, rgba(255,255,255,0.05) 5px 10px);
}
.strip-name {
  font-size: 12.5px; font-weight: 500; color: var(--text-1);
  letter-spacing: -0.005em;
}
.strip-app .meter { width: 100%; max-width: 76px; }
.strip-num {
  font-family: var(--font-mono);
  font-size: 10.5px; color: var(--text-3);
  font-variant-numeric: tabular-nums;
  text-align: center; line-height: 1.5;
}
.strip-num b { font-weight: 500; }
.strip-num .n-built { color: var(--text-2); }
.strip-num .n-tested { color: var(--text-1); }
.strip-num i { font-style: normal; font-size: 9px; }
.strip-num .dot { color: var(--text-disabled); }

.totals {
  margin: 28px 0 0;
  display: flex; flex-wrap: wrap; gap: 0 clamp(28px, 4vw, 52px);
}
.totals div { display: flex; align-items: baseline; gap: 8px; padding: 6px 0; }
.totals dt { font-size: 11px; color: var(--text-3); }
.totals dd {
  margin: 0; font-family: var(--font-mono); font-size: 13px;
  color: var(--text-1); font-variant-numeric: tabular-nums;
}

/* ── panels ── */
.panel {
  margin-top: clamp(44px, 6vw, 80px);
  background: var(--glass-1);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 0.5px solid var(--stroke-soft);
  border-radius: var(--radius-window);
  box-shadow: 0 24px 80px -8px rgba(0, 0, 0, 0.55), inset 0 0.5px 0 var(--hi-top);
  overflow: hidden;
}
.panel-head {
  padding: 18px 22px 16px;
  background: rgba(0, 0, 0, 0.16);
  border-bottom: 0.5px solid var(--stroke-soft);
}
.section-label {
  font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-3);
  margin: 0;
}
.panel-note {
  margin: 10px 0 0; max-width: var(--measure);
  font-size: 13px; line-height: 1.55; color: var(--text-2);
}

/* ── matrix ── */
/* A visible thin scrollbar is the scroll cue — where the table overflows, the
   only other signal is a column clipped at the edge, which reads as a bug. */
.matrix-scroll {
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--stroke-strong) transparent;
}
.matrix-scroll::-webkit-scrollbar { height: 8px; }
.matrix-scroll::-webkit-scrollbar-track { background: transparent; }
.matrix-scroll::-webkit-scrollbar-thumb {
  background: var(--stroke-strong); border-radius: 4px;
}
.matrix {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.matrix th, .matrix td { text-align: left; }
.matrix thead th {
  padding: 12px 8px;
  font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--text-3);
  background: rgba(14, 18, 26, 0.94);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 0.5px solid var(--stroke-medium);
  text-align: center;
  white-space: nowrap;
}
.matrix thead th a { text-decoration: none; }
.matrix thead th a:hover { color: var(--accent); }
.matrix thead th.corner {
  text-align: left; padding-left: 22px;
  min-width: 210px;
}
.matrix tbody th {
  padding: 11px 18px 11px 22px;
  font-weight: 400;
  border-bottom: 0.5px solid var(--stroke-soft);
  vertical-align: top;
}
/* Keep the row label in place while the columns scroll sideways — without it
   a phone user scrolls to Anime's column and no longer knows which row it is.
   Only where the table actually overflows: pinning it at desktop would paint an
   opaque panel-within-a-panel seam for no benefit. */
@media (max-width: 1080px) {
  .matrix tbody th, .matrix thead th.corner {
    position: sticky; left: 0; z-index: 2;
    background: #12151d;
  }
  .matrix thead th.corner { z-index: 3; }
  .matrix tbody tr:hover th { background: #191d27; }
  .matrix tbody th::after, .matrix thead th.corner::after {
    content: ""; position: absolute; top: 0; right: 0; bottom: 0;
    width: 0.5px; background: var(--stroke-soft);
  }
}
.cap-name { display: block; color: var(--text-1); font-size: 12.5px; }
.cap-note { display: block; color: var(--text-3); font-size: 11px; margin-top: 2px; }
.matrix tbody tr:last-child th, .matrix tbody tr:last-child td { border-bottom: none; }
.matrix tbody tr:hover td, .matrix tbody tr:hover th { background: var(--glass-0); }

.cell {
  border-bottom: 0.5px solid var(--stroke-soft);
  text-align: center;
  padding: 8px;
  min-width: 62px;
}
.cell-in {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: var(--radius-control);
  position: relative; cursor: default;
}
.cell .g { width: 14px; height: 14px; display: block; }
.cell.is-full .cell-in { color: var(--accent); }
.cell.is-partial .cell-in { color: color-mix(in oklch, var(--accent) 62%, transparent); }
/* An absent capability is what a contributor is shopping for, so it is the one
   glyph that must not be the faintest thing in the grid. --stroke-strong sat at
   1.7:1, under the 3:1 that WCAG 1.4.11 asks of a meaningful graphic. */
.cell.is-none .cell-in { color: var(--text-3); }
.cell.is-na .cell-in { color: var(--text-3); }

.matrix-key {
  display: flex; flex-wrap: wrap; gap: 18px;
  padding: 13px 22px;
  border-top: 0.5px solid var(--stroke-soft);
  font-size: 11px; color: var(--text-3);
}
.matrix-key span { display: inline-flex; align-items: center; gap: 6px; }
.matrix-key .k { color: var(--text-2); display: inline-flex; }
.matrix-key .g { width: 11px; height: 11px; display: block; }

/* ── the meter ── */
.meter { display: block; width: 100%; }
.meter .track {
  position: relative; display: block;
  height: 4px; border-radius: 2px;
  background: var(--glass-0);
  box-shadow: inset 0 0.5px 0 rgba(0, 0, 0, 0.3);
  overflow: hidden;
}
/* Default state is the ANSWERED state: a meter renders at its real value with
   no script at all. The head script adds .js, which is the only thing that
   rewinds them to zero so they can animate in. A host CSP that blocks the
   inline script therefore yields a correct static page, not 75 empty bars. */
.meter .built, .meter .covered {
  position: absolute; inset: 0 0 0 0;
  transform-origin: left center;
  transition: transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}
.meter .built { transform: scaleX(var(--built)); }
.meter .covered { transform: scaleX(var(--covered)); }
.js .meter .built, .js .meter .covered { transform: scaleX(0); }
.meter .built {
  background: color-mix(in oklch, var(--accent) 34%, transparent);
}
.meter .covered {
  background: var(--accent);
  opacity: 0.92;
  /* The design system's own slider fill carries this glow verbatim
     (monet-core/styles.css, .monet-slider .fill). Inherited, not decoration. */
  box-shadow: 0 0 8px var(--accent);
}
.js .is-lit .meter .built { transform: scaleX(var(--built)); }
.js .is-lit .meter .covered { transform: scaleX(var(--covered)); transition-delay: 0.1s; }
.meter-lg .track { height: 6px; border-radius: 3px; }
.meter-sm .track { height: 3px; }
/* the legend meter is illustrative, always filled */
.js .legend .meter .built { transform: scaleX(var(--built)); }
.js .legend .meter .covered { transform: scaleX(var(--covered)); }

.vals {
  display: inline-flex; align-items: baseline; gap: 10px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
  white-space: nowrap;
}
.vals .v { display: inline-flex; align-items: baseline; min-width: 34px; justify-content: flex-end; }
.vals .v i { font-style: normal; color: var(--text-3); font-size: 9.5px; margin-left: 1px; }
.vals .mini {
  display: none;
  font-family: var(--font-ui); font-size: 9px; color: var(--text-3);
  letter-spacing: 0.04em;
}
.v-built b { font-weight: 500; color: var(--text-2); }
.v-tested b { font-weight: 500; color: var(--text-1); }

/* ── app panels: a continuous dock, hairline-separated ── */
.panel-apps { padding-bottom: 0; }
.app {
  padding: 26px 22px 24px;
  border-top: 0.5px solid var(--stroke-soft);
  scroll-margin-top: 60px;
}
.app:first-of-type { border-top: none; }

.app-head {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto minmax(190px, 260px);
  align-items: center;
  gap: 16px;
}
.app-icon { width: 56px; height: 56px; display: block; }
.app-icon img { width: 100%; height: 100%; display: block;
  filter: drop-shadow(0 6px 16px rgba(0,0,0,0.5)); }
.app-id { min-width: 0; }
.app-id h3 {
  font-size: 19px; letter-spacing: -0.018em; line-height: 1.2;
  color: var(--text-1);
}
.app-sub { display: block; margin-top: 3px; font-size: 12px; color: var(--text-3); }
.app-sub .sep { color: var(--text-disabled); margin: 0 2px; }

.chip {
  display: inline-flex; align-items: center;
  height: 22px; padding: 0 10px;
  border-radius: var(--radius-pill);
  font-size: 10.5px; font-weight: 500; letter-spacing: 0.01em;
  white-space: nowrap;
  background: var(--glass-1);
  color: var(--text-2);
  box-shadow: inset 0 0 0 0.5px var(--stroke-medium);
}
.chip-production {
  background: color-mix(in oklch, var(--accent) 20%, transparent);
  color: var(--text-1);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklch, var(--accent) 45%, transparent);
}
.chip-beta { color: var(--text-1); }
.chip-alpha { color: var(--text-2); }
.chip-scaffold { color: var(--text-3); }

.app-master { display: flex; flex-direction: column; gap: 7px; align-items: flex-end; }
.app-master .meter { width: 100%; }
.app-master .vals { gap: 14px; }

/* Screenshot beside the prose: the panel gains evidence without burying the data
   that is the point of the page. Text-only apps get the full width instead. */
.app-intro {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: clamp(20px, 3vw, 40px);
  align-items: start;
  margin-top: 18px;
}
.app-intro.is-textonly { grid-template-columns: 1fr; }

.shot { margin: 0; min-width: 0; }
.shot a {
  display: block; border-radius: var(--radius-panel); overflow: hidden;
  background: var(--desktop-0);
  box-shadow:
    0 18px 44px -12px rgba(0, 0, 0, 0.7),
    inset 0 0 0 0.5px var(--stroke-medium);
  transition: box-shadow 0.22s ease, transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.shot a:hover {
  transform: translateY(-2px);
  box-shadow:
    0 24px 56px -12px rgba(0, 0, 0, 0.78),
    inset 0 0 0 0.5px color-mix(in oklch, var(--accent) 40%, var(--stroke-medium));
}
.shot img { display: block; width: 100%; height: auto; }
.shot figcaption {
  margin-top: 8px; font-size: 10.5px; color: var(--text-3);
  letter-spacing: 0.01em;
}

.app-desc {
  margin: 0;
  max-width: var(--measure);
  font-size: 13.5px; line-height: 1.62; color: var(--text-2);
}
.is-textonly .app-desc { margin-top: 0; }

.areas { list-style: none; margin: 20px 0 0; padding: 0; }
.area {
  display: grid;
  grid-template-columns: minmax(120px, 168px) minmax(90px, 1fr) auto minmax(0, 1.35fr);
  align-items: center;
  gap: 16px;
  min-height: 34px;
  padding: 5px 0;
  border-top: 0.5px solid var(--stroke-soft);
}
.area:first-child { border-top: none; }
.area-name { font-size: 12.5px; color: var(--text-1); }
.area-detail { font-size: 11.5px; color: var(--text-3); line-height: 1.45; }

.area-head {
  min-height: 0; padding: 0 0 7px;
  font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-3);
}
.area-head .area-name {
  font-size: inherit; font-weight: inherit; letter-spacing: inherit;
  text-transform: inherit; color: inherit;
}
.area-head .vals { font-family: var(--font-ui); font-size: 9px; letter-spacing: 0.07em; }
.area-head .vals .v { justify-content: flex-end; }

.app-brief { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

.app-foot {
  margin-top: 20px; padding-top: 16px;
  border-top: 0.5px solid var(--stroke-soft);
  display: flex; flex-wrap: wrap; gap: 20px 40px;
  align-items: flex-start; justify-content: space-between;
}
.stats { display: flex; flex-wrap: wrap; gap: 0 26px; margin: 0; }
.stats div { display: flex; align-items: baseline; gap: 7px; }
.stats dt { font-size: 10.5px; color: var(--text-3); }
.stats dd {
  margin: 0; font-family: var(--font-mono); font-size: 12px;
  color: var(--text-2); font-variant-numeric: tabular-nums;
}
.stats dd.warn { color: var(--text-1); }
.fail { color: oklch(0.72 0.17 25); font-family: var(--font-ui); font-size: 11px; }

.gaps { min-width: 0; }
.gaps-label {
  display: block; margin-bottom: 8px;
  font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-3);
}
.gaps ul {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-wrap: wrap; gap: 6px;
}
.gaps li {
  font-size: 11.5px; color: var(--text-2);
  padding: 3px 9px; border-radius: var(--radius-pill);
  background: var(--glass-0);
  box-shadow: inset 0 0 0 0.5px var(--stroke-soft);
}

/* ── foundations ── */
.founds { list-style: none; margin: 0; padding: 0; }
.founds li {
  display: grid;
  grid-template-columns: minmax(150px, 230px) minmax(0, 1fr);
  gap: 20px;
  padding: 15px 22px;
  border-top: 0.5px solid var(--stroke-soft);
}
.founds li:first-child { border-top: none; }
.found-name { font-size: 13px; color: var(--text-1); font-weight: 500; }
.found-detail { font-size: 12.5px; color: var(--text-2); line-height: 1.55; }

/* ── method ── */
.method { padding: 20px 22px 24px; }
.method-points {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 clamp(28px, 4vw, 56px);
}
.method p {
  margin: 0; max-width: 46ch;
  font-size: 13px; line-height: 1.65; color: var(--text-2);
}
@media (max-width: 900px) {
  .method-points { grid-template-columns: 1fr; gap: 14px 0; }
  .method p { max-width: var(--measure); }
}
.method b { color: var(--text-1); font-weight: 600; }
.method-caveat {
  margin-top: 20px; padding-top: 15px;
  border-top: 0.5px solid var(--stroke-soft);
  color: var(--text-3); max-width: var(--measure);
}

/* ── foot ── */
.foot {
  max-width: 1440px; margin: 0 auto;
  padding: 44px var(--gutter) 64px;
  display: flex; flex-wrap: wrap; gap: 6px 20px;
  font-size: 11.5px; color: var(--text-3);
}
.foot-dim { color: var(--text-3); }
.foot code { font-family: var(--font-mono); font-size: 11px; }

/* ── responsive ── */
@media (max-width: 1080px) {
  .app-head { grid-template-columns: 48px minmax(0, 1fr) auto; }
  .app-icon { width: 48px; height: 48px; }
  .app-master { grid-column: 1 / -1; flex-direction: row; align-items: center; gap: 14px; }
  .app-master .meter { flex: 1; }
  .app-master .vals { width: auto; flex: 0 0 auto; }
  .area { grid-template-columns: minmax(110px, 150px) minmax(80px, 1fr) auto; }
  .area-detail { grid-column: 1 / -1; margin-top: -2px; }
  .strip { grid-template-columns: repeat(4, 1fr); }
  .app-intro { grid-template-columns: 1fr; gap: 16px; }
}
@media (max-width: 720px) {
  /* Never a grid of same-size cells — that is the scaffold this page refuses,
     and 7 into 2 or 3 columns also leaves visible holes. It becomes one
     readout per row instead, which is what the strip meant all along. */
  .strip { grid-template-columns: 1fr; }
  .strip-app {
    flex-direction: row; align-items: center;
    gap: 14px; padding: 13px 16px; text-align: left;
  }
  .strip-icon { width: 34px; height: 34px; flex: 0 0 34px; }
  .strip-name { flex: 0 0 74px; font-size: 13px; }
  .strip-app .meter { flex: 1 1 auto; max-width: none; width: auto; }
  .strip-num { flex: 0 0 auto; text-align: right; white-space: nowrap; }
  .strip-app:hover .strip-icon { transform: none; }
  .app { padding: 22px 16px; }
  .panel-head, .matrix-key, .method, .founds li { padding-left: 16px; padding-right: 16px; }
  .matrix thead th.corner { padding-left: 16px; min-width: 168px; }
  .matrix tbody th { padding-left: 16px; }
  .founds li { grid-template-columns: 1fr; gap: 4px; }
  .app-head { grid-template-columns: 44px minmax(0, 1fr); row-gap: 12px; }
  .app-icon { width: 44px; height: 44px; }
  .app-state { grid-column: 2; justify-self: start; }
}
@media (max-width: 460px) {
  .area { grid-template-columns: 1fr auto; column-gap: 12px; }
  .area .meter { grid-column: 1 / -1; }
  /* The BUILT/TESTED header scrolls away long before ten rows do, so at this
     width each number carries its own word rather than trusting memory. */
  /* gap must not fall between the number and its own % sign */
  .area .vals .mini { display: inline; margin-left: 3px; }
  .area .vals .v { min-width: 0; gap: 0; }
  .area-head .vals { display: none; }
  .strip-name { flex: 0 0 66px; }
  .strip-num { font-size: 9.5px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
`;
}

/* ── behaviour ─────────────────────────────────────────────────────── */

function js() {
  return `
// One authored moment: a meter settles into its value the way a slider does
// when a document loads. Values are already in the markup; this only animates
// the arrival, once, and never gates the content on it.
(function () {
  var meters = document.querySelectorAll(".areas, .strip, .app-master");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  function lightAll() {
    for (var i = 0; i < meters.length; i++) meters[i].classList.add("is-lit");
  }

  if (reduce.matches || !("IntersectionObserver" in window)) { lightAll(); return; }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add("is-lit");
      io.unobserve(e.target);
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.12 });

  for (var i = 0; i < meters.length; i++) io.observe(meters[i]);

  // Stagger within a group so a dense app reads as a sequence of readings.
  document.querySelectorAll(".areas").forEach(function (list) {
    list.querySelectorAll(".meter").forEach(function (m, i) {
      var d = Math.min(i * 32, 240);
      m.querySelector(".built").style.transitionDelay = d + "ms";
      m.querySelector(".covered").style.transitionDelay = d + 100 + "ms";
    });
  });
})();
`;
}
