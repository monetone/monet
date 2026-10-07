// Command-line jobs (#468): `monet-vision --run-script foo.js`,
// `monet-vision --play-action "Set/Name" --batch <dir>` and (#469)
// `monet-vision droplet.json <images or folders…>`. src-tauri/main.rs
// validates the flags, boots a hidden window at index.html?cli=1 and hands the
// job over once this listener announces itself; the webview runs it and reports
// {code, stdout, stderr}, which main.rs prints before exiting with that code.
export const CLI_READY_EVENT = "monet://cli/ready";
export const CLI_RUN_EVENT = "monet://cli/run";
export const CLI_DONE_EVENT = "monet://cli/done";

/** A job as main.rs parsed and validated it (its serde field names). */
export interface CliJob {
  script?: string | null;
  action?: string | null;
  batch?: string | null;
  /** A BatchDestination: "folder", "none" or "saveAndClose". */
  destination?: string;
  dest?: string | null;
  format?: string | null;
  template?: string | null;
  serial?: string | null;
  override_save?: boolean;
  stop_on_error?: boolean;
  subfolders?: boolean;
  /** `monet-vision droplet.json a.jpg …` (#469): the descriptor and its inputs. */
  droplet?: string | null;
  inputs?: string[];
}

/** What the process prints and exits with: 0 done, 1 the run failed, 2 bad input. */
export interface CliResult { code: number; stdout: string; stderr: string }

type Listen = (
  event: string,
  handler: (event: { payload?: { exe?: string | null; job?: CliJob | null } }) => void,
) => Promise<() => void>;

let executable: string | null = null;

export async function installCliListener(
  listen: Listen,
  emit: (event: string, payload?: unknown) => Promise<unknown>,
  run: (job: CliJob) => Promise<CliResult>,
): Promise<() => void> {
  const unlisten = await listen(CLI_RUN_EVENT, ({ payload }) => {
    executable = payload?.exe ?? executable;
    const job = payload?.job;
    if (!job) return;
    void run(job)
      .catch((e): CliResult => ({ code: 1, stdout: "", stderr: e instanceof Error ? e.message : String(e) }))
      .then((result) => emit(CLI_DONE_EVENT, result));
  });
  try {
    await emit(CLI_READY_EVENT);
    return unlisten;
  } catch (error) {
    unlisten();
    throw error;
  }
}

/** The running binary for Copy as Command Line; a bare name outside the desktop app. */
export const cliExecutable = () => executable ?? "monet-vision";

/** main.rs booted this window to run a command-line job, not for a person. */
export const isCliBoot = () => typeof location !== "undefined" && new URLSearchParams(location.search).has("cli");

/** Join a command a user can paste: POSIX single quotes (or Windows double
 *  quotes) around any argument a shell would split or expand. */
export function cliCommandLine(
  exe: string,
  args: string[],
  windows = typeof navigator !== "undefined" && /^Win/.test(navigator.platform),
): string {
  return [exe, ...args].map((arg) => (/^[\w./:=@%+,-]+$/.test(arg) ? arg
    : windows ? `"${arg.replace(/"/g, '\\"')}"` : `'${arg.replace(/'/g, "'\\''")}'`)).join(" ");
}
