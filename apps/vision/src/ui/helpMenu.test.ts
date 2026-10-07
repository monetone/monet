import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Help dialog wiring", () => {
  it("routes About and System Info to one versioned runtime dialog", () => {
    const app = read("../App.tsx");
    const dialogs = read("./Dialogs.tsx");
    const common = read("./dialogs/common.tsx");

    expect(app).toContain('about: () => open("about")');
    expect(app).toContain('systeminfo: () => open("about", "systemInfo")');
    expect(common).toMatch(/DialogName[\s\S]*\| "about"/);
    expect(dialogs).toContain('case "about": return <About />');
    for (const detail of ["VISION_CONTAINER_APP.version", "engine.version()", "WebAssembly", "isTauri()", "navigator.platform"]) {
      expect(dialogs).toContain(detail);
    }
  });
});
