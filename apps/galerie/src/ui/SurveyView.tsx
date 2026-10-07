// SurveyView — LR's Survey (N): every selected photo laid out to fit the screen
// at once, for narrowing a shortlist. Clicking a tile makes it the active photo;
// culling keys (flags/ratings) apply to it. Read-only viewer over the previews.

import type { PhotoRow } from "../catalog/types";
import { store, useCatalog } from "../state/store";
import { basename } from "./GridCell";
import { PreviewImg } from "./PreviewImg";

export function SurveyView() {
  const st = useCatalog();
  const chosen: PhotoRow[] = st.selection.length
    ? st.photos.filter((p) => st.selection.includes(p.id))
    : st.activeId != null
      ? st.photos.filter((p) => p.id === st.activeId)
      : [];

  if (chosen.length === 0) {
    return (
      <div className="gal-empty">
        <div className="gal-empty-title">Nothing to survey</div>
        <div className="gal-empty-sub">Select photos in the grid, then press N.</div>
      </div>
    );
  }

  return (
    <div className="gal-survey">
      {chosen.map((p) => (
        <div
          key={p.id}
          className={"gal-survey-cell" + (p.id === st.activeId ? " is-active" : "")}
          role="button"
          tabIndex={0}
          title={basename(p.path)}
          onClick={() => store.setActive(p.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              store.setActive(p.id);
            }
          }}
        >
          <PreviewImg photo={p} edge={1280} className="gal-survey-img" />
          {st.selection.length > 0 && (
            <button
              className="gal-survey-cull"
              title="Remove from survey"
              aria-label={`Remove ${basename(p.path)} from survey`}
              onClick={(e) => {
                e.stopPropagation();
                store.select(p.id, true);
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
