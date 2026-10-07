// ─────────────────────────────────────────────────────────────
// Monet — TreeView ("monet-cv-tree")
// ─────────────────────────────────────────────────────────────
// Generic recursive tree (WAI-ARIA tree pattern): one roving tab stop;
// ArrowUp/Down move between visible rows; ArrowRight/Left expand/collapse-or-
// move; Home/End jump to ends. Selection + expansion are each independently
// controllable. LayerTree (a later wave) reuses this. Split out of
// creative-inspector.tsx purely for file size and re-exported from it (and the
// package barrel), so the public surface is a single module.

import React, {
  forwardRef,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { Icon, I } from "./icons";
import { useControllableState, cx } from "./internal";

export interface TreeNode {
  id: string;
  label: ReactNode;
  icon?: string;
  children?: TreeNode[];
  disabled?: boolean;
  /** Arbitrary payload handed back to onSelect / renderNode. */
  data?: unknown;
}

export interface TreeRenderInfo {
  depth: number;
  expanded: boolean;
  selected: boolean;
  hasChildren: boolean;
}

export interface TreeViewProps {
  nodes: TreeNode[];
  /** Controlled selected id. */
  selectedId?: string;
  /** Initial selected id when uncontrolled. */
  defaultSelectedId?: string;
  onSelect?: (id: string, node: TreeNode) => void;
  /** Controlled expanded ids. */
  expandedIds?: string[];
  /** Initial expanded ids when uncontrolled. */
  defaultExpandedIds?: string[];
  onExpandedChange?: (ids: string[]) => void;
  /** Replace the default row content (twisty + icon + label still wrap it). */
  renderNode?: (node: TreeNode, info: TreeRenderInfo) => ReactNode;
  /** Indentation per depth level, in px. Defaults to 14. */
  indent?: number;
  "aria-label"?: string;
  className?: string;
}

/** A flattened, visible (un-collapsed) row used for keyboard navigation. */
interface FlatRow {
  node: TreeNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

function flattenVisible(
  nodes: TreeNode[],
  expanded: Set<string>,
  depth: number,
  out: FlatRow[],
): void {
  for (const node of nodes) {
    const kids = node.children ?? [];
    const hasChildren = kids.length > 0;
    const isExpanded = hasChildren && expanded.has(node.id);
    out.push({ node, depth, hasChildren, expanded: isExpanded });
    if (isExpanded) flattenVisible(kids, expanded, depth + 1, out);
  }
}

/** Generic recursive tree (role=tree). */
export const TreeView = forwardRef<HTMLDivElement, TreeViewProps>(
  function TreeView(
    {
      nodes,
      selectedId,
      defaultSelectedId,
      onSelect,
      expandedIds,
      defaultExpandedIds,
      onExpandedChange,
      renderNode,
      indent = 14,
      className,
      ...aria
    },
    ref,
  ) {
    // Selection state only; onSelect is fired from `select()` (it needs the
    // node object, not just the id, so we don't route it through the helper).
    const [selected, setSelected] = useControllableState<string | undefined>(
      selectedId,
      defaultSelectedId,
      undefined,
    );
    const [expanded, setExpanded] = useControllableState<string[]>(
      expandedIds,
      defaultExpandedIds ?? [],
      onExpandedChange,
    );
    const expandedSet = React.useMemo(() => new Set(expanded), [expanded]);
    const els = useRef<Record<string, HTMLDivElement | null>>({});

    const rows = React.useMemo(() => {
      const out: FlatRow[] = [];
      flattenVisible(nodes, expandedSet, 1, out);
      return out;
    }, [nodes, expandedSet]);

    const liveRows = rows.filter((r) => !r.node.disabled);
    // Roving tab stop: the selected row if it is visible, else the first row.
    // (#199) Resolved against liveRows — the render vetoes a disabled tab stop
    // (`isTabStop && !node.disabled`), so a selectedId pointing at a disabled
    // node left every row at tabIndex -1 and the whole tree out of the tab order.
    const tabStopId =
      selected && liveRows.some((r) => r.node.id === selected)
        ? selected
        : liveRows[0]?.node.id;

    const select = useCallback(
      (node: TreeNode) => {
        setSelected(node.id);
        onSelect?.(node.id, node);
      },
      [setSelected, onSelect],
    );

    const setExpand = useCallback(
      (id: string, open: boolean) => {
        const has = expandedSet.has(id);
        if (open === has) return;
        setExpanded(open ? [...expanded, id] : expanded.filter((x) => x !== id));
      },
      [expandedSet, expanded, setExpanded],
    );

    const focusRow = (id: string | undefined) => {
      if (id) els.current[id]?.focus();
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, row: FlatRow) => {
      const { node, hasChildren, expanded: isOpen } = row;
      if (node.disabled) return;
      const idx = liveRows.findIndex((r) => r.node.id === node.id);
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          focusRow(liveRows[Math.min(idx + 1, liveRows.length - 1)]?.node.id);
          break;
        case "ArrowUp":
          e.preventDefault();
          focusRow(liveRows[Math.max(idx - 1, 0)]?.node.id);
          break;
        case "Home":
          e.preventDefault();
          focusRow(liveRows[0]?.node.id);
          break;
        case "End":
          e.preventDefault();
          focusRow(liveRows[liveRows.length - 1]?.node.id);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (hasChildren && !isOpen) setExpand(node.id, true);
          else if (hasChildren && isOpen) {
            // move to first child (the next visible row, which is deeper)
            const next = liveRows[idx + 1];
            if (next && next.depth > row.depth) focusRow(next.node.id);
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (hasChildren && isOpen) setExpand(node.id, false);
          else {
            // move to parent: the nearest preceding row with a smaller depth
            for (let j = idx - 1; j >= 0; j--) {
              if (liveRows[j].depth < row.depth) {
                focusRow(liveRows[j].node.id);
                break;
              }
            }
          }
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          select(node);
          if (hasChildren) setExpand(node.id, !isOpen);
          break;
        default:
          return;
      }
    };

    return (
      <div
        ref={ref}
        role="tree"
        aria-label={aria["aria-label"]}
        className={cx("monet-cv-tree", className)}
      >
        {rows.map((row) => {
          const { node, depth, hasChildren, expanded: isOpen } = row;
          const isSelected = node.id === selected;
          const isTabStop = node.id === tabStopId;
          const info: TreeRenderInfo = {
            depth,
            expanded: isOpen,
            selected: isSelected,
            hasChildren,
          };
          return (
            <div
              key={node.id}
              ref={(el) => {
                els.current[node.id] = el;
              }}
              role="treeitem"
              aria-level={depth}
              aria-selected={isSelected}
              aria-expanded={hasChildren ? isOpen : undefined}
              aria-disabled={node.disabled || undefined}
              tabIndex={isTabStop && !node.disabled ? 0 : -1}
              className={cx("monet-cv-treeitem", isSelected && "is-selected")}
              style={
                {
                  ["--monet-cv-depth" as string]: depth,
                  ["--monet-cv-indent" as string]: `${indent}px`,
                } as React.CSSProperties
              }
              onClick={(e) => {
                if (node.disabled) return;
                e.stopPropagation();
                select(node);
              }}
              onKeyDown={(e) => onKeyDown(e, row)}
            >
              {renderNode ? (
                renderNode(node, info)
              ) : (
                <>
                  <span
                    className={cx("monet-cv-twisty", hasChildren && "is-branch")}
                    aria-hidden="true"
                    onClick={(e) => {
                      if (!hasChildren || node.disabled) return;
                      e.stopPropagation();
                      setExpand(node.id, !isOpen);
                    }}
                  >
                    {hasChildren && <Icon d={isOpen ? I.chevDown : I.chevRight} size={11} />}
                  </span>
                  {node.icon && (
                    <span className="monet-cv-treeitem-icon" aria-hidden="true">
                      <Icon d={I[node.icon as keyof typeof I] || node.icon} size={13} />
                    </span>
                  )}
                  <span className="monet-cv-treeitem-label">{node.label}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  },
);
