import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CLI_DONE_EVENT, CLI_READY_EVENT, CLI_RUN_EVENT, cliCommandLine, cliExecutable, installCliListener, type CliJob } from "./cli";

// ── Command-line hand-off guard (#468) ─────────────────────────────────────
// `monet-vision --run-script foo.js` and `--play-action Set/Name --batch dir`
// span two languages: main.rs validates the flags, boots a hidden window
// without the MCP server, hands the job over on the ready handshake and exits
// with the status the webview reports back. It is native-only, so the browser
// e2e build can never exercise the hand-off; these guards catch a one-sided
// rename. If an event name changes on purpose, change both sides and this test.

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

type Payload = { payload?: { exe?: string | null; job?: CliJob | null } };

describe("Vision runs a command-line job without opening its window", () => {
  it("quotes only the arguments a shell would split or expand", () => {
    expect(cliExecutable()).toBe("monet-vision"); // before any native hand-off
    expect(cliCommandLine("monet-vision", ["--batch", "/tmp/in", "--format", "png"], false))
      .toBe("monet-vision --batch /tmp/in --format png");
    expect(cliCommandLine("/Applications/Monet Vision.app/Contents/MacOS/Vision",
      ["--play-action", "Default Actions/Tom's", "--template", "{name}_$x", ""], false))
      .toBe(`'/Applications/Monet Vision.app/Contents/MacOS/Vision' --play-action 'Default Actions/Tom'\\''s' --template '{name}_$x' ''`);
    expect(cliCommandLine("C:\\Program Files\\Monet Vision\\Vision.exe", ["--play-action", 'Set/Say "hi"', "--batch", "C:\\in"], true))
      .toBe(`"C:\\Program Files\\Monet Vision\\Vision.exe" --play-action "Set/Say \\"hi\\"" --batch "C:\\in"`);
  });

  it("main.rs shares the event names, hands the job over once and exits with its status", () => {
    const rs = read("../../src-tauri/src/main.rs");
    expect(rs).toContain(`const EV_CLI_READY: &str = "${CLI_READY_EVENT}"`);
    expect(rs).toContain(`const EV_CLI: &str = "${CLI_RUN_EVENT}"`);
    expect(rs).toContain(`const EV_CLI_DONE: &str = "${CLI_DONE_EVENT}"`);
    expect(rs).toMatch(/listen\(EV_CLI_READY[\s\S]{0,400}\.take\(\)[\s\S]{0,300}emit\(\s*EV_CLI,/);
    expect(rs).toMatch(/listen\(EV_CLI_DONE[\s\S]{0,800}\.exit\(done\.code\)/);
    // exit(code) alone ends the run loop with 0: the recorded status must reach
    // the process after run_return, or a failed job looks like success. A job
    // that never reported is no success either.
    expect(rs).toMatch(/listen\(EV_CLI_DONE[\s\S]{0,800}CLI_STATUS\.set\(done\.code\)/);
    expect(rs).toMatch(/let cli = job\.is_some\(\);[\s\S]*\.run_return\([\s\S]*std::process::exit\(exit_status\(cli, CLI_STATUS\.get\(\)\.copied\(\), \w+\)\)/);
  });

  it("main.rs refuses bad flags before Tauri boots and keeps a job off the GUI's MCP server", () => {
    const main = read("../../src-tauri/src/main.rs").split("fn main()")[1];
    const refuse = main.indexOf("std::process::exit(2)");
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(main.indexOf("tauri::Builder"));
    // monet_mcp::init binds a port and rewrites mcp.json: a job beside a
    // running GUI would take over the GUI's MCP connection.
    expect(main.match(/monet_mcp::init/g)).toHaveLength(1);
    expect(main).toMatch(/if job\.is_none\(\) \{\s*(\/\/.*\s*)*builder = builder\.plugin\(monet_mcp::init/);
    expect(main).toContain(`WebviewUrl::App("index.html?cli=1".into())`);
    expect(main).toContain(".visible(job.is_none())");
    expect(main).toContain(".remember_state(job.is_none())");
    // The job's own script path must never be opened as a document.
    expect(main).toMatch(/if job\.is_none\(\) \{\s*(\/\/.*\s*)*queue_open\(app\.handle\(\), file_args/);
  });

  it("the webview installs the listener and a job boot skips first-run prompts", () => {
    expect(read("../App.tsx")).toContain("installCliListener(listen, emit, runCliJob)");
    expect(read("../App.tsx")).toMatch(/if \(isCliBoot\(\)\) return;\s*try \{ if \(localStorage\.getItem\("mv\.modelNoticeShown"\)\)/);
    expect(read("../state/app.ts")).toContain("if (documentRecoveryEnabled() && !isCliBoot()) void recoverLastSession()");
  });

  it("listens before ready, runs the job once and reports its status", async () => {
    const order: string[] = [];
    let receive: ((event: Payload) => void) | undefined;
    const unlisten = vi.fn();
    const listen = vi.fn(async (event: string, handler: (event: Payload) => void) => {
      order.push(event);
      receive = handler;
      return unlisten;
    });
    let reported: (value: unknown) => void = () => {};
    const done = new Promise((resolve) => { reported = resolve; });
    const emit = vi.fn(async (event: string, payload?: unknown) => {
      order.push(event);
      if (event === CLI_DONE_EVENT) reported(payload);
    });
    const run = vi.fn(async () => ({ code: 0, stdout: "hi", stderr: "" }));

    const cleanup = await installCliListener(listen, emit, run);
    expect(order).toEqual([CLI_RUN_EVENT, CLI_READY_EVENT]);
    receive?.({ payload: { exe: "/Apps/monet_vision", job: { script: "/tmp/a.js" } } });
    expect(await done).toEqual({ code: 0, stdout: "hi", stderr: "" });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({ script: "/tmp/a.js" });
    expect(cliExecutable()).toBe("/Apps/monet_vision");
    cleanup();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("reports a thrown job as status 1 and only records the executable without one", async () => {
    let receive: ((event: Payload) => void) | undefined;
    let reported: (value: unknown) => void = () => {};
    const done = new Promise((resolve) => { reported = resolve; });
    const emit = vi.fn(async (event: string, payload?: unknown) => { if (event === CLI_DONE_EVENT) reported(payload); });
    const run = vi.fn(async () => { throw new Error("boom"); });
    await installCliListener(async (_event, handler) => { receive = handler; return () => {}; }, emit, run);

    receive?.({ payload: { exe: "/gui/monet_vision", job: null } });
    expect(run).not.toHaveBeenCalled();
    expect(cliExecutable()).toBe("/gui/monet_vision");

    receive?.({ payload: { job: { action: "Set/Name", batch: "/in" } } });
    expect(await done).toEqual({ code: 1, stdout: "", stderr: "boom" });
  });

  it("unsubscribes if the ready handshake fails", async () => {
    const unlisten = vi.fn();
    const error = new Error("ready failed");
    await expect(installCliListener(async () => unlisten, async () => { throw error; }, vi.fn())).rejects.toBe(error);
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
