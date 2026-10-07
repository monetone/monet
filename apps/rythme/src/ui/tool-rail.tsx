// ─────────────────────────────────────────────────────────────
// ui/tool-rail — the editor tool rail
// ─────────────────────────────────────────────────────────────
// A flat rail emitting Monet's `.monet-tool` / `.monet-divider` elements so it
// inherits the chrome's column/row layout inside the relocatable Toolbar.

import { Icon, I, Tooltip, toolTip } from "@monet-ui/monet-react";
import { setTool } from "../engine";
import { useEditorState, useStore } from "../state/store-context";
import { TOOL_META, TOOL_RAIL } from "../tools/registry";

const META = new Map(TOOL_META.map((m) => [m.id, m]));
const iconPath = (icon: string): string => (I as Record<string, string>)[icon] ?? icon;

export function RythmeToolRail({ orientation = "v" }: { orientation?: "v" | "h" }) {
  const store = useStore();
  const { tool } = useEditorState();
  // Tips fly out to the side the rail doesn't occupy, opening after a 1s dwell.
  const side = orientation === "h" ? "bottom" : "right";

  return (
    <>
      {TOOL_RAIL.map((entry, i) => {
        if (entry === "div") return <div key={`div-${i}`} className="monet-divider" data-orient={orientation} />;
        const m = META.get(entry);
        if (!m) return null;
        const active = tool === entry;
        const label = `${m.name} (${m.shortcut})`;
        return (
          <Tooltip key={entry} content={toolTip(label, m.hint)} delay={1000} side={side}>
            <div
              className={`monet-tool ${active ? "is-active" : ""}`}
              data-orient={orientation}
              role="button"
              aria-pressed={active}
              aria-label={label}
              tabIndex={0}
              onClick={() => store.dispatch(setTool(m.id), { history: false })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  store.dispatch(setTool(m.id), { history: false });
                }
              }}
            >
              <Icon d={iconPath(m.icon)} size={16} />
            </div>
          </Tooltip>
        );
      })}
    </>
  );
}
