import { actions, runScript } from "./app";
export const SCRIPT_EVENTS = [
  { id: "newDocument", label: "New Document" },
  { id: "saveDocument", label: "Save Document" },
  { id: "openDocument", label: "Open Document" },
  { id: "closeDocument", label: "Close Document" },
  { id: "exportDocument", label: "Export Document" },
] as const;
export type ScriptEventId = typeof SCRIPT_EVENTS[number]["id"];
export interface ScriptEventBinding { event: ScriptEventId; actionId?: number; actionName?: string; code?: string }
export interface ScriptEventStore { enabled: boolean; bindings: ScriptEventBinding[] }
export const SCRIPT_EVENTS_KEY = "mv.scriptEvents";
function validBinding(value: unknown): value is ScriptEventBinding {
  if (!value || typeof value !== "object") return false;
  const b = value as ScriptEventBinding;
  return SCRIPT_EVENTS.some((e) => e.id === b.event)
    && (b.actionId === undefined || Number.isSafeInteger(b.actionId))
    && (b.actionName === undefined || typeof b.actionName === "string")
    && (b.code === undefined || typeof b.code === "string");
}
export function loadScriptEventStore(): ScriptEventStore {
  try {
    const value = JSON.parse(localStorage.getItem(SCRIPT_EVENTS_KEY) ?? "null") as ScriptEventStore | null;
    if (value && typeof value.enabled === "boolean" && Array.isArray(value.bindings)) return { enabled: value.enabled, bindings: value.bindings.filter(validBinding) };
  } catch { /* empty/corrupt profiles start with no bindings */ }
  return { enabled: true, bindings: [] };
}
/** Validated JSON for the Script Events Manager, the only editor of this
 *  library — it writes through the store so a refused write is visible. */
export function serializeScriptEventStore(value: ScriptEventStore): string {
  if (typeof value.enabled !== "boolean" || !Array.isArray(value.bindings) || value.bindings.length > 1000 || !value.bindings.every(validBinding)) throw new Error("Invalid Script Events bindings.");
  return JSON.stringify(value);
}
let running = false;
export const scriptEventRunning = () => running;
/** Event-triggered commands cannot recursively dispatch more script events. */
export async function runScriptEventBindings(event: ScriptEventId): Promise<void> {
  if (running) return;
  const { enabled, bindings } = loadScriptEventStore();
  if (!enabled) return;
  running = true;
  try {
    for (const b of bindings) {
      if (b.event !== event) continue;
      try {
        if (b.actionId !== undefined || b.actionName !== undefined) {
          const id = actions.resolve({ id: b.actionId, name: b.actionName });
          if (id === null) { console.warn(`Script Events: “${b.actionName ?? b.actionId}” no longer exists.`); continue; }
          await actions.playNamed(id);
        } else if (b.code) await runScript(b.code);
      } catch (error) { console.error(`Script Events: ${event} failed`, error); }
    }
  } finally { running = false; }
}
/** Capture suppression before awaiting a save started by an event's action. */
export async function documentSaveEvent(work: () => Promise<boolean>): Promise<boolean> {
  const suppressed = running;
  const ok = await work();
  if (ok && !suppressed) void runScriptEventBindings("saveDocument");
  return ok;
}
