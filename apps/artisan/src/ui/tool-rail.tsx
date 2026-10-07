// ─────────────────────────────────────────────────────────────
// ui/tool-rail — Adobe Illustrator-style tool rail.
//
// One icon per group; related tools tuck into a click-hold flyout (the slot
// carries a corner-triangle badge when it hides extra tools). This keeps the
// rail to ~two dozen slots — Illustrator's default — without dropping any tool.
// Rendered `inline` inside Monet's relocatable <Toolbar>, so it emits the same
// `.monet-tool` / `.monet-divider` elements as Monet's flat ToolRail and
// inherits its column/row layout.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { Icon, I, Popover, Tooltip, toolTip } from "@monet-ui/monet-react";
import { useEditorState, useStore } from "../state/store-context";
import { TOOL_META, TOOL_RAIL_GROUPS } from "../tools/registry";

const META = new Map(TOOL_META.map((m) => [m.id, m]));
const iconPath = (icon: string): string => (I as Record<string, string>)[icon] ?? icon;
const labelOf = (id: string): string => {
  const m = META.get(id);
  if (!m) return id;
  return m.shortcut ? `${m.name} (${m.shortcut})` : m.name;
};

const HOLD_MS = 240;

// Illustrator's drawing-mode cluster at the foot of the toolbar: where new art
// lands — on top, behind, or clipped inside the selected object.
const DRAW_MODES: { id: "normal" | "behind" | "inside"; label: string; glyph: string }[] = [
  { id: "normal", label: "Draw Normal", glyph: "▢" },
  { id: "behind", label: "Draw Behind", glyph: "⬓" },
  { id: "inside", label: "Draw Inside", glyph: "⬚" },
];

export function ArtisanToolRail({ orientation = "v" }: { orientation?: "v" | "h" }) {
  const store = useStore();
  const { tool, drawingMode } = useEditorState();
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  // Each slot remembers the last-used tool in its group (like Illustrator), so
  // switching tools — even via keyboard shortcut — keeps the right icon visible.
  const [lastPicked, setLastPicked] = useState<Record<number, string>>({});
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const gi = TOOL_RAIL_GROUPS.findIndex((g) => Array.isArray(g) && g.includes(tool));
    if (gi >= 0) setLastPicked((p) => (p[gi] === tool ? p : { ...p, [gi]: tool }));
  }, [tool]);

  const clearHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const select = (id: string) => {
    clearHold();
    setOpenGroup(null);
    store.setTool(id);
  };

  const side = orientation === "v" ? "right" : "bottom";

  return (
    <>
      {TOOL_RAIL_GROUPS.map((entry, gi) => {
        if (entry === "div") {
          return <div key={`div-${gi}`} className="monet-divider" data-orient={orientation} />;
        }

        const group = entry;
        const multi = group.length > 1;
        const visible = group.includes(tool) ? tool : lastPicked[gi] ?? group[0];
        const isActive = group.includes(tool);
        const meta = META.get(visible);

        const slot = (
          <div
            key={group[0]}
            className={`monet-tool ${isActive ? "is-active" : ""}`}
            data-orient={orientation}
            role="button"
            aria-pressed={isActive}
            aria-label={labelOf(visible)}
            aria-haspopup={multi ? "menu" : undefined}
            tabIndex={0}
            onPointerDown={(e) => {
              if (e.button !== 0 || !multi) return;
              clearHold();
              holdTimer.current = setTimeout(() => {
                holdTimer.current = null;
                setOpenGroup(gi);
              }, HOLD_MS);
            }}
            onPointerUp={() => {
              // A short tap (timer still pending) selects the visible tool; a
              // hold (timer already fired → flyout open) leaves it open.
              if (multi && holdTimer.current) select(visible);
            }}
            onPointerLeave={clearHold}
            onClick={() => {
              if (!multi) select(visible);
            }}
            onContextMenu={(e) => {
              if (!multi) return;
              e.preventDefault();
              setOpenGroup((g) => (g === gi ? null : gi));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                select(visible);
              } else if (multi && (e.key === "ArrowRight" || e.key === "ArrowDown")) {
                e.preventDefault();
                setOpenGroup(gi);
              }
            }}
          >
            <Icon d={iconPath(meta?.icon ?? "")} size={16} />
            {multi && <span className="badge" />}
          </div>
        );

        // A 1s-dwell tooltip on the visible tool. For flyout groups it nests
        // inside the Popover so both share the slot as their anchor; it's
        // suppressed while that group's flyout is open. `side` (declared above,
        // and reused by the flyout) points tips away from the rail edge.
        const tip = toolTip(labelOf(visible), meta?.description);

        if (!multi) {
          return (
            <Tooltip key={group[0]} content={tip} delay={1000} side={side}>
              {slot}
            </Tooltip>
          );
        }

        return (
          <Popover
            key={group[0]}
            open={openGroup === gi}
            onOpenChange={(o) => setOpenGroup(o ? gi : null)}
            side={side}
            align="start"
            offset={6}
            trapFocus={false}
            role="menu"
            label={`${meta?.name ?? "Tool"} group`}
            className="monet-flyout"
            content={
              <div className="monet-flyout-list">
                {group.map((id) => {
                  const m = META.get(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={id === tool}
                      aria-label={m?.name ?? id}
                      className={`monet-flyout-item ${id === tool ? "is-active" : ""}`}
                      onClick={() => select(id)}
                    >
                      <span className="monet-flyout-icon">
                        <Icon d={iconPath(m?.icon ?? "")} size={16} />
                      </span>
                      <span className="monet-flyout-label">{m?.name ?? id}</span>
                      {m?.shortcut && <span className="artisan-flyout-key">{m.shortcut}</span>}
                    </button>
                  );
                })}
              </div>
            }
          >
            <Tooltip content={tip} delay={1000} side={side} disabled={openGroup === gi}>
              {slot}
            </Tooltip>
          </Popover>
        );
      })}
      <div className="monet-divider" data-orient={orientation} />
      {DRAW_MODES.map((m) => (
        <div
          key={m.id}
          className={`monet-tool ${drawingMode === m.id ? "is-active" : ""}`}
          data-orient={orientation}
          data-draw-mode={m.id}
          role="button"
          aria-pressed={drawingMode === m.id}
          aria-label={m.label}
          title={m.label}
          tabIndex={0}
          onClick={() => store.setDrawingMode(m.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              store.setDrawingMode(m.id);
            }
          }}
        >
          <span style={{ fontSize: 14 }}>{m.glyph}</span>
        </div>
      ))}
    </>
  );
}
