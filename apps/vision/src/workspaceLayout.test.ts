import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("Vision workspace persistence", () => {
  it("keeps the factory reset seed separate from the persisted live layout", () => {
    const start = appSource.indexOf("<DockableWorkspace\n");
    const end = appSource.indexOf("\n      />", start);
    const workspace = appSource.slice(start, end);
    expect(workspace).toContain("initialLayout={initialLayout}");
    expect(appSource).toContain("const [persistedLayout] = useState(loadLastLayoutLS);");
    expect(workspace).toContain("layout={persistedLayout ?? undefined}");
    expect(workspace).not.toContain("layout={loadLastLayoutLS()");
  });
});
