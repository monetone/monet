import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";
import { chooseOption, gotoApp } from "./helpers";

// ── Edit ▸ Color Settings / Assign Profile / Convert to Profile ──
// Built-in RGB profiles are modelled in the engine. Assign changes document
// profile metadata without touching RGB numbers; Convert transforms layer
// pixels into the destination working space and is undoable.

async function runCommand(page: Page, label: string) {
  await page.waitForFunction((needle) => {
    const items = (window as any).__mv.commandPalette?.items ?? [];
    return items.some((i: any) => i.label.includes(needle));
  }, label, { timeout: 5000 });
  await page.evaluate((needle) => {
    const items = (window as any).__mv.commandPalette.items;
    items.find((i: any) => i.label.includes(needle)).run();
  }, label);
}

async function colorDoc(page: Page): Promise<number> {
  await gotoApp(page);
  return await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(18, 18, "profiles");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(220, 40, 30, 255);
    E.select_none();
    mv.engine.commit();
    return E.pick_color(8, 8) >>> 0;
  });
}

const profile = (page: Page) => page.evaluate(() => (window as any).__mv.store.state.colorProfile);
const px = (page: Page) => page.evaluate(() => (window as any).__mv.engine.engine.pick_color(8, 8) >>> 0);

test("Color Settings applies the active working RGB profile", async ({ page }) => {
  await colorDoc(page);
  await runCommand(page, "Color Settings");
  await expect(page.locator('[data-mv-color-policy-warning="working"]')).toHaveCount(0);
  await expect(page.locator("#mv-color-settings-embedded-policy")).toContainText("Ask When Opening");
  await page.locator("#mv-color-settings-profile").click();
  await page.getByRole("option", { name: "Adobe RGB (1998)" }).click();
  await page.locator("#mv-color-settings-embedded-policy").click();
  await page.getByRole("option", { name: "Convert to Working RGB" }).click();
  await expect(page.locator("#mv-color-settings-missing-policy")).toContainText("Assign Working RGB");
  await expect(page.locator("#mv-color-settings-paste-policy")).toContainText("Ask When Pasting");
  await expect(page.locator('[data-mv-color-policy-warning="working"]')).toContainText("without converting pixels");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await profile(page)).toBe(2);
  expect(await page.evaluate(() => (window as any).__mv.store.state.colorPolicyPrefs.embeddedProfilePolicy)).toBe("convert");
});

test("Assign Profile changes document profile without changing RGB numbers", async ({ page }) => {
  const before = await colorDoc(page);
  await runCommand(page, "Assign Profile");
  await page.locator("#mv-assign-profile").click();
  await page.getByRole("option", { name: "Display P3" }).click();
  await expect(page.locator('[data-mv-color-policy-warning="assign"]')).toContainText("without changing pixel values");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await profile(page)).toBe(1);
  expect(await px(page)).toBe(before);
});

test("Convert to Profile transforms pixels, updates profile, and is undoable", async ({ page }) => {
  const before = await colorDoc(page);
  await runCommand(page, "Convert to Profile");
  await page.locator("#mv-convert-profile").click();
  await page.getByRole("option", { name: "Display P3" }).click();
  await expect(page.locator('[data-mv-color-policy-warning="convert"]')).toContainText("change layer RGB values");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await profile(page)).toBe(1);
  expect(await px(page)).not.toBe(before);

  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await profile(page)).toBe(0);
  expect(await px(page)).toBe(before);
});

// Issue #437: a loaded CMYK profile is a real Convert to Profile destination —
// it separates the document through the profile's own tables, switches the mode
// to CMYK, and the dialog offers Engine and Use Dither (remembered on OK).
test("Convert to Profile separates through a loaded CMYK profile and switches to CMYK", async ({ page }) => {
  const before = await colorDoc(page);
  const press = readFileSync(fileURLToPath(new URL("../public/profiles/ISOcoated_v2_300_eci.icc", import.meta.url)));
  const loadProfile = async (name: string, buffer: Buffer) => {
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#mv-convert-profile").click();
    await page.getByRole("option", { name: "Load Profile…" }).click();
    await (await chooser).setFiles({ name, mimeType: "application/vnd.iccprofile", buffer });
  };

  await runCommand(page, "Convert to Profile");
  await expect(page.locator("#mv-convert-profile-engine")).toContainText("Monet (moxcms)");
  await expect(page.locator("#mv-convert-profile-dither")).toHaveAttribute("aria-checked", "false");

  // Junk is refused with a reason, and nothing changes.
  await loadProfile("junk.icc", Buffer.alloc(200));
  await expect(page.locator('[data-mv-color-policy-warning="convert-icc"]')).toContainText("not an ICC profile");

  await loadProfile("ISOcoated_v2_300_eci.icc", press);
  await expect(page.locator("#mv-convert-profile")).toContainText("ISO Coated v2 300% (ECI)");
  await expect(page.locator('[data-mv-color-policy-warning="convert"]')).toContainText("changes the mode to CMYK Color");
  await page.locator("#mv-convert-profile-dither").click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const after = await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      mode: mv.store.state.mode,
      modeProfileName: mv.store.state.modeProfileName,
      colorProfile: mv.store.state.colorProfile,
      cmyk: Array.from(mv.engine.engine.pick_cmyk(8, 8) as Float32Array),
    };
  });
  expect(after.mode).toBe(2);
  expect(after.modeProfileName).toBe("ISO Coated v2 300% (ECI)");
  expect(after.colorProfile).toBe(0);
  // The press profile's own separation of (220, 40, 30) with the dialog's
  // defaults — LittleCMS 2.19 `transicc -t 1 -b`: C 1.8 M 92.4 Y 90.0 K 3.7 —
  // not the built-in model (whose plain UCR gives K 13.7).
  // Read back from the dithered 8-bit composite through the profile's own
  // B2A∘A2B round trip, which drifts a few percent at the gamut edge (the
  // conversion itself is pinned tighter by the engine tests).
  const want = [0.018, 0.924, 0.9, 0.037];
  after.cmyk.forEach((v, i) => expect(Math.abs(v - want[i]), `plate ${i}: ${after.cmyk}`).toBeLessThan(0.05));
  expect(await px(page)).not.toBe(before);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ statusInfo: "profile" }));
  await expect(page.locator("[data-mv-status]")).toHaveText("CMYK Color / 8-bit / ISO Coated v2 300% (ECI)");

  // The Channels panel's thumbnails show the same plates (not the built-in
  // ink model's): the Cyan and Black rows of this flat red document.
  const thumbs = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const urls: string[] = mv.store.channelThumbUrls([1, 4], 4, 4);
    return Promise.all(urls.map((url) => new Promise<number>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = img.width; cv.height = img.height;
        const cx = cv.getContext("2d")!;
        cx.drawImage(img, 0, 0);
        resolve(cx.getImageData(1, 1, 1, 1).data[0]);
      };
      img.src = url;
    })));
  });
  expect(Math.abs(thumbs[0] - after.cmyk[0] * 255), `cyan thumb ${thumbs}`).toBeLessThanOrEqual(2);
  expect(Math.abs(thumbs[1] - after.cmyk[3] * 255), `black thumb ${thumbs}`).toBeLessThanOrEqual(2);

  // The dialog remembers its last choices, and its default destination — the
  // document's RGB profile — is the way back to RGB.
  const separated = await px(page);
  await runCommand(page, "Convert to Profile");
  await expect(page.locator("#mv-convert-profile-dither")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#mv-convert-profile")).toContainText("sRGB IEC61966-2.1");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await page.evaluate(() => [(window as any).__mv.store.state.mode, (window as any).__mv.store.state.modeProfileName])).toEqual([0, null]);
  expect(await px(page), "the pixels already are the plates' RGB").toBe(separated);

  // Undo steps back through CMYK to the original RGB document.
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await page.evaluate(() => (window as any).__mv.store.state.mode)).toBe(2);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await page.evaluate(() => [(window as any).__mv.store.state.mode, (window as any).__mv.store.state.modeProfileName])).toEqual([0, null]);
  expect(await px(page)).toBe(before);
});

test("opening an image with an embedded Display P3 profile can preserve that profile", async ({ page }) => {
  await gotoApp(page);
  const r = await openProfiledPng(page, true);
  expect(r.prompts).toHaveLength(1);
  expect(r.prompts[0]).toContain("contains Display P3");
  expect(r.prompts[0]).toContain("current working RGB is sRGB");
  expect(r.profile).toBe(1);
  expect(r.dirty).toBe(false);
  expect(r.rgb).toEqual([220, 40, 30]);
});

test("opening an image with an embedded Display P3 profile can convert to working RGB", async ({ page }) => {
  await gotoApp(page);
  const r = await openProfiledPng(page, false, 2);
  expect(r.prompts).toHaveLength(1);
  expect(r.prompts[0]).toContain("contains Display P3");
  expect(r.prompts[0]).toContain("current working RGB is Adobe RGB");
  expect(r.profile).toBe(2);
  expect(r.dirty).toBe(false);
  expect(r.rgb).not.toEqual([220, 40, 30]);
});

test("PSD export embeds non-sRGB profile and reopen preserves it", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    mv.store.newDocument(18, 18, "psd profile");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(220, 40, 30, 255);
    E.select_none();
    mv.engine.commit();
    mv.store.assignProfile(2); // Adobe RGB (1998)
    const psd = mv.exportPSDBytes();

    mv.store.assignProfile(0);
    mv.store.setColorPolicyPrefs({ embeddedProfilePolicy: "preserve" });
    const prompts: string[] = [];
    const originalConfirm = window.confirm;
    window.confirm = (msg?: string) => { prompts.push(String(msg)); return true; };
    try {
      await mv.openImageFile(new File([psd], "adobe-profile.psd", { type: "image/vnd.adobe.photoshop" }));
      const packed = mv.engine.engine.pick_color(8, 8) >>> 0;
      const doc = mv.store.state.documents.find((d: { id: number }) => d.id === mv.store.state.activeDocId);
      return {
        prompts,
        policy: mv.store.state.colorPolicyPrefs.embeddedProfilePolicy,
        profile: mv.store.state.colorProfile,
        dirty: doc?.dirty,
        rgb: [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255],
      };
    } finally {
      window.confirm = originalConfirm;
    }
  });

  expect(r.prompts).toHaveLength(0);
  expect(r.policy).toBe("preserve");
  expect(r.profile).toBe(2);
  expect(r.dirty).toBe(false);
  expect(r.rgb).toEqual([220, 40, 30]);
});

test("PSD export distinguishes assigned profiles from untagged profiles", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    mv.store.newDocument(18, 18, "psd assigned srgb");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(220, 40, 30, 255);
    E.select_none();
    mv.engine.commit();

    mv.store.assignProfile(0);
    const tagged = mv.exportPSDBytes();
    mv.store.markProfileUntagged(0);
    const untaggedSrgb = mv.exportPSDBytes();
    mv.store.assignProfile(2);
    mv.store.markProfileUntagged(2);
    const untaggedAdobe = mv.exportPSDBytes();

    mv.store.setColorPolicyPrefs({
      embeddedProfilePolicy: "preserve",
      missingProfilePolicy: "leave-untagged",
    });
    const prompts: string[] = [];
    const originalConfirm = window.confirm;
    window.confirm = (msg?: string) => { prompts.push(String(msg)); return true; };
    try {
      await mv.openImageFile(new File([tagged], "assigned-srgb.psd", { type: "image/vnd.adobe.photoshop" }));
      const taggedDoc = mv.store.state.documents.find((d: { id: number }) => d.id === mv.store.state.activeDocId);
      const taggedState = {
        profile: mv.store.state.colorProfile,
        assigned: mv.store.state.colorProfileAssigned,
        dirty: taggedDoc?.dirty,
      };

      await mv.openImageFile(new File([untaggedSrgb], "untagged-srgb.psd", { type: "image/vnd.adobe.photoshop" }));
      const untaggedDoc = mv.store.state.documents.find((d: { id: number }) => d.id === mv.store.state.activeDocId);
      const untaggedSrgbState = {
        profile: mv.store.state.colorProfile,
        assigned: mv.store.state.colorProfileAssigned,
        dirty: untaggedDoc?.dirty,
      };

      mv.store.assignProfile(2);
      await mv.openImageFile(new File([untaggedAdobe], "untagged-adobe.psd", { type: "image/vnd.adobe.photoshop" }));
      const untaggedAdobeDoc = mv.store.state.documents.find((d: { id: number }) => d.id === mv.store.state.activeDocId);
      return {
        prompts,
        tagged: taggedState,
        untaggedSrgb: untaggedSrgbState,
        untaggedAdobe: {
          profile: mv.store.state.colorProfile,
          assigned: mv.store.state.colorProfileAssigned,
          dirty: untaggedAdobeDoc?.dirty,
        },
      };
    } finally {
      window.confirm = originalConfirm;
    }
  });

  expect(r.prompts).toHaveLength(0);
  expect(r.tagged).toEqual({ profile: 0, assigned: true, dirty: false });
  expect(r.untaggedSrgb).toEqual({ profile: 0, assigned: false, dirty: false });
  expect(r.untaggedAdobe).toEqual({ profile: 2, assigned: false, dirty: false });
});

test("PSD custom ICC payload is preserved through open, export, and project restore", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);
  const r = await page.evaluate(async () => {
    function asciiBytes(text: string): Uint8Array {
      return new Uint8Array(Array.from(text, (ch) => ch.charCodeAt(0)));
    }

    function utf16beBytes(text: string): Uint8Array {
      const out = new Uint8Array(text.length * 2);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        out[i * 2] = (code >>> 8) & 255;
        out[i * 2 + 1] = code & 255;
      }
      return out;
    }

    function readU16(bytes: Uint8Array, pos: number): number {
      return ((bytes[pos] ?? 0) << 8) | (bytes[pos + 1] ?? 0);
    }

    function readU32(bytes: Uint8Array, pos: number): number {
      return ((bytes[pos] ?? 0) * 0x1000000) + (((bytes[pos + 1] ?? 0) << 16) | ((bytes[pos + 2] ?? 0) << 8) | (bytes[pos + 3] ?? 0));
    }

    function writeU16(bytes: Uint8Array, pos: number, value: number) {
      bytes[pos] = (value >>> 8) & 255;
      bytes[pos + 1] = value & 255;
    }

    function writeU32(bytes: Uint8Array, pos: number, value: number) {
      bytes[pos] = (value >>> 24) & 255;
      bytes[pos + 1] = (value >>> 16) & 255;
      bytes[pos + 2] = (value >>> 8) & 255;
      bytes[pos + 3] = value & 255;
    }

    function customIccPayload(name: string): Uint8Array {
      const text = utf16beBytes(name);
      const textOffset = 28;
      const tag = new Uint8Array(textOffset + text.length);
      tag.set(asciiBytes("mluc"), 0);
      writeU32(tag, 8, 1);
      writeU32(tag, 12, 12);
      tag.set(asciiBytes("enUS"), 16);
      writeU32(tag, 20, text.length);
      writeU32(tag, 24, textOffset);
      tag.set(text, textOffset);

      const tagOffset = 144;
      const payload = new Uint8Array(tagOffset + tag.length);
      writeU32(payload, 0, payload.length);
      payload.set(asciiBytes("acsp"), 36);
      writeU32(payload, 128, 1);
      payload.set(asciiBytes("desc"), 132);
      writeU32(payload, 136, tagOffset);
      writeU32(payload, 140, tag.length);
      payload.set(tag, tagOffset);
      return payload;
    }

    function psdIccResource(payload: Uint8Array): Uint8Array {
      const resource = new Uint8Array(12 + payload.length + (payload.length % 2));
      resource.set(asciiBytes("8BIM"), 0);
      writeU16(resource, 4, 1039);
      resource[6] = 0;
      resource[7] = 0;
      writeU32(resource, 8, payload.length);
      resource.set(payload, 12);
      return resource;
    }

    function replacePsdImageResources(psd: Uint8Array, resources: Uint8Array): Uint8Array {
      const colorModeLength = readU32(psd, 26);
      const resourceLengthOffset = 30 + colorModeLength;
      const oldLength = readU32(psd, resourceLengthOffset);
      const oldEnd = resourceLengthOffset + 4 + oldLength;
      const out = new Uint8Array(psd.length - oldLength + resources.length);
      out.set(psd.slice(0, resourceLengthOffset), 0);
      writeU32(out, resourceLengthOffset, resources.length);
      out.set(resources, resourceLengthOffset + 4);
      out.set(psd.slice(oldEnd), resourceLengthOffset + 4 + resources.length);
      return out;
    }

    function psdIccPayload(psd: Uint8Array): number[] | null {
      const colorModeLength = readU32(psd, 26);
      const resourceLengthOffset = 30 + colorModeLength;
      const resourceLength = readU32(psd, resourceLengthOffset);
      let pos = resourceLengthOffset + 4;
      const end = pos + resourceLength;
      while (pos + 12 <= end) {
        const signature = String.fromCharCode(...psd.slice(pos, pos + 4));
        const resourceId = readU16(psd, pos + 4);
        pos += 6;
        const nameLength = psd[pos] ?? 0;
        pos += 1 + nameLength;
        if ((1 + nameLength) % 2 !== 0) pos += 1;
        const dataLength = readU32(psd, pos);
        const dataStart = pos + 4;
        const dataEnd = dataStart + dataLength;
        if ((signature === "8BIM" || signature === "8B64") && resourceId === 1039) return Array.from(psd.slice(dataStart, dataEnd));
        pos = dataEnd + (dataLength % 2);
      }
      return null;
    }

    function sameBytes(a: Uint8Array | number[] | null | undefined, b: Uint8Array | number[] | null | undefined): boolean {
      if (!a || !b || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }

    const mv = (window as any).__mv;
    mv.store.newDocument(18, 18, "custom icc source");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(220, 40, 30, 255);
    E.select_none();
    mv.engine.commit();

    const payload = customIccPayload("Acme Wide Gamut RGB");
    const sourcePsd = replacePsdImageResources(mv.exportPSDBytes(), psdIccResource(payload));
    mv.store.setColorPolicyPrefs({ embeddedProfilePolicy: "preserve" });
    await mv.openImageFile(new File([Uint8Array.from(sourcePsd)], "custom-icc.psd", { type: "image/vnd.adobe.photoshop" }));

    const importedMeta = mv.store.docDocumentMeta(mv.store.state.activeDocId);
    const exportedPayload = psdIccPayload(mv.exportPSDBytes());
    const projectBytes = mv.store.saveProject();
    mv.store.openProject(projectBytes, "custom-icc.mvision");
    const restoredMeta = mv.store.docDocumentMeta(mv.store.state.activeDocId);
    const restoredPayload = psdIccPayload(mv.exportPSDBytes());
    mv.store.setOptions({ statusInfo: "profile" });

    return {
      profile: mv.store.state.colorProfile,
      assigned: mv.store.state.colorProfileAssigned,
      profileName: mv.store.state.iccProfileName,
      importedProfileName: importedMeta?.iccProfileName,
      restoredProfileName: restoredMeta?.iccProfileName,
      importedPayloadMatches: sameBytes(importedMeta?.iccProfileBytes, payload),
      exportedPayloadMatches: sameBytes(exportedPayload, payload),
      restoredPayloadMatches: sameBytes(restoredMeta?.iccProfileBytes, payload) && sameBytes(restoredPayload, payload),
    };
  });

  expect(r).toEqual({
    profile: 0,
    assigned: true,
    profileName: "Acme Wide Gamut RGB",
    importedProfileName: "Acme Wide Gamut RGB",
    restoredProfileName: "Acme Wide Gamut RGB",
    importedPayloadMatches: true,
    exportedPayloadMatches: true,
    restoredPayloadMatches: true,
  });

  await expect(page.locator("[data-mv-status]")).toHaveText("RGB Color / 8-bit / Acme Wide Gamut RGB");
  await runCommand(page, "File Info");
  await expect(page.locator('[data-mv-file-info-row="Profile"]')).toContainText("Acme Wide Gamut RGB");
  await page.getByRole("button", { name: "OK", exact: true }).click();

  const cleared = await page.evaluate(() => {
    function readU16(bytes: Uint8Array, pos: number): number {
      return ((bytes[pos] ?? 0) << 8) | (bytes[pos + 1] ?? 0);
    }
    function readU32(bytes: Uint8Array, pos: number): number {
      return ((bytes[pos] ?? 0) * 0x1000000) + (((bytes[pos + 1] ?? 0) << 16) | ((bytes[pos + 2] ?? 0) << 8) | (bytes[pos + 3] ?? 0));
    }
    function psdHasCustomIccPayload(psd: Uint8Array): boolean {
      const colorModeLength = readU32(psd, 26);
      const resourceLengthOffset = 30 + colorModeLength;
      const resourceLength = readU32(psd, resourceLengthOffset);
      let pos = resourceLengthOffset + 4;
      const end = pos + resourceLength;
      while (pos + 12 <= end) {
        const signature = String.fromCharCode(...psd.slice(pos, pos + 4));
        const resourceId = readU16(psd, pos + 4);
        pos += 6;
        const nameLength = psd[pos] ?? 0;
        pos += 1 + nameLength;
        if ((1 + nameLength) % 2 !== 0) pos += 1;
        const dataLength = readU32(psd, pos);
        const dataStart = pos + 4;
        const dataEnd = dataStart + dataLength;
        if ((signature === "8BIM" || signature === "8B64") && resourceId === 1039) {
          let text = "";
          for (let i = dataStart; i < dataEnd; i++) {
            const c = psd[i] ?? 0;
            text += c >= 32 && c <= 126 ? String.fromCharCode(c) : " ";
          }
          return text.replace(/\s+/g, "").includes("Acme");
        }
        pos = dataEnd + (dataLength % 2);
      }
      return false;
    }
    const mv = (window as any).__mv;
    mv.store.assignProfile(2);
    return {
      profile: mv.store.state.colorProfile,
      assigned: mv.store.state.colorProfileAssigned,
      profileName: mv.store.state.iccProfileName,
      customPayloadStillExported: psdHasCustomIccPayload(mv.exportPSDBytes()),
    };
  });
  expect(cleared).toEqual({ profile: 2, assigned: true, profileName: null, customPayloadStillExported: false });
  await expect(page.locator("[data-mv-status]")).toHaveText("RGB Color / 8-bit / Adobe RGB (1998)");
});

test("Color Settings embedded profile policy can convert without prompting", async ({ page }) => {
  await gotoApp(page);
  await runCommand(page, "Color Settings");
  await page.locator("#mv-color-settings-profile").click();
  await page.getByRole("option", { name: "Adobe RGB (1998)" }).click();
  await page.locator("#mv-color-settings-embedded-policy").click();
  await page.getByRole("option", { name: "Convert to Working RGB" }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();

  const r = await openProfiledPng(page, true);
  expect(r.prompts).toHaveLength(0);
  expect(r.policy).toBe("convert");
  expect(r.profile).toBe(2);
  expect(r.dirty).toBe(false);
  expect(r.rgb).not.toEqual([220, 40, 30]);
});

test("Color Settings missing profile policy can assign working RGB without prompting", async ({ page }) => {
  await gotoApp(page);
  await runCommand(page, "Color Settings");
  await page.locator("#mv-color-settings-profile").click();
  await page.getByRole("option", { name: "Adobe RGB (1998)" }).click();
  await page.locator("#mv-color-settings-missing-policy").click();
  await page.getByRole("option", { name: "Assign Working RGB" }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();

  const r = await openPlainPng(page, true);
  expect(r.prompts).toHaveLength(0);
  expect(r.policy).toBe("assign-working");
  expect(r.profile).toBe(2);
  expect(r.dirty).toBe(false);
  expect(r.rgb).toEqual([220, 40, 30]);
});

test("Color Settings missing profile policy can leave an untagged RGB document and persist it", async ({ page }) => {
  await gotoApp(page);
  await runCommand(page, "Color Settings");
  await page.locator("#mv-color-settings-profile").click();
  await page.getByRole("option", { name: "Adobe RGB (1998)" }).click();
  await page.locator("#mv-color-settings-missing-policy").click();
  await page.getByRole("option", { name: "Leave Untagged" }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();

  const r = await openPlainPng(page, true);
  expect(r.prompts).toHaveLength(0);
  expect(r.policy).toBe("leave-untagged");
  expect(r.profile).toBe(2);
  expect(r.assigned).toBe(false);
  expect(r.dirty).toBe(false);
  expect(r.rgb).toEqual([220, 40, 30]);

  await chooseOption(page.locator("#mv-status-info"), "profile");
  await expect(page.locator("[data-mv-status]")).toHaveText("RGB Color / 8-bit / Untagged RGB");

  const restored = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const bytes = mv.store.saveProject();
    mv.store.openProject(bytes, "untagged-roundtrip.mvision");
    const doc = mv.store.state.documents.find((d: { id: number }) => d.id === mv.store.state.activeDocId);
    return {
      profile: mv.store.state.colorProfile,
      assigned: mv.store.state.colorProfileAssigned,
      dirty: doc?.dirty,
    };
  });
  expect(restored).toEqual({ profile: 2, assigned: false, dirty: false });
  await expect(page.locator("[data-mv-status]")).toHaveText("RGB Color / 8-bit / Untagged RGB");
});

test("Color Settings paste profile policy can convert clipboard pixels without prompting", async ({ page }) => {
  await gotoApp(page);
  await runCommand(page, "Color Settings");
  await page.locator("#mv-color-settings-paste-policy").click();
  await page.getByRole("option", { name: "Convert to Document RGB" }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();

  const r = await pasteAcrossProfiles(page);
  expect(r.prompts).toHaveLength(0);
  expect(r.policy).toBe("convert");
  expect(r.profile).toBe(1);
  expect(r.clipboardProfile).toBe(1);
  expect(r.layerCount).toBe(2);
  expect(r.after).not.toBe(r.before);
});

test("Color Settings paste profile policy converts a valid custom ICC clipboard", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    mv.store.newDocument(18, 18, "custom paste source");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(220, 40, 30, 255);
    E.select_none();
    mv.engine.commit();
    mv.store.assignProfile(2); // Export supplies a real Adobe RGB ICC payload.
    const psd = mv.exportPSDBytes();
    mv.store.setColorPolicyPrefs({ embeddedProfilePolicy: "preserve" });
    await mv.openImageFile(new File([psd], "custom-paste-source.psd", { type: "image/vnd.adobe.photoshop" }));
    const source = mv.engine.engine;
    const before = source.pick_color(8, 8) >>> 0;
    const sourceProfileBytes = mv.store.state.iccProfileBytes?.length ?? 0;
    mv.store.copyMerged();
    mv.store.assignProfile(1); // Display P3 target profile, without converting the copied custom-profile RGB numbers.
    mv.store.setColorPolicyPrefs({ pasteProfilePolicy: "ask" });

    const prompts: string[] = [];
    const originalConfirm = window.confirm;
    window.confirm = (msg?: string) => { prompts.push(String(msg)); return true; };
    try {
      await mv.store.paste();
      return {
        prompts,
        policy: mv.store.state.colorPolicyPrefs.pasteProfilePolicy,
        profile: mv.store.state.colorProfile,
        customName: mv.store.state.iccProfileName,
        clipboardProfile: source.clipboard_profile(),
        layerCount: source.layer_count(),
        sourceProfileBytes,
        before,
        after: source.pick_color(8, 8) >>> 0,
      };
    } finally {
      window.confirm = originalConfirm;
    }
  });

  expect(r.prompts).toHaveLength(1);
  expect(r.prompts[0]).toContain("Adobe RGB");
  expect(r.prompts[0]).toContain("Display P3");
  expect(r.prompts[0]).not.toContain("cannot convert");
  expect(r.policy).toBe("ask");
  expect(r.profile).toBe(1);
  expect(r.customName).toBeNull();
  expect(r.clipboardProfile).toBe(1);
  expect(r.layerCount).toBe(2);
  expect(r.sourceProfileBytes).toBeGreaterThan(128);
  expect(r.after).not.toBe(r.before);
});

async function pasteAcrossProfiles(page: Page, pasteProfilePolicy?: string) {
  return await page.evaluate(async ({ pasteProfilePolicy }) => {
    const mv = (window as any).__mv;
    if (pasteProfilePolicy) mv.store.setColorPolicyPrefs({ pasteProfilePolicy });
    mv.store.newDocument(18, 18, "paste profiles");
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(220, 40, 30, 255);
    E.select_none();
    mv.engine.commit();
    const before = E.pick_color(8, 8) >>> 0;
    mv.store.copyMerged();
    mv.store.assignProfile(1); // Display P3 target profile, without converting source RGB numbers.

    const prompts: string[] = [];
    const originalConfirm = window.confirm;
    window.confirm = (msg?: string) => { prompts.push(String(msg)); return true; };
    try {
      await mv.store.paste();
      return {
        prompts,
        policy: mv.store.state.colorPolicyPrefs.pasteProfilePolicy,
        profile: mv.store.state.colorProfile,
        clipboardProfile: E.clipboard_profile(),
        layerCount: E.layer_count(),
        before,
        after: E.pick_color(8, 8) >>> 0,
      };
    } finally {
      window.confirm = originalConfirm;
    }
  }, { pasteProfilePolicy });
}

async function openProfiledPng(page: Page, confirmValue: boolean, workingProfile?: number, embeddedProfilePolicy?: string) {
  return await page.evaluate(async ({ confirmValue, workingProfile, embeddedProfilePolicy }) => {
    async function profiledPng(cicp: number[]): Promise<Uint8Array> {
      const c = document.createElement("canvas");
      c.width = 18; c.height = 18;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "rgb(220, 40, 30)";
      ctx.fillRect(0, 0, 18, 18);
      const blob = await new Promise<Blob>((resolve) => c.toBlob((v) => resolve(v!), "image/png"));
      const png = new Uint8Array(await blob.arrayBuffer());
      return insertPngChunk(png, "cICP", new Uint8Array(cicp));
    }

    function insertPngChunk(png: Uint8Array, type: string, data: Uint8Array): Uint8Array {
      const idat = findPngChunk(png, "IDAT");
      if (idat < 0) throw new Error("PNG missing IDAT");
      const typeBytes = asciiBytes(type);
      const chunk = new Uint8Array(12 + data.length);
      writeU32(chunk, 0, data.length);
      chunk.set(typeBytes, 4);
      chunk.set(data, 8);
      writeU32(chunk, 8 + data.length, crc32(typeBytes, data));
      const out = new Uint8Array(png.length + chunk.length);
      out.set(png.slice(0, idat), 0);
      out.set(chunk, idat);
      out.set(png.slice(idat), idat + chunk.length);
      return out;
    }

    function findPngChunk(png: Uint8Array, type: string): number {
      let pos = 8;
      while (pos + 12 <= png.length) {
        const len = readU32(png, pos);
        const found = String.fromCharCode(...png.slice(pos + 4, pos + 8));
        if (found === type) return pos;
        pos += 12 + len;
      }
      return -1;
    }

    function crc32(type: Uint8Array, data: Uint8Array): number {
      let crc = 0xffffffff;
      for (const bytes of [type, data]) {
        for (const byte of bytes) {
          crc ^= byte;
          for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
      }
      return (crc ^ 0xffffffff) >>> 0;
    }

    function asciiBytes(text: string): Uint8Array {
      return new Uint8Array(Array.from(text, (ch) => ch.charCodeAt(0)));
    }

    function readU32(bytes: Uint8Array, pos: number): number {
      return ((bytes[pos] ?? 0) * 0x1000000) + (((bytes[pos + 1] ?? 0) << 16) | ((bytes[pos + 2] ?? 0) << 8) | (bytes[pos + 3] ?? 0));
    }

    function writeU32(bytes: Uint8Array, pos: number, value: number) {
      bytes[pos] = (value >>> 24) & 255;
      bytes[pos + 1] = (value >>> 16) & 255;
      bytes[pos + 2] = (value >>> 8) & 255;
      bytes[pos + 3] = value & 255;
    }

    const mv = (window as any).__mv;
    if (typeof workingProfile === "number") mv.store.assignProfile(workingProfile);
    if (embeddedProfilePolicy) mv.store.setColorPolicyPrefs({ embeddedProfilePolicy });
    const prompts: string[] = [];
    const originalConfirm = window.confirm;
    window.confirm = (msg?: string) => { prompts.push(String(msg)); return confirmValue; };
    try {
      const bytes = await profiledPng([12, 13, 0, 1]);
      await mv.openImageFile(new File([Uint8Array.from(bytes)], "embedded-p3.png", { type: "image/png" }));
      const packed = mv.engine.engine.pick_color(8, 8) >>> 0;
      const doc = mv.store.state.documents.find((d: { id: number }) => d.id === mv.store.state.activeDocId);
      return {
        prompts,
        policy: mv.store.state.colorPolicyPrefs.embeddedProfilePolicy,
        profile: mv.store.state.colorProfile,
        dirty: doc?.dirty,
        rgb: [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255],
      };
    } finally {
      window.confirm = originalConfirm;
    }
  }, { confirmValue, workingProfile, embeddedProfilePolicy });
}

async function openPlainPng(page: Page, confirmValue: boolean, workingProfile?: number, missingProfilePolicy?: string) {
  return await page.evaluate(async ({ confirmValue, workingProfile, missingProfilePolicy }) => {
    const c = document.createElement("canvas");
    c.width = 18; c.height = 18;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgb(220, 40, 30)";
    ctx.fillRect(0, 0, 18, 18);
    const blob = await new Promise<Blob>((resolve) => c.toBlob((v) => resolve(v!), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const mv = (window as any).__mv;
    if (typeof workingProfile === "number") mv.store.assignProfile(workingProfile);
    if (missingProfilePolicy) mv.store.setColorPolicyPrefs({ missingProfilePolicy });
    const prompts: string[] = [];
    const originalConfirm = window.confirm;
    window.confirm = (msg?: string) => { prompts.push(String(msg)); return confirmValue; };
    try {
      await mv.openImageFile(new File([bytes], "plain.png", { type: "image/png" }));
      const packed = mv.engine.engine.pick_color(8, 8) >>> 0;
      const doc = mv.store.state.documents.find((d: { id: number }) => d.id === mv.store.state.activeDocId);
      return {
        prompts,
        policy: mv.store.state.colorPolicyPrefs.missingProfilePolicy,
        profile: mv.store.state.colorProfile,
        assigned: mv.store.state.colorProfileAssigned,
        dirty: doc?.dirty,
        rgb: [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255],
      };
    } finally {
      window.confirm = originalConfirm;
    }
  }, { confirmValue, workingProfile, missingProfilePolicy });
}

test("display compensation presents non-sRGB documents through a doc→sRGB LUT (engine output stays raw)", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(16, 16, "display-comp");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(220, 40, 40, 255); E.select_none(); mv.engine.commit();
    const canvasPx = () => {
      const ctx = (mv.engine as { ctx: CanvasRenderingContext2D }).ctx;
      const d = ctx.getImageData(8, 8, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const before = canvasPx();
    mv.store.assignProfile(2); // Adobe RGB (1998) — canvas must now compensate
    const compensated = canvasPx();
    const raw = E.pick_color(8, 8) >>> 0;
    mv.store.assignProfile(0); // back to sRGB — identity fast path
    const restored = canvasPx();
    return { before, compensated, restored, rawR: (raw >>> 24) & 255 };
  });
  expect(r.before).toEqual([220, 40, 40]); // sRGB doc presents its raw numbers
  expect(r.compensated).not.toEqual(r.before); // Adobe RGB doc presents differently
  expect(r.restored).toEqual(r.before); // round-trip back to identity
  expect(r.rawR).toBe(220); // the engine composite itself is never compensated
});

test("ICC soft proof + gamut warning use the bundled FOGRA39 press profile", async ({ page }) => {
  await gotoApp(page);
  const px = () => page.evaluate(() => {
    const mv = (window as any).__mv;
    const d = (mv.engine as { ctx: CanvasRenderingContext2D }).ctx.getImageData(8, 8, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(16, 16, "icc-proof");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(40, 40, 255, 255); E.select_none(); mv.engine.commit(); // saturated blue
  });
  const before = await px();
  expect(before).toEqual([40, 40, 255]);

  // Proof Colors (Working CMYK): once the ICC LUT bakes, the canvas shows the
  // press-simulated colour — visibly different from raw blue.
  await page.evaluate(() => (window as any).__mv.store.setProof("cmyk"));
  await expect.poll(px, { timeout: 10_000 }).not.toEqual(before);
  const rawAfterProof = await page.evaluate(() => ((window as any).__mv.engine.engine.pick_color(8, 8) >>> 0) >>> 24 & 255);
  expect(rawAfterProof).toBe(40); // the composite itself is never touched

  // Gamut Warning: saturated blue is far outside FOGRA39 — flagged grey.
  await page.evaluate(() => { const mv = (window as any).__mv; mv.store.toggleProofColors(); mv.store.toggleGamutWarning(); });
  await expect.poll(px, { timeout: 10_000 }).toEqual([128, 128, 128]);
  await page.evaluate(() => (window as any).__mv.store.toggleGamutWarning());
  await expect.poll(px, { timeout: 10_000 }).toEqual(before);
});

// ── Color Settings ▸ Advanced reaches the pixels (#438) ──
test("Color Settings Advanced: blend gamma changes the composite, monitor desaturation only the screen", async ({ page }) => {
  await colorDoc(page); // opaque (220, 40, 30)
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.addLayer();
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(0, 200, 0, 255); E.select_none();
    E.set_layer_opacity(E.active_layer_id(), 0.5);
    mv.engine.commit();
  });
  const composite = () => page.evaluate(() => {
    const c = (window as any).__mv.engine.engine.pick_color(8, 8) >>> 0;
    return [c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255];
  });
  const screen = () => page.evaluate(() => {
    const d = ((window as any).__mv.engine as { ctx: CanvasRenderingContext2D }).ctx.getImageData(8, 8, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  const off = await composite();
  expect(off).toEqual([110, 120, 15]); // a straight 50/50 mix of the encoded values
  expect(await screen()).toEqual(off);

  // Blend RGB Colors Using Gamma 1.00: the same two layers blend in linear light.
  await runCommand(page, "Color Settings");
  await expect(page.getByText("Photoshop's default is on at 1.45; off keeps existing documents' type edges unchanged.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Blend RGB Colors Using Gamma" }).click();
  await expect(page.getByLabel("Blend RGB colors gamma")).toHaveValue("1.00");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  const linear = await composite();
  expect(linear[0]).toBeGreaterThan(off[0] + 40);
  expect(await screen()).toEqual(linear);
  // What Export and Save read is that same composite.
  const exported = await page.evaluate(async () => {
    const png = (window as any).__mv.engine.engine.export_png();
    const bitmap = await createImageBitmap(new Blob([png], { type: "image/png" }), { colorSpaceConversion: "none" });
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(8, 8, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  expect(exported).toEqual(linear);

  // Desaturate Monitor Colors By 20%: the screen moves toward grey, the pixels do not.
  await runCommand(page, "Color Settings");
  await page.getByRole("checkbox", { name: "Desaturate Monitor Colors By" }).click();
  await expect(page.getByLabel("Desaturate monitor colors amount")).toHaveValue("20");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  const desaturated = await screen();
  expect(desaturated).not.toEqual(linear);
  expect(Math.max(...desaturated) - Math.min(...desaturated)).toBeLessThan(Math.max(...linear) - Math.min(...linear));
  expect(await composite()).toEqual(linear);
  // Color Range ▸ Out of Gamut reads the document, not the desaturated screen.
  const outOfGamut = () => page.evaluate(() => [...(window as any).__mv.engine.outOfGamutMask() as Uint8Array].filter(Boolean).length);
  const flaggedDesaturated = await outOfGamut();
  await page.evaluate(() => (window as any).__mv.store.setColorPolicyPrefs({ desaturateMonitorAmount: 100 }));
  expect(await outOfGamut()).toBe(flaggedDesaturated);

  // Both off again: back to the original composite and screen.
  await runCommand(page, "Color Settings");
  await page.getByRole("checkbox", { name: "Desaturate Monitor Colors By" }).click();
  await page.getByRole("checkbox", { name: "Blend RGB Colors Using Gamma" }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await composite()).toEqual(off);
  expect(await screen()).toEqual(off);
});

test("Color Settings carries the Black Point Compensation default Convert to Profile pre-fills", async ({ page }) => {
  await colorDoc(page);
  const convertBpc = async () => {
    await runCommand(page, "Convert to Profile");
    const checked = await page.locator("#mv-convert-profile-bpc").isChecked();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    return checked;
  };
  expect(await convertBpc()).toBe(true); // Photoshop's default

  await runCommand(page, "Color Settings");
  const bpc = page.getByRole("checkbox", { name: "Use Black Point Compensation" });
  await expect(bpc).toBeChecked();
  await bpc.click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.colorPolicyPrefs.blackPointCompensation)).toBe(false);
  expect(await convertBpc()).toBe(false);

  // Cancel leaves the setting alone.
  await runCommand(page, "Color Settings");
  await page.getByRole("checkbox", { name: "Use Black Point Compensation" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await convertBpc()).toBe(false);
});
