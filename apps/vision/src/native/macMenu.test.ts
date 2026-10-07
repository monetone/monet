// The bridge itself is covered where it lives (@monet-ui/monet-react ▸
// mac-menu.test.ts) — Vitest externalizes a workspace dependency, so the Tauri
// module mocks those tests need can only reach it from inside the package.
//
// What belongs HERE is the thing the shared tests cannot assert: that the
// bridge wires up against Vision's REAL Photoshop menu bar, not a fixture — the
// native-bar-only items (Settings…, System Info…, Keyboard Shortcuts…) are
// aliases resolved by LABEL path, so a relabelled menu silently breaks them.
import { describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ enabled: true, installs: [] as string[] }));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled }));
vi.mock("@tauri-apps/api/menu", () => {
  const node = (o: Record<string, unknown>) => Promise.resolve(o);
  return {
    MenuItem: { new: (o: Record<string, unknown>) => node({ ...o }) },
    PredefinedMenuItem: { new: (o: Record<string, unknown>) => node({ ...o }) },
    Submenu: { new: async (o: Record<string, unknown>) => node({ ...o, items: await Promise.all((o.items as Promise<unknown>[]) ?? []) }) },
    Menu: {
      new: async (o: Record<string, unknown>) => {
        const items = await Promise.all((o.items as Promise<unknown>[]) ?? []);
        return { setAsAppMenu: async () => void native.installs.push(JSON.stringify(items)) };
      },
    },
  };
});

const { APP_SETTINGS_ID, HELP_SHORTCUTS_ID, HELP_SYSTEM_INFO_ID, dispatchMenuAction, syncMacMenu } = await import("./macMenu");
const { buildPhotoshopMenus } = await import("../ui/psMenus");

describe("Vision's native menu bar", () => {
  it("wires against the real Photoshop menu bar, not just a fixture", async () => {
    const prefs = vi.fn();
    const shortcuts = vi.fn();
    const systemInfo = vi.fn();
    await syncMacMenu(
      buildPhotoshopMenus({ prefgeneral: prefs, keyboardshortcuts: shortcuts, systeminfo: systemInfo }),
      "mac",
    );
    dispatchMenuAction(APP_SETTINGS_ID);
    dispatchMenuAction(HELP_SYSTEM_INFO_ID);
    dispatchMenuAction(HELP_SHORTCUTS_ID);
    expect(prefs).toHaveBeenCalledTimes(1);
    expect(systemInfo).toHaveBeenCalledTimes(1);
    expect(shortcuts).toHaveBeenCalledTimes(1);
  });
});
