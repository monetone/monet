// ─────────────────────────────────────────────────────────────
// Monet sandbox — Overlays gallery
// ─────────────────────────────────────────────────────────────
// One openable demo panel per overlay component: Tooltip, Popover, Menu,
// MenuBar, ContextMenu, Dialog, Toast — plus a "Native dialogs" demo wired to
// the Tauri plugin-dialog wrappers (which degrade gracefully outside Tauri).
//
// Each demo triggers from a Button *inside* its ~300×250 panel and uses local
// state so it actually responds. Hooks live in the demo components, never in a
// GalleryEntry.render() (a DockableWorkspace panel render() is a bare call).

import { useState } from "react";
import {
  Button,
  Tooltip,
  Popover,
  Menu,
  MenuBar,
  ContextMenu,
  Dialog,
  ToastProvider,
  useToast,
  openFile,
  saveFile,
  confirm,
  message,
  ask,
  type MenuItemDef,
  type MenuBarEntry,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

// Shared padded shell so compact overlay demos breathe inside the panel.
const pad: React.CSSProperties = { display: "grid", gap: 8, padding: 4 };
const note: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.7,
  lineHeight: 1.4,
  margin: 0,
};

// ─── Tooltip ───────────────────────────────────────────────────
// The single child must accept a ref + the spread aria props — Button does
// (it's a forwardRef <button>). Hover or focus to reveal after `delay`.
function TooltipDemo() {
  return (
    <div style={pad}>
      <p style={note}>Hover or focus the buttons to reveal a tooltip.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Tooltip content="Save changes (⌘S)" side="bottom">
          <Button variant="primary">Save</Button>
        </Tooltip>
        <Tooltip content="Discard everything" side="bottom" align="start">
          <Button variant="danger">Discard</Button>
        </Tooltip>
        <Tooltip content="Opens after a short delay" side="top" delay={150}>
          <Button variant="ghost">Hover me</Button>
        </Tooltip>
      </div>
    </div>
  );
}

// ─── Popover ───────────────────────────────────────────────────
// Controlled via open / onOpenChange. The child is the anchor; clicking it
// toggles, and Escape / outside-click close it back through onOpenChange.
function PopoverDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div style={pad}>
      <p style={note}>Click to anchor a floating panel; Esc or outside closes.</p>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="bottom"
        align="start"
        label="Quick settings"
        content={
          <div style={{ display: "grid", gap: 6, minWidth: 160 }}>
            <strong style={{ fontSize: 12 }}>Quick settings</strong>
            <label style={{ display: "flex", gap: 6, fontSize: 12 }}>
              <input type="checkbox" defaultChecked /> Snap to grid
            </label>
            <label style={{ display: "flex", gap: 6, fontSize: 12 }}>
              <input type="checkbox" /> Show rulers
            </label>
            <Button size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        }
      >
        <Button onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Open"} popover
        </Button>
      </Popover>
    </div>
  );
}

// ─── Menu ──────────────────────────────────────────────────────
// Dropdown bound to a custom trigger via render-prop. The trigger receives
// { ref, open, toggle, aria-* , id } to spread onto the Button.
function MenuDemo() {
  const [last, setLast] = useState<string>("—");
  const items: MenuItemDef[] = [
    { id: "new", label: "New file", shortcut: "⌘N", action: () => setLast("New file") },
    { id: "open", label: "Open…", shortcut: "⌘O", action: () => setLast("Open…") },
    { id: "sep1", separator: true },
    { id: "wrap", label: "Word wrap", checked: true, action: () => setLast("Word wrap") },
    {
      id: "export",
      label: "Export as",
      items: [
        { id: "png", label: "PNG", action: () => setLast("Export · PNG") },
        { id: "svg", label: "SVG", action: () => setLast("Export · SVG") },
      ],
    },
    { id: "sep2", separator: true },
    { id: "del", label: "Delete", disabled: true },
  ];
  return (
    <div style={pad}>
      <Menu items={items} side="bottom" align="start">
        {({ ref, toggle, open, id, ...aria }) => (
          <Button
            ref={ref as React.Ref<HTMLButtonElement>}
            id={id}
            onClick={toggle}
            iconEnd="chevDown"
            {...aria}
          >
            {open ? "Menu (open)" : "Menu"}
          </Button>
        )}
      </Menu>
      <p style={note}>Last action: {last}</p>
    </div>
  );
}

// ─── MenuBar ───────────────────────────────────────────────────
// Horizontal application menu bar from a data model. Click a top-level menu to
// open it; once open, hovering siblings switches between them.
function MenuBarDemo() {
  const [last, setLast] = useState<string>("—");
  const fire = (l: string) => () => setLast(l);
  const menus: MenuBarEntry[] = [
    {
      id: "file",
      label: "File",
      items: [
        { id: "new", label: "New", shortcut: "⌘N", action: fire("File · New") },
        { id: "open", label: "Open…", shortcut: "⌘O", action: fire("File · Open") },
        { id: "s1", separator: true },
        { id: "save", label: "Save", shortcut: "⌘S", action: fire("File · Save") },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { id: "undo", label: "Undo", shortcut: "⌘Z", action: fire("Edit · Undo") },
        { id: "redo", label: "Redo", shortcut: "⇧⌘Z", action: fire("Edit · Redo") },
        { id: "e1", separator: true },
        { id: "cut", label: "Cut", disabled: true },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        { id: "grid", label: "Show grid", checked: true, action: fire("View · Grid") },
        { id: "ruler", label: "Show rulers", checked: false, action: fire("View · Rulers") },
      ],
    },
  ];
  return (
    <div style={pad}>
      <MenuBar menus={menus} />
      <p style={note}>Last action: {last}</p>
    </div>
  );
}

// ─── ContextMenu ───────────────────────────────────────────────
// Wraps a region; opens at the pointer on right-click / contextmenu. A Button
// inside makes the right-clickable target obvious.
function ContextMenuDemo() {
  const [last, setLast] = useState<string>("—");
  const items: MenuItemDef[] = [
    { id: "cut", label: "Cut", shortcut: "⌘X", action: () => setLast("Cut") },
    { id: "copy", label: "Copy", shortcut: "⌘C", action: () => setLast("Copy") },
    { id: "paste", label: "Paste", shortcut: "⌘V", action: () => setLast("Paste") },
    { id: "s1", separator: true },
    { id: "lock", label: "Locked", checked: false, action: () => setLast("Toggle lock") },
    { id: "del", label: "Delete", action: () => setLast("Delete") },
  ];
  return (
    <div style={pad}>
      <ContextMenu items={items}>
        <Button block variant="ghost">
          Right-click anywhere here
        </Button>
      </ContextMenu>
      <p style={note}>Last action: {last}</p>
    </div>
  );
}

// ─── Dialog ────────────────────────────────────────────────────
// Modal dialog: focus-trapped + body-scroll-locked, opened on click and closed
// via Escape, backdrop, the header close button, or a footer action.
function DialogDemo() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string>("—");
  const close = () => setOpen(false);
  return (
    <div style={pad}>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <p style={note}>Last result: {result}</p>
      <Dialog
        open={open}
        onClose={close}
        title="Delete project"
        description="This action cannot be undone."
        width={360}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setResult("Cancelled");
                close();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setResult("Deleted");
                close();
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        Are you sure you want to permanently delete this project and all of its
        contents?
      </Dialog>
    </div>
  );
}

// ─── Toast ─────────────────────────────────────────────────────
// useToast() must run under a <ToastProvider>, so the firing UI lives in a
// child component; the provider is rendered by the demo wrapper.
function ToastButtons() {
  const toast = useToast();
  return (
    <div style={pad}>
      <p style={note}>Fire a toast — auto-dismisses, or use the action.</p>
      <div style={{ display: "grid", gap: 6 }}>
        <Button
          variant="primary"
          onClick={() => {
            const id = toast.push({
              title: "Saved",
              message: "Your changes were saved.",
              variant: "success",
              action: { label: "Undo", onClick: () => toast.dismiss(id) },
            });
          }}
        >
          Success + Undo
        </Button>
        <Button onClick={() => toast.push({ message: "Heads up — export queued.", variant: "info" })}>
          Info
        </Button>
        <Button
          variant="danger"
          onClick={() => toast.push({ title: "Failed", message: "Could not reach the server.", variant: "error", duration: null })}
        >
          Error (sticky)
        </Button>
        <Button variant="ghost" onClick={() => toast.clear()}>
          Clear all
        </Button>
      </div>
    </div>
  );
}
function ToastDemo() {
  return (
    <ToastProvider placement="bottom-right" max={3}>
      <ToastButtons />
    </ToastProvider>
  );
}

// ─── Native dialogs ────────────────────────────────────────────
// Tauri plugin-dialog wrappers. Outside a Tauri webview these resolve to safe
// defaults (null / false / no-op) instead of throwing, so the demo is harmless
// in `vite dev`. The readout shows whatever the helper resolved to.
function NativeDialogsDemo() {
  const [result, setResult] = useState<string>("—");
  const show = (label: string) => (value: unknown) =>
    setResult(`${label} → ${JSON.stringify(value)}`);
  return (
    <div style={pad}>
      <p style={note}>
        Native OS dialogs (Tauri). Outside Tauri they resolve to safe defaults.
      </p>
      <div style={{ display: "grid", gap: 6 }}>
        <Button
          onClick={() =>
            openFile({
              title: "Open an image",
              filters: [{ name: "Images", extensions: ["png", "jpeg", "webp"] }],
            }).then(show("openFile"))
          }
        >
          openFile
        </Button>
        <Button
          onClick={() =>
            saveFile({
              title: "Export as…",
              defaultPath: "untitled.png",
              filters: [{ name: "PNG", extensions: ["png"] }],
            }).then(show("saveFile"))
          }
        >
          saveFile
        </Button>
        <Button
          variant="danger"
          onClick={() =>
            confirm("Delete this file permanently?", {
              title: "Confirm delete",
              kind: "warning",
              okLabel: "Delete",
            }).then(show("confirm"))
          }
        >
          confirm
        </Button>
        <Button
          onClick={() =>
            ask("Save changes before closing?", {
              okLabel: "Save",
              cancelLabel: "Discard",
            }).then(show("ask"))
          }
        >
          ask
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            message("Export complete.", { title: "Done" }).then(show("message"))
          }
        >
          message
        </Button>
      </div>
      <p style={note}>Result: {result}</p>
    </div>
  );
}

// ─── catalog ───────────────────────────────────────────────────
export const overlaysEntries: GalleryEntry[] = [
  {
    id: "overlays/Tooltip",
    label: "Tooltip",
    category: "Overlays",
    section: "Components",
    render: () => <TooltipDemo />,
  },
  {
    id: "overlays/Popover",
    label: "Popover",
    category: "Overlays",
    section: "Components",
    render: () => <PopoverDemo />,
  },
  {
    id: "overlays/Menu",
    label: "Menu",
    category: "Overlays",
    section: "Components",
    render: () => <MenuDemo />,
  },
  {
    id: "overlays/MenuBar",
    label: "MenuBar",
    category: "Overlays",
    section: "Components",
    render: () => <MenuBarDemo />,
  },
  {
    id: "overlays/ContextMenu",
    label: "ContextMenu",
    category: "Overlays",
    section: "Components",
    render: () => <ContextMenuDemo />,
  },
  {
    id: "overlays/Dialog",
    label: "Dialog",
    category: "Overlays",
    section: "Components",
    render: () => <DialogDemo />,
  },
  {
    id: "overlays/Toast",
    label: "Toast",
    category: "Overlays",
    section: "Components",
    render: () => <ToastDemo />,
  },
  {
    id: "overlays/NativeDialogs",
    label: "Native dialogs",
    category: "Overlays",
    section: "Components",
    render: () => <NativeDialogsDemo />,
  },
];
