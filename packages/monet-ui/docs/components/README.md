# Monet Component Reference

The complete reference for the Monet React component library. Each page below documents one group of components — their props, behavior, and usage.

Import the stylesheet **once** at your app entry, then pull components from the React package:

```tsx
import "@monet-ui/monet-core/index.css";   // global styles + tokens — imported once
import { /* … */ } from "@monet-ui/monet-react";
```

To consume the library in your own project, vendor this repo as a git submodule and link the packages by path — see the [root README](../../README.md#use-monet-in-your-own-app-git-submodule) for the full recipe.

## Groups

| Group | What it covers |
| --- | --- |
| [**Icons**](./icons.md) | Geometric 16px monoline glyph component plus the shared SVG-path icon map. |
| [**Chrome primitives**](./chrome-primitives.md) | Static, composable liquid-glass window chrome: workspace shell, titlebar, docks, panels, rails, and status bar. |
| [**Dockable workspace**](./dockable-workspace.md) | Data-driven interactive docking engine with drag/snap panels, relocatable toolbars, and a controlled/observable/imperative layout API. |
| [**Form controls**](./form-controls.md) | Accessible, controlled/uncontrolled in-house form controls (buttons, inputs, number field, checkbox/switch/radio, select) with full keyboard + ARIA. |
| [**Overlays**](./overlays.md) | Floating-layer foundation: managed Portal, focus-trap/dismiss/positioning hooks, and the Tooltip + Popover primitives every menu and dialog builds on. |
| [**Menus**](./menus.md) | Data-driven, fully keyboard-navigable menus: dropdown Menu, chrome MenuBar, right-click ContextMenu, and the shared MenuItemDef model. |
| [**Dialog & toast**](./dialog-and-toast.md) | Accessible modal Dialog plus a provider-backed Toast system (push/dismiss/clear) with auto-dismiss and live-region announcements. |
| [**Design canvas**](./design-canvas.md) | Figma-style infinite pan/zoom design canvas with reorderable artboard sections, inline editing, focus overlay, export, and pluggable persistence. |
| [**Creative — numeric/transform**](./creative-numeric.md) | Pro-app numeric controls: drag-to-scrub ScrubbyNumber, Stepper, two-thumb RangeSlider, rotary AngleDial/Knob, and the X/Y/W/H + rotation TransformFields group. |
| [**Creative — inspector/layout**](./creative-inspector.md) | Inspector & layout building blocks: collapsible Section, SegmentedControl, ToggleGroup, ToolbarGroup, Breadcrumb, TreeView, SearchField, Badge, ProgressBar and Spinner. |
| [**Creative — color**](./creative-color.md) | Photoshop/Figma color tooling: ColorField, HueSlider/AlphaSlider, ColorWheel, EyedropperReadout, GradientEditor, ColorPicker, Swatch/SwatchGrid, GlyphGrid, HexInput, plus the HSV color-space math. |
| [**Creative — layers**](./creative-layers.md) | Layer/channel/artboard inspectors: LayerRow, LayerList, LayerTree, VisibilityToggle/LockToggle, BlendModeSelect, OpacityControl, ChannelRow/ChannelList and ArtboardList. |
| [**Creative — timeline**](./creative-timeline.md) | Motion/audio timeline: monospace TimeDisplay, play/loop/record Transport, scrubbable TimelineRuler, draggable Playhead and KeyframeTrack, plus the composite Timeline and its timecode math. |
| [**Creative — curve**](./creative-curve.md) | SVG bezier curve editors: the N-point CurveEditor (EQ/transfer curves) and the cubic-bezier EasingCurve with draggable handles and presets. |
| [**Creative — viewport**](./creative-viewport.md) | Canvas viewport chrome: tick CanvasRuler, −/+ ZoomControl with presets, draggable Navigator minimap, marching-ants Marquee, and the grid + guide-line GridGuides overlay. |
| [**Creative — meters**](./creative-meters.md) | Data-viz / measurement widgets: RGB/luminance Histogram, peak-hold LevelMeter, fader-and-meter ChannelStrip, and the SVG Spectrum analyser. |
| [**Creative — vector**](./creative-vector.md) | Vector tool groups: the shape-mode + compound-path Pathfinder and the align / distribute AlignBar (roving-tabindex toolbar with an "align to" target). |
| [**Tauri integration & hooks**](./tauri-integration-and-hooks.md) | Tauri window/chrome bridge: MonetProvider + config/window-state/menu-command hooks and window controls, all degrading gracefully outside a Tauri webview. |
| [**Native OS dialogs**](./native-os-dialogs.md) | Typed wrappers over Tauri's plugin-dialog (open/save file, confirm/ask/message) that resolve safe defaults when not running inside Tauri. |
| [**Design tokens**](./design-tokens.md) | Shared accent/metric/radius token vocabulary re-exported from @monet-ui/monet-core for convenient theming. |
