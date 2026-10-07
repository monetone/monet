import type { AppSnapshot } from "../state/store";

// ── Home start screen (#476) ─────────────────────────────────────────────
// Photoshop's Home: shown instead of the workspace while no document is open
// (cold launch, or the last tab closed). Recent files as a thumbnail grid that
// opens the file, plus New and Open cards routed to the existing New-document
// dialog and open flow. A pure component — the Editor hands it the live recent
// list and its own File-menu handlers, so it never touches the engine.

export type RecentFile = AppSnapshot["recentFiles"][number];

/** Locale short date for a recent card; "" for entries recorded before dates existed. */
export function formatRecentDate(openedAt?: number): string {
  if (!openedAt) return "";
  return new Date(openedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function Home({ recents, onNew, onOpen, onOpenRecent }: {
  recents: readonly RecentFile[];
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
}) {
  return (
    <div className="mv-home" data-mv-home-screen="" role="region" aria-label="Home">
      <div className="mv-home-inner">
        <h1 className="mv-home-title">Welcome to Monet Vision</h1>
        <div className="mv-home-actions">
          <button type="button" className="mv-home-card mv-home-card-new" data-mv-home-new="" onClick={onNew}>
            <span className="mv-home-card-icon" aria-hidden="true">+</span>
            <span>New file</span>
          </button>
          <button type="button" className="mv-home-card" data-mv-home-open="" onClick={onOpen}>
            <span className="mv-home-card-icon" aria-hidden="true">⌂</span>
            <span>Open…</span>
          </button>
        </div>
        <h2 className="mv-home-heading">Recent</h2>
        {recents.length ? (
          <div className="mv-home-grid">
            {recents.map((r) => (
              <button key={r.path} type="button" className="mv-home-recent" title={r.path}
                data-mv-home-recent={r.path} onClick={() => onOpenRecent(r.path)}>
                <span className="mv-home-thumb">
                  {r.thumb
                    ? <img src={r.thumb} alt="" />
                    : <span className="mv-home-thumb-ext">{r.name.replace(/^.*\./, "")}</span>}
                </span>
                <span className="mv-home-name">{r.name}</span>
                <span className="mv-home-date">{formatRecentDate(r.openedAt)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mv-home-empty">Files you open or save will appear here.</p>
        )}
      </div>
    </div>
  );
}
