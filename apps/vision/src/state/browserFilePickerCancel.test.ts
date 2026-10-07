import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  new URL("./app.ts", import.meta.url),
  new URL("../ui/Dialogs.tsx", import.meta.url),
];

describe("browser file pickers", () => {
  it("settles and removes every file input when the chooser is cancelled", () => {
    const pickers: { file: string; line: number; body: string; name: string }[] = [];
    for (const url of files) {
      const source = readFileSync(url, "utf8");
      const pattern = /(?:const|let)\s+(\w+)\s*=\s*document\.createElement\(["']input["']\);([\s\S]*?)\1\.click\(\);/g;
      for (const match of source.matchAll(pattern)) {
        const [, name, body] = match;
        if (!new RegExp(`${name}\\.type\\s*=\\s*["']file["']`).test(body)) continue;
        pickers.push({ file: url.pathname, line: source.slice(0, match.index).split("\n").length, body, name });
      }
    }

    expect(pickers).toHaveLength(23);
    expect(pickers.filter(({ body, name }) => !new RegExp(`${name}\\.oncancel\\s*=`).test(body))
      .map(({ file, line }) => `${file}:${line}`)).toEqual([]);
    expect(pickers.filter(({ body, name }) => !new RegExp(`${name}\\.remove\\(`).test(body))
      .map(({ file, line }) => `${file}:${line}`)).toEqual([]);
  });
});
