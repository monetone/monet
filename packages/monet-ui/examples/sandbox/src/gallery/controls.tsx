// ─────────────────────────────────────────────────────────────
// Monet gallery — Form controls
// ─────────────────────────────────────────────────────────────
// One GalleryEntry + self-contained demo per in-house control. Each demo is a
// real function component (hooks OK) returning compact, interactive content
// sized for a ~300×250 floating panel. Props mirror the source exactly
// (packages/monet-react/src/controls.tsx + controls-select.tsx); see
// docs/components/form-controls.md.
import { useState } from "react";
import {
  Button,
  IconButton,
  Input,
  Textarea,
  NumberField,
  Checkbox,
  Switch,
  RadioGroup,
  Radio,
  Select,
  Field,
  Label,
  Hint,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

// Shared padded shell — most controls want a little breathing room inside the
// otherwise edge-to-edge panel body.
function Pad({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gap: 10, padding: 4 }}>{children}</div>;
}

// ─── Button ────────────────────────────────────────────────────
function ButtonDemo() {
  const [saved, setSaved] = useState(0);
  return (
    <Pad>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Button variant="primary" iconStart="plus" onClick={() => setSaved((n) => n + 1)}>
          Add layer
        </Button>
        <Button onClick={() => setSaved((n) => n + 1)}>Default</Button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Button variant="ghost" iconStart="eye">
          Toggle
        </Button>
        <Button variant="danger" iconStart="close">
          Delete
        </Button>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <Button size="sm" variant="primary">
          Small
        </Button>
        <Button size="sm">Small</Button>
        <Button disabled>Disabled</Button>
      </div>
      <Button block variant="primary" iconEnd="chevRight">
        Block · committed {saved}
      </Button>
    </Pad>
  );
}

// ─── IconButton ────────────────────────────────────────────────
function IconButtonDemo() {
  const [tool, setTool] = useState("cursor");
  const tools: { icon: string; label: string }[] = [
    { icon: "cursor", label: "Move" },
    { icon: "brush", label: "Brush" },
    { icon: "pen", label: "Pen" },
    { icon: "text", label: "Type" },
    { icon: "dropper", label: "Eyedropper" },
  ];
  return (
    <Pad>
      <div style={{ display: "flex", gap: 4 }}>
        {tools.map((t) => (
          <IconButton
            key={t.icon}
            icon={t.icon}
            aria-label={t.label}
            active={tool === t.icon}
            onClick={() => setTool(t.icon)}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <IconButton icon="plus" aria-label="Add" variant="primary" />
        <IconButton icon="close" aria-label="Close" variant="danger" />
        <IconButton icon="more" aria-label="More" />
        <IconButton icon="lock" aria-label="Lock" size="sm" />
        <IconButton icon="link" aria-label="Link" size="sm" disabled />
      </div>
      <span style={{ fontSize: 11, opacity: 0.7 }}>Active tool: {tool}</span>
    </Pad>
  );
}

// ─── Input ─────────────────────────────────────────────────────
function InputDemo() {
  const [name, setName] = useState("Highlight dodge");
  const [query, setQuery] = useState("");
  return (
    <Pad>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Layer name"
        block
      />
      <Input
        iconStart="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search layers…"
        block
      />
      <Input size="sm" defaultValue="#d9a45b" block />
      <Input invalid defaultValue="not-a-color" block />
      <Input disabled defaultValue="Locked field" block />
    </Pad>
  );
}

// ─── Textarea ──────────────────────────────────────────────────
function TextareaDemo() {
  const [notes, setNotes] = useState("Push the warm midtones; pull back the blue cast in the shadows.");
  return (
    <Pad>
      <Textarea
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Shot notes…"
        block
      />
      <span style={{ fontSize: 11, opacity: 0.7 }}>{notes.length} chars</span>
    </Pad>
  );
}

// ─── NumberField ───────────────────────────────────────────────
function NumberFieldDemo() {
  const [opacity, setOpacity] = useState(78);
  const [angle, setAngle] = useState(45);
  const [scale, setScale] = useState(1.25);
  return (
    <Pad>
      <NumberField min={0} max={100} step={1} suffix="%" value={opacity} onChange={setOpacity} aria-label="Opacity" />
      <NumberField min={-180} max={180} step={5} suffix="°" value={angle} onChange={setAngle} aria-label="Rotation" />
      <NumberField min={0.1} max={8} step={0.05} precision={2} suffix="×" value={scale} onChange={setScale} aria-label="Scale" />
      <NumberField size="sm" defaultValue={12} suffix="px" aria-label="Stroke" />
      <NumberField disabled defaultValue={300} suffix="dpi" aria-label="Resolution" />
    </Pad>
  );
}

// ─── Checkbox ──────────────────────────────────────────────────
function CheckboxDemo() {
  const [snap, setSnap] = useState(true);
  const [grid, setGrid] = useState(false);
  const [guides, setGuides] = useState(true);
  // parent reflects the mixed state of its children
  const all = snap && grid && guides;
  const none = !snap && !grid && !guides;
  const setAll = (v: boolean) => {
    setSnap(v);
    setGrid(v);
    setGuides(v);
  };
  return (
    <Pad>
      <Checkbox checked={all} indeterminate={!all && !none} onChange={setAll}>
        Snapping
      </Checkbox>
      <div style={{ display: "grid", gap: 8, paddingLeft: 18 }}>
        <Checkbox checked={snap} onChange={setSnap}>
          Snap to objects
        </Checkbox>
        <Checkbox checked={grid} onChange={setGrid}>
          Snap to grid
        </Checkbox>
        <Checkbox checked={guides} onChange={setGuides}>
          Snap to guides
        </Checkbox>
      </div>
      <Checkbox disabled defaultChecked>
        Pixel preview (locked)
      </Checkbox>
    </Pad>
  );
}

// ─── Switch ────────────────────────────────────────────────────
function SwitchDemo() {
  const [visible, setVisible] = useState(true);
  const [locked, setLocked] = useState(false);
  const [clip, setClip] = useState(true);
  return (
    <Pad>
      <Switch checked={visible} onChange={setVisible}>
        Layer visible
      </Switch>
      <Switch checked={locked} onChange={setLocked}>
        Lock transparency
      </Switch>
      <Switch checked={clip} onChange={setClip}>
        Clip to layer below
      </Switch>
      <Switch disabled>Disabled toggle</Switch>
    </Pad>
  );
}

// ─── RadioGroup + Radio ────────────────────────────────────────
function RadioGroupDemo() {
  const [align, setAlign] = useState("center");
  const [fit, setFit] = useState("contain");
  return (
    <Pad>
      <div>
        <Label htmlFor="">Horizontal align</Label>
        <RadioGroup value={align} onChange={setAlign} orientation="horizontal" aria-label="Alignment">
          <Radio value="left">Left</Radio>
          <Radio value="center">Center</Radio>
          <Radio value="right">Right</Radio>
        </RadioGroup>
      </div>
      <RadioGroup value={fit} onChange={setFit} aria-label="Image fit">
        <Radio value="contain">Contain</Radio>
        <Radio value="cover">Cover</Radio>
        <Radio value="stretch">Stretch</Radio>
        <Radio value="tile" disabled>
          Tile (unavailable)
        </Radio>
      </RadioGroup>
    </Pad>
  );
}

// ─── Select ────────────────────────────────────────────────────
function SelectDemo() {
  const [blend, setBlend] = useState("screen");
  const [space, setSpace] = useState("");
  return (
    <Pad>
      <Select
        options={[
          { value: "normal", label: "Normal" },
          { value: "multiply", label: "Multiply" },
          { value: "screen", label: "Screen" },
          { value: "overlay", label: "Overlay" },
          { value: "soft-light", label: "Soft Light" },
          { value: "luminosity", label: "Luminosity", disabled: true },
        ]}
        value={blend}
        onChange={setBlend}
        aria-label="Blend mode"
        block
      />
      <Select
        options={[
          { value: "srgb", label: "sRGB", icon: "shape" },
          { value: "p3", label: "Display P3", icon: "shape" },
          { value: "rec2020", label: "Rec. 2020", icon: "shape" },
        ]}
        value={space}
        onChange={setSpace}
        placeholder="Color space…"
        block
      />
      <Select
        size="sm"
        options={[
          { value: "8", label: "8-bit" },
          { value: "16", label: "16-bit" },
          { value: "32", label: "32-bit float" },
        ]}
        defaultValue="16"
        aria-label="Bit depth"
        block
      />
      <Select options={[{ value: "x", label: "Disabled" }]} disabled placeholder="No layers" block />
    </Pad>
  );
}

// ─── Field + Label + Hint ──────────────────────────────────────
function FieldDemo() {
  const [hex, setHex] = useState("#d9a45b");
  const valid = /^#[0-9a-fA-F]{6}$/.test(hex);
  return (
    <Pad>
      <Field
        label="Fill color"
        hint={valid ? "6-digit hex." : undefined}
        error={valid ? undefined : "Enter a valid #RRGGBB hex."}
      >
        {(props) => (
          <Input
            {...props}
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            iconStart="dropper"
            block
          />
        )}
      </Field>
      <Field label="Document title" hint="Shown in the title bar.">
        {(props) => <Input {...props} defaultValue="Untitled-1" block />}
      </Field>
      <div>
        <Label htmlFor="standalone-note">Standalone Label</Label>
        <Input id="standalone-note" defaultValue="Bound via htmlFor" block />
        <Hint>A plain Hint paragraph rendered on its own.</Hint>
      </div>
    </Pad>
  );
}

const mk = (
  id: string,
  label: string,
  render: () => React.ReactNode,
): GalleryEntry => ({ id, label, category: "Form controls", section: "Components", render });

export const controlsEntries: GalleryEntry[] = [
  mk("controls/Button", "Button", () => <ButtonDemo />),
  mk("controls/IconButton", "IconButton", () => <IconButtonDemo />),
  mk("controls/Input", "Input", () => <InputDemo />),
  mk("controls/Textarea", "Textarea", () => <TextareaDemo />),
  mk("controls/NumberField", "NumberField", () => <NumberFieldDemo />),
  mk("controls/Checkbox", "Checkbox", () => <CheckboxDemo />),
  mk("controls/Switch", "Switch", () => <SwitchDemo />),
  mk("controls/RadioGroup", "RadioGroup", () => <RadioGroupDemo />),
  mk("controls/Select", "Select", () => <SelectDemo />),
  mk("controls/Field", "Field", () => <FieldDemo />),
];
