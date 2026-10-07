import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { printPng } from "./print";

const PAGE_CSS = "@page{size:8.5in 11in;margin:0}img{position:absolute;left:1in;top:2in;width:4in;height:3in}";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function printFrame(load: "success" | "error" | "never", spool: "afterprint" | "throw" | "pending") {
  const events: string[] = [];
  const head: unknown[] = [];
  const body: unknown[] = [];
  let afterPrint: (() => void) | null = null;
  const image = {
    alt: "",
    onload: null as null | (() => void),
    onerror: null as null | (() => void),
    set src(value: string) {
      events.push(`image:${value}`);
      if (load === "success") {
        events.push("loaded");
        image.onload?.();
      } else if (load === "error") {
        image.onerror?.();
      }
    },
  };
  const frame = {
    title: "",
    style: { cssText: "" },
    contentDocument: {
      head: { replaceChildren: (...nodes: unknown[]) => head.push(...nodes) },
      body: { replaceChildren: (...nodes: unknown[]) => body.push(...nodes) },
      createElement: (tag: string) => tag === "style" ? { textContent: "" } : image,
    },
    contentWindow: {
      focus: () => events.push("focus"),
      addEventListener: (type: string, callback: () => void) => {
        if (type === "afterprint") afterPrint = callback;
      },
      print: () => {
        events.push("print");
        if (spool === "throw") throw new Error("spool failed");
        if (spool === "afterprint") afterPrint?.();
      },
    },
    setAttribute: () => {},
    remove: () => events.push("remove"),
  };
  vi.stubGlobal("document", {
    body: { appendChild: () => events.push("append") },
    createElement: () => frame,
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:vision-print");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => events.push("revoke"));
  return { body, events, head, image };
}

describe("Vision printing", () => {
  it("loads the composite in an isolated frame before printing, then cleans up", async () => {
    const { body, events, head, image } = printFrame("success", "afterprint");

    await printPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), PAGE_CSS);

    expect((head[0] as { textContent: string }).textContent).toBe(PAGE_CSS);
    expect(body).toEqual([image]);
    expect(events).toEqual([
      "append",
      "image:blob:vision-print",
      "loaded",
      "focus",
      "print",
      "remove",
      "revoke",
    ]);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: "image/png" }));
  });

  it("cleans every failed exit without leaving a timer", async () => {
    vi.useFakeTimers();
    let setup = printFrame("error", "pending");
    await expect(printPng(new Uint8Array([1]), PAGE_CSS)).rejects.toThrow("could not be loaded");
    expect(setup.events.filter((event) => event === "remove" || event === "revoke"))
      .toEqual(["remove", "revoke"]);
    expect(vi.getTimerCount()).toBe(0);

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setup = printFrame("success", "throw");
    await expect(printPng(new Uint8Array([1]), PAGE_CSS)).rejects.toThrow("spool failed");
    expect(setup.events.filter((event) => event === "remove" || event === "revoke"))
      .toEqual(["remove", "revoke"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses bounded cleanup for a load or spooler that never finishes", async () => {
    vi.useFakeTimers();
    let setup = printFrame("never", "pending");
    const loading = expect(printPng(new Uint8Array([1]), PAGE_CSS)).rejects.toThrow("did not load");
    await vi.advanceTimersByTimeAsync(30_000);
    await loading;
    expect(setup.events.filter((event) => event === "remove" || event === "revoke"))
      .toEqual(["remove", "revoke"]);

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setup = printFrame("success", "pending");
    await printPng(new Uint8Array([1]), PAGE_CSS);
    expect(setup.events).not.toContain("remove");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(setup.events.filter((event) => event === "remove" || event === "revoke"))
      .toEqual(["remove", "revoke"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("opens the Print dialog, while Print One Copy prints the saved settings without it", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const actions = readFileSync(new URL("./state/app.ts", import.meta.url), "utf8");

    expect(app).toContain('print: () => open("print")');
    expect(app).toContain("printone: () => { void printDocument(); }");
    expect(app).not.toContain("() => window.print()");
    expect(actions).toContain("await spoolPrintJob(await preparePrintJob(loadPrintSettings()))");
    expect(actions).toContain("await printPng(job.png, job.css)");
  });
});
