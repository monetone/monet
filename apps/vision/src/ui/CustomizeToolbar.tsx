import { useState, type DragEvent } from "react";
import { Button, Dialog, Icon, I, Popover, Select } from "@monet-ui/monet-react";
import { store } from "../state/app";
import type { ToolId } from "../state/store";
import { TOOL_DEFS, factoryToolbarConfiguration, moveToolbarSlot, moveToolbarTool, type ToolbarConfiguration } from "../state/toolRail";
import { useDialogs } from "./dialogs/common";

const TOOL_DRAG_TYPE = "application/x-monet-toolbar-tool";
const icon = (id: ToolId) => I[TOOL_DEFS[id].icon as keyof typeof I] || TOOL_DEFS[id].icon;
const name = (id: ToolId) => TOOL_DEFS[id].name.replace(/\s*\([^)]*\)\s*$/, "");

/** Extra tools stay directly reachable even when the visible rail is empty. */
export function ExtraTools({ tools, active, onSelect, orientation }: {
  tools: ToolId[]; active: ToolId; onSelect: (id: ToolId) => void; orientation: "v" | "h";
}) {
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  return <Popover open={open} onOpenChange={setOpen} side={orientation === "v" ? "right" : "bottom"}
    align="end" role="menu" label="Extra Tools" className="monet-flyout" content={
      <div className="monet-flyout-list" style={{ maxHeight: "65vh", overflowY: "auto" }}
        onKeyDown={(event) => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "ArrowDown" ? (index + 1) % buttons.length
            : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length
              : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); event.stopPropagation(); buttons[next]?.focus(); }
        }}>
        {tools.map((id) => <button key={id} type="button" role="menuitemradio" aria-checked={active === id}
          className={`monet-flyout-item ${active === id ? "is-active" : ""}`} data-mv-extra-tool={id}
          onClick={() => { onSelect(id); setOpen(false); }}>
          <span className="monet-flyout-icon"><Icon d={icon(id)} size={16} /></span>
          <span className="monet-flyout-label">{TOOL_DEFS[id].name}</span>
        </button>)}
      </div>
    }>
    <button type="button" className={`monet-tool ${tools.includes(active) ? "is-active" : ""}`} data-orient={orientation}
      aria-label="Extra Tools" aria-pressed={tools.includes(active)} title="Extra Tools" onClick={() => setOpen(!open)}
      onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); setOpen(true); } }}>
      <Icon d="M3 8h.01M8 8h.01M13 8h.01" size={16} />
    </button>
  </Popover>;
}

export function CustomizeToolbar() {
  const { close } = useDialogs();
  const [draft, setDraft] = useState(store.state.toolbarConfiguration);
  const [selected, setSelected] = useState<ToolId>(store.state.tool);
  const [target, setTarget] = useState("");
  const [error, setError] = useState(store.state.toolbarConfigurationError);
  const slotIndex = draft.slots.findIndex((slot) => slot !== "div" && slot.includes(selected));
  const members = slotIndex < 0 ? draft.extra : draft.slots[slotIndex] as ToolId[];
  const position = members.indexOf(selected);
  const previousSlot = draft.slots.reduce((last, slot, index) => slot !== "div" && index < slotIndex ? index : last, -1);
  const nextSlot = draft.slots.findIndex((slot, index) => slot !== "div" && index > slotIndex);
  const update = (operation: () => ToolbarConfiguration) => {
    try { setDraft(operation()); setTarget(""); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  const move = (id: ToolId, destination: number | "extra", at?: number) => {
    update(() => moveToolbarTool(draft, id, destination, at));
    if (Object.hasOwn(TOOL_DEFS, id)) setSelected(id);
  };
  const drop = (event: DragEvent, destination: number | "extra", at?: number) => {
    event.preventDefault(); event.stopPropagation();
    move(event.dataTransfer.getData(TOOL_DRAG_TYPE) as ToolId, destination, at);
  };
  const allowDrop = (event: DragEvent) => {
    if (event.dataTransfer.types.includes(TOOL_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
  };
  const row = (id: ToolId, destination: number | "extra", at: number) => <button key={id} type="button" draggable
    data-mv-config-tool={id} aria-pressed={selected === id} onClick={() => setSelected(id)}
    onDragStart={(event) => { event.dataTransfer.setData(TOOL_DRAG_TYPE, id); event.dataTransfer.effectAllowed = "move"; setSelected(id); }}
    onDragOver={allowDrop} onDrop={(event) => drop(event, destination, at)}
    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 29, border: 0, borderRadius: 3,
      padding: "4px 8px", textAlign: "left", color: "var(--text-1)", cursor: "grab", fontSize: 12,
      background: selected === id ? "rgba(81,154,255,.2)" : "transparent" }}>
    <Icon d={icon(id)} size={16} /><span>{TOOL_DEFS[id].name}</span>
  </button>;
  const insertSlot = (index: number) => <div data-mv-toolbar-insert={index} onDragOver={allowDrop}
    onDrop={(event) => drop(event, index)} style={{ minHeight: 14, borderBottom: "1px dashed var(--stroke-2)", color: "var(--text-3)", fontSize: 9 }}>
    New slot
  </div>;
  const apply = () => {
    try {
      if (store.setToolbarConfiguration(draft)) close();
      else setError("Could not save the toolbar. Free browser storage and try again.");
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return <Dialog open onClose={close} title="Customize Toolbar" width={740} footer={<>
    <Button variant="ghost" onClick={() => update(factoryToolbarConfiguration)}>Restore Defaults</Button>
    <Button variant="ghost" onClick={() => update(() => ({ version: 1, slots: [], extra: [...draft.slots.flatMap((slot) => slot === "div" ? [] : slot), ...draft.extra] }))}>Clear Tools</Button>
    <span style={{ flex: 1 }} />
    <Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" onClick={apply}>OK</Button>
  </>}>
    <p style={{ color: "var(--text-3)", fontSize: 12, marginTop: 0 }}>Drag tools onto another tool to group them, between slots to separate them, or into Extra Tools. Changes apply with OK and are included when saving a workspace.</p>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div><strong style={{ fontSize: 12 }}>Toolbar</strong>
        <div role="group" aria-label="Toolbar slots" style={{ height: 340, overflowY: "auto", border: "1px solid var(--stroke-2)", padding: 8 }}>
          {draft.slots.map((slot, index) => slot === "div" ? <hr key={`div-${index}`} /> : <div key={slot.join(",")}>
            {insertSlot(index)}
            <div data-mv-toolbar-slot={index} role="group" aria-label={`Slot ${index + 1}: ${name(slot[0])}`}
              onDragOver={allowDrop} onDrop={(event) => drop(event, index, slot.length)}
              style={{ border: "1px solid var(--stroke-2)", borderRadius: 4, marginTop: 4, padding: 3 }}>
              {slot.map((id, at) => row(id, index, at))}
            </div>
          </div>)}
          {insertSlot(draft.slots.length)}
        </div>
      </div>
      <div><strong style={{ fontSize: 12 }}>Extra Tools</strong>
        <div role="group" aria-label="Extra Tools" onDragOver={allowDrop} onDrop={(event) => drop(event, "extra")}
          style={{ height: 340, overflowY: "auto", border: "1px solid var(--stroke-2)", padding: 8 }}>
          {draft.extra.map((id, at) => row(id, "extra", at))}
          {!draft.extra.length && <p style={{ fontSize: 12, color: "var(--text-3)" }}>Drop tools here to keep them behind the … button. Their keyboard shortcuts stay available.</p>}
        </div>
      </div>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
      <Button variant="ghost" disabled={position <= 0} onClick={() => move(selected, slotIndex < 0 ? "extra" : slotIndex, position - 1)}>Move Tool Up</Button>
      <Button variant="ghost" disabled={position < 0 || position >= members.length - 1} onClick={() => move(selected, slotIndex < 0 ? "extra" : slotIndex, position + 2)}>Move Tool Down</Button>
      <Button variant="ghost" disabled={previousSlot < 0} onClick={() => update(() => moveToolbarSlot(draft, slotIndex, previousSlot))}>Move Slot Up</Button>
      <Button variant="ghost" disabled={slotIndex < 0 || nextSlot < 0} onClick={() => update(() => moveToolbarSlot(draft, slotIndex, nextSlot + 1))}>Move Slot Down</Button>
      <Button variant="ghost" disabled={slotIndex < 0 || members.length < 2} onClick={() => move(selected, slotIndex + 1)}>Ungroup Tool</Button>
      <Button variant="ghost" onClick={() => move(selected, slotIndex < 0 ? draft.slots.length : "extra")}>{slotIndex < 0 ? "Add to Toolbar" : "Move to Extra Tools"}</Button>
    </div>
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
      <label style={{ fontSize: 12 }}>Group selected tool with <Select aria-label="Destination tool group" style={{ marginLeft: 6 }} value={target} onChange={setTarget}
        options={[{ value: "", label: "Choose a group" }, ...draft.slots.flatMap((slot, index) => slot === "div" || index === slotIndex ? [] : [{ value: String(index), label: name(slot[0]) }])]} /></label>
      <Button variant="ghost" disabled={!target} onClick={() => { const index = Number(target); const slot = draft.slots[index]; if (Array.isArray(slot)) move(selected, index, slot.length); }}>Group Tool</Button>
    </div>
    {error && <div role="alert" style={{ marginTop: 8, fontSize: 12 }}>{error}</div>}
  </Dialog>;
}
