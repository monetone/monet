# Icons

Geometric monoline glyphs at 16px — an original icon set (no Adobe-style icons), drawn with `currentColor` so they inherit text color.

> The app imports `@monet-ui/monet-core/index.css` once for global styling. The icons themselves are pure inline SVG and render without any extra CSS, but they pick up `color` and sizing from the surrounding Monet styles.

---

## Icon

Renders a single inline SVG glyph from a path string. Pass one of the named paths from [`I`](#i) (or any custom `d`). The glyph uses `stroke="currentColor"` by default; set `fill` to render a solid `currentColor` shape instead of a stroked outline.

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `d` | `string` | — (required) | SVG path data for the glyph, drawn within a `0 0 16 16` viewBox. Typically a value from `I`. |
| `size` | `number` | `16` | Width and height of the rendered SVG in pixels. |
| `fill` | `boolean` | `undefined` (falsy) | When `true`, the path is filled with `currentColor` and the stroke is removed. When falsy, the path is stroked (outline only). |
| `strokeWidth` | `number` | `1.5` | Stroke width passed to the SVG `strokeWidth` attribute. Only visually relevant when `fill` is falsy. |

The SVG is fixed to a `viewBox="0 0 16 16"` with `strokeLinecap="round"` and `strokeLinejoin="round"`.

### Usage

```tsx
import { Icon, I } from "@monet-ui/monet-react";

function Toolbar() {
  return (
    <>
      <Icon d={I.brush} />
      <Icon d={I.play} fill />
      <Icon d={I.zoom} size={24} strokeWidth={2} />
    </>
  );
}
```

---

## I

A constant record mapping glyph names to SVG path strings (`Record<string, string>`). Use these as the `d` prop on [`Icon`](#icon). All paths are authored for a `0 0 16 16` viewBox.

### Available glyphs

Grouped by their source comments:

- **Tool icons:** `cursor`, `brush`, `erase`, `pen`, `shape`, `text`, `gradient`, `hand`, `zoom`, `marquee`, `crop`, `lasso`, `clone`, `blur`, `dropper`
- **Controls:** `chevDown`, `chevRight`, `chevLeft`, `close`, `more`, `plus`, `minus`, `pin`, `expand`
- **Layer panel:** `eye`, `lock`, `link`
- **Audio:** `play`, `pause`, `stop`, `rewind`
- **Video:** `cut`, `marker`

### Usage

```tsx
import { Icon, I } from "@monet-ui/monet-react";

<button aria-label="Close">
  <Icon d={I.close} />
</button>
```

You can also map over the set, e.g. to build a glyph gallery:

```tsx
import { Icon, I } from "@monet-ui/monet-react";

{Object.entries(I).map(([name, d]) => (
  <span key={name} title={name}>
    <Icon d={d} />
  </span>
))}
```
