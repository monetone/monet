// SoloStack — LR-style panel collapse/Solo coordinator for the Develop rail.
// Plain click on a panel header (.gal-dev-head) toggles that panel closed or
// open; ⌥-click solos it (collapses every sibling; ⌥-click on the soloed panel
// restores all). Clicks on interactive header controls (Reset buttons, inputs)
// pass through untouched, so panels need no changes of their own.

import { Children, useState, type ReactNode } from "react";

/** Next collapsed-index set after clicking panel `index` of `count`. */
export function nextCollapsed(
  prev: ReadonlySet<number>,
  index: number,
  solo: boolean,
  count: number,
): Set<number> {
  if (!solo) {
    const next = new Set(prev);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return next;
  }
  const alreadySoloed = !prev.has(index) && prev.size === count - 1;
  if (alreadySoloed) return new Set();
  const next = new Set<number>();
  for (let i = 0; i < count; i++) if (i !== index) next.add(i);
  return next;
}

export function SoloStack({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  return (
    <>
      {items.map((child, i) => (
        <div
          key={i}
          className={"gal-solo" + (collapsed.has(i) ? " is-collapsed" : "")}
          onClickCapture={(e) => {
            const el = e.target as Element;
            if (el.closest("button, input, select, textarea, a, [role=button]")) return;
            if (!el.closest(".gal-dev-head")) return;
            e.stopPropagation();
            setCollapsed((prev) => nextCollapsed(prev, i, e.altKey, items.length));
          }}
        >
          {child}
        </div>
      ))}
    </>
  );
}
