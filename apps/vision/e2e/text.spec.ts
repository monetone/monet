import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

// Comprehensive coverage of the Photoshop-class type layer: the rich TextSpec
// model, the Canvas2D rasterizer (point/paragraph, character + paragraph
// formatting, effects, anti-alias, vertical), all 15 warp styles, rich runs,
// re-edit, rasterize-type, and project round-trip. Most assertions analyse the
// rasterizer output directly via `mv.text.rasterizeSpec`; integration tests
// drive the engine through `mv.text`.

test.beforeEach(async ({ page }) => {
  // The type tests do real Canvas2D layout + warp resampling on top of the
  // (cold, swiftshader) app boot, so give them headroom over the 60s default.
  test.setTimeout(120_000);
  // analyse(): summarise a rasterizer bitmap into small, assertable metrics.
  await page.addInitScript(() => {
    (window as unknown as { __txt: unknown }).__txt = {
      analyze(r: { w: number; h: number; data: Uint8ClampedArray }) {
        const d = r.data;
        let alpha = 0, partial = 0, minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
        let rs = 0, gs = 0, bs = 0, wx = 0, wy = 0, ws = 0, chk = 0;
        for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
          const i = (y * r.w + x) * 4; const a = d[i + 3];
          if (a === 0) continue;
          alpha += a; if (a < 255) partial++;
          if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
          rs += d[i] * a; gs += d[i + 1] * a; bs += d[i + 2] * a; wx += x * a; wy += y * a; ws += a;
          chk = (chk + (i + 1) * (d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7 + a * 11)) % 2147483647;
        }
        const A = ws || 1;
        return {
          w: r.w, h: r.h, alpha, partial, minx, miny, maxx, maxy,
          bw: maxx >= minx ? maxx - minx + 1 : 0, bh: maxy >= miny ? maxy - miny + 1 : 0,
          cx: wx / A, cy: wy / A, r: rs / A, g: gs / A, b: bs / A, chk,
        };
      },
    };
  });
  await gotoApp(page);
  await newScene(page);
});

test("point text: create, kind, spec round-trip, composite change", async ({ page }) => {
  const before = await composite(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const spec = mv.text.defaultSpec("Hello", { ax: 40, ay: 60, color: [255, 255, 255, 255], size: 56 });
    const id = mv.text.create(spec);
    const got = mv.text.get(id);
    return { kind: E().layer_kind(id), text: mv.text.fullText(got), size: got.size, kindStr: got.kind };
  });
  const after = await composite(page);
  expect(r.kind).toBe(2);
  expect(r.text).toBe("Hello");
  expect(r.size).toBe(56);
  expect(r.kindStr).toBe("point");
  expect(after.chk).not.toBe(before.chk);
});

test("multiline text increases height; paragraph wraps within the box", async ({ page }) => {
  const m = await page.evaluate(() => {
    const mv = (window as any).__mv; const A = (window as any).__txt.analyze;
    const one = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Ag", { size: 48 })));
    const three = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Ag\nAg\nAg", { size: 48 })));
    const longTxt = "the quick brown fox jumps over the lazy dog again and again";
    const point = A(mv.text.rasterizeSpec(mv.text.defaultSpec(longTxt, { size: 32, kind: "point" })));
    const para = A(mv.text.rasterizeSpec(mv.text.defaultSpec(longTxt, { size: 32, kind: "paragraph", boxW: 220 })));
    return { one, three, point, para };
  });
  expect(m.three.bh).toBeGreaterThan(m.one.bh * 2);     // ~3 lines tall
  expect(m.para.bw).toBeLessThan(240);                   // wrapped to the box
  expect(m.point.bw).toBeGreaterThan(300);               // point text runs long
  expect(m.para.bh).toBeGreaterThan(m.point.bh * 2);     // wrap → more lines
});

test("size, bold and italic affect the rendering", async ({ page }) => {
  const m = await page.evaluate(() => {
    const mv = (window as any).__mv; const A = (window as any).__txt.analyze;
    const small = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Type", { size: 24 })));
    const big = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Type", { size: 96 })));
    const reg = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Type", { size: 64, bold: false })));
    const bold = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Type", { size: 64, bold: true })));
    const ital = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Type", { size: 64, italic: true })));
    return { small, big, reg, bold, ital };
  });
  expect(m.big.alpha).toBeGreaterThan(m.small.alpha * 3);
  expect(m.big.bh).toBeGreaterThan(m.small.bh);
  expect(m.bold.alpha).toBeGreaterThan(m.reg.alpha * 1.05); // bold = more ink
  expect(m.ital.chk).not.toBe(m.reg.chk);                   // italic differs
});

test("text color is applied", async ({ page }) => {
  const m = await page.evaluate(() => {
    const mv = (window as any).__mv; const A = (window as any).__txt.analyze;
    const red = A(mv.text.rasterizeSpec(mv.text.defaultSpec("RED", { color: [255, 0, 0, 255] })));
    const blue = A(mv.text.rasterizeSpec(mv.text.defaultSpec("BLU", { color: [0, 0, 255, 255] })));
    return { red, blue };
  });
  expect(m.red.r).toBeGreaterThan(180); expect(m.red.g).toBeLessThan(60); expect(m.red.b).toBeLessThan(60);
  expect(m.blue.b).toBeGreaterThan(180); expect(m.blue.r).toBeLessThan(60);
});

test("alignment shifts the ink centroid horizontally", async ({ page }) => {
  const m = await page.evaluate(() => {
    const mv = (window as any).__mv; const A = (window as any).__txt.analyze;
    const mk = (align: string) => A(mv.text.rasterizeSpec(mv.text.defaultSpec("hi", { size: 40, kind: "paragraph", boxW: 320, align })));
    return { left: mk("left"), center: mk("center"), right: mk("right") };
  });
  expect(m.center.cx).toBeGreaterThan(m.left.cx + 40);
  expect(m.right.cx).toBeGreaterThan(m.center.cx + 40);
});

test("leading, tracking and scale change dimensions", async ({ page }) => {
  const m = await page.evaluate(() => {
    const mv = (window as any).__mv; const A = (window as any).__txt.analyze;
    const autoLead = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Ag\nAg", { size: 40, leading: 0 })));
    const bigLead = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Ag\nAg", { size: 40, leading: 110 })));
    const tr0 = A(mv.text.rasterizeSpec(mv.text.defaultSpec("AAAA", { size: 48, tracking: 0 })));
    const tr30 = A(mv.text.rasterizeSpec(mv.text.defaultSpec("AAAA", { size: 48, tracking: 30 })));
    const base = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Wm", { size: 48 })));
    const wide = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Wm", { size: 48, hScale: 2 })));
    const tall = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Wm", { size: 48, vScale: 2 })));
    return { autoLead, bigLead, tr0, tr30, base, wide, tall };
  });
  expect(m.bigLead.bh).toBeGreaterThan(m.autoLead.bh);
  expect(m.tr30.bw).toBeGreaterThan(m.tr0.bw + 40);
  expect(m.wide.bw).toBeGreaterThan(m.base.bw * 1.6);
  expect(m.tall.bh).toBeGreaterThan(m.base.bh * 1.4);
});

test("combining marks stay attached as grapheme clusters under tracking", async ({ page }) => {
  const m = await page.evaluate(() => {
    const mv = (window as any).__mv; const A = (window as any).__txt.analyze;
    const plain = A(mv.text.rasterizeSpec(mv.text.defaultSpec("ee", { size: 64, tracking: 60 })));
    const accented = A(mv.text.rasterizeSpec(mv.text.defaultSpec("e\u0301e\u0301", { size: 64, tracking: 60 })));
    return { plain, accented };
  });
  expect(m.accented.bw).toBeLessThan(m.plain.bw + 35);
  expect(m.accented.bh).toBeGreaterThan(m.plain.bh);
});

test("plain horizontal complex-script runs use platform shaping while tracked runs stay positioned", async ({ page }) => {
  const calls = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const record = (tracking: number) => {
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.fillText;
      const seen: string[] = [];
      proto.fillText = function (this: CanvasRenderingContext2D, ...args: Parameters<CanvasRenderingContext2D["fillText"]>) {
        seen.push(String(args[0]));
        return original.apply(this, args);
      };
      try {
        mv.text.rasterizeSpec(mv.text.defaultSpec("سلام", {
          size: 72,
          font: "Arial",
          tracking,
          kerning: "metrics",
          antialias: "smooth",
        }));
      } finally {
        proto.fillText = original;
      }
      return seen;
    };
    return { plain: record(0), tracked: record(24) };
  });
  expect(calls.plain).toEqual(["سلام"]);
  expect(calls.tracked).not.toContain("سلام");
  expect(calls.tracked.length).toBeGreaterThan(1);
});

test("complex-script layout width matches the native shaped word", async ({ page }) => {
  const widths = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const size = 72;
    const font = "Arial";
    const text = "سلام";
    const rendered = mv.text.rasterizeSpec(mv.text.defaultSpec(text, {
      size, font, tracking: 0, kerning: "metrics", antialias: "smooth",
    }));
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = `400 ${size}px ${font}`;
    ctx.direction = "ltr";
    return { layout: rendered.w - 8, native: ctx.measureText(text).width };
  });
  expect(Math.abs(widths.layout - widths.native)).toBeLessThanOrEqual(1);
});

test("right-to-left type direction is stored and passed to the platform shaper", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.text.create(mv.text.defaultSpec("ABC", { ax: 12, ay: 40 }));
    mv.text.setDirection("rtl");
    const storedRtl = mv.text.get(id).direction;
    mv.text.setDirection("ltr");
    const storedLtr = mv.text.get(id).direction;

    const proto = CanvasRenderingContext2D.prototype;
    const original = proto.fillText;
    const calls: { text: string; direction: string; align: string }[] = [];
    proto.fillText = function (this: CanvasRenderingContext2D, ...args: Parameters<CanvasRenderingContext2D["fillText"]>) {
      calls.push({ text: String(args[0]), direction: this.direction, align: this.textAlign });
      return original.apply(this, args);
    };
    try {
      mv.text.rasterizeSpec(mv.text.defaultSpec("سلام", {
        size: 72,
        font: "Arial",
        direction: "rtl",
        kerning: "metrics",
      }));
    } finally {
      proto.fillText = original;
    }
    return { storedRtl, storedLtr, calls };
  });
  expect(r.storedRtl).toBe("rtl");
  expect(r.storedLtr).toBe("ltr");
  expect(r.calls).toEqual([{ text: "سلام", direction: "rtl", align: "right" }]);
});

test("World-Ready composer persists and reorders mixed-direction fallback text", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.text.create(mv.text.defaultSpec("AאבB", { ax: 12, ay: 40, tracking: 16 }));
    mv.text.setComposer("worldReady");
    const storedWorld = mv.text.get(id).composer;
    mv.text.setComposer("latin");
    const storedLatin = mv.text.get(id).composer;

    const record = (composer: string) => {
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.fillText;
      const calls: string[] = [];
      proto.fillText = function (this: CanvasRenderingContext2D, ...args: Parameters<CanvasRenderingContext2D["fillText"]>) {
        calls.push(String(args[0]));
        return original.apply(this, args);
      };
      try {
        mv.text.rasterizeSpec(mv.text.defaultSpec("AאבB", {
          size: 72,
          font: "Arial",
          tracking: 16,
          composer,
        }));
      } finally {
        proto.fillText = original;
      }
      return calls.filter((s) => s.trim());
    };
    return { storedWorld, storedLatin, latin: record("latin"), worldReady: record("worldReady") };
  });
  expect(r.storedWorld).toBe("worldReady");
  expect(r.storedLatin).toBe("latin");
  expect(r.latin).toEqual(["A", "א", "ב", "B"]);
  expect(r.worldReady).toEqual(["A", "ב", "א", "B"]);
});

test("Middle Eastern type controls persist and affect rendered Kashidas and diacritics", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv; const A = (window as any).__txt.analyze;
    const arabicBase = {
      size: 72,
      font: "Arial",
      direction: "rtl",
      kerning: "metrics",
      antialias: "smooth",
    };
    const plain = A(mv.text.rasterizeSpec(mv.text.defaultSpec("سلام", { ...arabicBase, kashida: "none" })));
    const kashida = A(mv.text.rasterizeSpec(mv.text.defaultSpec("سلام", { ...arabicBase, kashida: "long" })));
    const diacriticPlain = A(mv.text.rasterizeSpec(mv.text.defaultSpec("ب\u064Eب\u064E", { ...arabicBase, kashida: "none" })));
    const diacriticOffset = A(mv.text.rasterizeSpec(mv.text.defaultSpec("ب\u064Eب\u064E", {
      ...arabicBase,
      kashida: "none",
      diacriticX: 60,
      diacriticY: 18,
    })));

    const id = mv.text.create(mv.text.defaultSpec("س1\u064Eلام", { ax: 20, ay: 40, ...arabicBase }));
    mv.text.setDigits("arabic");
    mv.text.setKashida("medium");
    mv.text.setDiacriticOffset(12, -10);
    const stored = mv.text.get(id);
    return {
      plain,
      kashida,
      diacriticPlain,
      diacriticOffset,
      stored: {
        text: mv.text.fullText(stored),
        digits: stored.digits,
        kashida: stored.kashida,
        diacriticX: stored.diacriticX,
        diacriticY: stored.diacriticY,
      },
    };
  });
  expect(r.kashida.bw).toBeGreaterThan(r.plain.bw + 20);
  expect(r.diacriticOffset.chk).not.toBe(r.diacriticPlain.chk);
  expect(r.diacriticOffset.bw).toBeGreaterThan(r.diacriticPlain.bw + 20);
  expect(r.stored).toEqual({
    text: "س1\u064Eلام",
    digits: "arabic",
    kashida: "medium",
    diacriticX: 12,
    diacriticY: -10,
  });
});

test("underline, strikethrough, caps and superscript", async ({ page }) => {
  const m = await page.evaluate(() => {
    const mv = (window as any).__mv; const A = (window as any).__txt.analyze;
    const plain = A(mv.text.rasterizeSpec(mv.text.defaultSpec("abc", { size: 60 })));
    const ul = A(mv.text.rasterizeSpec(mv.text.defaultSpec("abc", { size: 60, runs: [{ text: "abc", underline: true }] })));
    const sk = A(mv.text.rasterizeSpec(mv.text.defaultSpec("abc", { size: 60, runs: [{ text: "abc", strike: true }] })));
    const lower = A(mv.text.rasterizeSpec(mv.text.defaultSpec("abc", { size: 60 })));
    const caps = A(mv.text.rasterizeSpec(mv.text.defaultSpec("abc", { size: 60, runs: [{ text: "abc", caps: "all" }] })));
    const literalCaps = A(mv.text.rasterizeSpec(mv.text.defaultSpec("ABC", { size: 60 })));
    const normal = A(mv.text.rasterizeSpec(mv.text.defaultSpec("2", { size: 60 })));
    const sup = A(mv.text.rasterizeSpec(mv.text.defaultSpec("2", { size: 60, runs: [{ text: "2", script: "super" }] })));
    return { plain, ul, sk, lower, caps, literalCaps, normal, sup };
  });
  expect(m.ul.alpha).toBeGreaterThan(m.plain.alpha);
  expect(m.sk.alpha).toBeGreaterThan(m.plain.alpha);
  expect(m.caps.chk).not.toBe(m.lower.chk);
  expect(m.caps.chk).toBe(m.literalCaps.chk);             // All Caps renders like literal uppercase
  expect(m.sup.alpha).toBeLessThan(m.normal.alpha);      // superscript is smaller
});

test("anti-alias: none is binary, smooth has partial coverage", async ({ page }) => {
  const m = await page.evaluate(() => {
    const mv = (window as any).__mv; const A = (window as any).__txt.analyze;
    const smooth = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Ag", { size: 64, antialias: "smooth" })));
    const none = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Ag", { size: 64, antialias: "none" })));
    return { smooth, none };
  });
  expect(m.smooth.partial).toBeGreaterThan(20); // soft edges
  expect(m.none.partial).toBe(0);               // hard 0/255 edges only
});

test("stroke and drop shadow add ink and grow the bbox", async ({ page }) => {
  const m = await page.evaluate(() => {
    const mv = (window as any).__mv; const A = (window as any).__txt.analyze;
    const plain = A(mv.text.rasterizeSpec(mv.text.defaultSpec("O", { size: 80, color: [255, 255, 255, 255] })));
    const stroke = A(mv.text.rasterizeSpec(mv.text.defaultSpec("O", { size: 80, color: [255, 255, 255, 255], stroke: { width: 6, color: [0, 0, 0, 255] } })));
    const shadow = A(mv.text.rasterizeSpec(mv.text.defaultSpec("O", { size: 80, color: [255, 255, 255, 255], shadow: { color: [0, 0, 0, 255], blur: 0, dx: 16, dy: 16 } })));
    return { plain, stroke, shadow };
  });
  expect(m.stroke.alpha).toBeGreaterThan(m.plain.alpha);
  expect(m.stroke.bw).toBeGreaterThan(m.plain.bw);
  expect(m.shadow.alpha).toBeGreaterThan(m.plain.alpha);
  expect(m.shadow.bw).toBeGreaterThan(m.plain.bw);  // shadow offset extends the box
  expect(m.shadow.bh).toBeGreaterThan(m.plain.bh);
});

test("all 15 warp styles deform the text without erasing it", async ({ page }) => {
  const res = await page.evaluate(() => {
    const mv = (window as any).__mv; const A = (window as any).__txt.analyze;
    const base = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Monet Vision", { size: 60 })));
    const fails: string[] = [];
    const seen = new Set<number>();
    let dupes = 0;
    for (const w of mv.text.WARP_STYLES) {
      if (w.id === "none") continue;
      const m = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Monet Vision", { size: 60, warp: { style: w.id, bend: 0.7, h: 0, v: 0, orient: "h" } })));
      if (m.alpha < base.alpha * 0.4) fails.push(w.id + ":vanished");
      if (m.chk === base.chk) fails.push(w.id + ":unchanged");
      if (seen.has(m.chk)) dupes++; seen.add(m.chk);
    }
    // qualitative: arc curvature grows height; rise tilts (taller); fisheye magnifies
    const none = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Monet", { size: 60 })));
    const arc = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Monet", { size: 60, warp: { style: "arc", bend: 0.85, h: 0, v: 0, orient: "h" } })));
    const rise = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Monet", { size: 60, warp: { style: "rise", bend: 0.85, h: 0, v: 0, orient: "h" } })));
    // distortion alone (style none + horizontal distortion) still changes pixels
    const distort = A(mv.text.rasterizeSpec(mv.text.defaultSpec("Monet", { size: 60, warp: { style: "none", bend: 0, h: 0.8, v: 0, orient: "h" } })));
    return { fails, dupes, arcBh: arc.bh, riseBh: rise.bh, noneBh: none.bh, noneChk: none.chk, distortChk: distort.chk };
  });
  expect(res.fails).toEqual([]);
  expect(res.dupes).toBe(0);                  // every style produces a distinct result
  expect(res.arcBh).toBeGreaterThan(res.noneBh);
  expect(res.riseBh).toBeGreaterThan(res.noneBh);
  expect(res.distortChk).not.toBe(res.noneChk);
});

test("rich runs: multiple colors coexist in one layer", async ({ page }) => {
  const m = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const spec = mv.text.defaultSpec("RB", { size: 80, runs: [
      { text: "RR", color: [255, 0, 0, 255] },
      { text: "BB", color: [0, 0, 255, 255] },
    ] });
    const r = mv.text.rasterizeSpec(spec);
    const d = r.data; let red = 0, blue = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 40) continue;
      if (d[i] > 150 && d[i + 2] < 80) red++;
      if (d[i + 2] > 150 && d[i] < 80) blue++;
    }
    return { red, blue };
  });
  expect(m.red).toBeGreaterThan(20);
  expect(m.blue).toBeGreaterThan(20);
});

test("applyRangeFormat splits runs precisely (pure helper)", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const runs = mv.text.applyRangeFormat([{ text: "hello world" }], 0, 5, { bold: true });
    const runs2 = mv.text.applyRangeFormat(runs, 6, 11, { color: [255, 0, 0, 255] });
    return {
      n: runs.length, t0: runs[0].text, b0: runs[0].bold, t1: runs[1].text,
      full: runs.map((x: any) => x.text).join(""),
      n2: runs2.length, lastBold: runs2[runs2.length - 1].bold === undefined,
    };
  });
  expect(r.n).toBe(2);
  expect(r.t0).toBe("hello");
  expect(r.b0).toBe(true);
  expect(r.t1).toBe(" world");
  expect(r.full).toBe("hello world");
  expect(r.n2).toBe(3); // "hello"(bold) " "(plain) "world"(red)
});

test("re-edit updates the spec and the pixels", async ({ page }) => {
  // One round-trip: create, hash the composite, re-edit the string, re-hash.
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    const hash = () => { const p = E.export_png(); let h = 0; for (let i = 0; i < p.length; i += 7) h = (h + p[i] * (i + 1)) % 2147483647; return h; };
    const id = mv.text.create(mv.text.defaultSpec("First", { ax: 30, ay: 50, color: [255, 255, 255, 255], size: 60 }));
    const text0 = mv.text.fullText(mv.text.get(id));
    const h0 = hash();
    mv.text.apply(id, mv.text.setText(mv.text.get(id), "Second much longer line"));
    const text1 = mv.text.fullText(mv.text.get(id));
    const h1 = hash();
    return { text0, text1, changed: h0 !== h1 };
  });
  expect(r.text0).toBe("First");
  expect(r.text1).toBe("Second much longer line");
  expect(r.changed).toBe(true);
});

test("rasterize type: kind 2 → 0, spec cleared, pixels preserved", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv, E = mv.engine.engine;
    const hash = () => { const p = E.export_png(); let h = 0; for (let i = 0; i < p.length; i += 7) h = (h + p[i] * (i + 1)) % 2147483647; return h; };
    const id = mv.text.create(mv.text.defaultSpec("Flatten", { ax: 30, ay: 50, color: [255, 255, 255, 255], size: 64 }));
    const kindBefore = E.layer_kind(id);
    const hBefore = hash();
    mv.text.rasterizeLayer(id);
    return {
      kindBefore, kindAfter: E.layer_kind(id),
      specNull: mv.text.get(id) === null, specRaw: E.layer_text_spec(id),
      pixelsSame: hBefore === hash(),
    };
  });
  expect(r.kindBefore).toBe(2);
  expect(r.kindAfter).toBe(0);
  expect(r.specNull).toBe(true);
  expect(r.specRaw).toBe("");
  expect(r.pixelsSame).toBe(true); // rasterizing keeps the pixels identical
});

test("project save/load preserves the full type spec", async ({ page }) => {
  const saved = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const spec = mv.text.defaultSpec("RoundTrip", {
      ax: 24, ay: 44, size: 50, color: [255, 0, 0, 255],
      warp: { style: "arc", bend: 0.5, h: 0, v: 0, orient: "h" },
    });
    const id = mv.text.create(spec);
    const bytes = mv.store.saveProject();
    return { id, len: bytes.length, b64: btoa(String.fromCharCode(...bytes.slice(0, 4))) };
  });
  const got = await page.evaluate(({ id }) => {
    const mv = (window as any).__mv;
    const bytes = mv.store.saveProject();
    mv.store.openProject(bytes, "rt.mvision");
    const s = mv.text.get(id);
    return s ? { text: mv.text.fullText(s), size: s.size, color: s.color, warp: s.warp.style, kind: mv.engine.engine.layer_kind(id) } : null;
  }, { id: saved.id });
  expect(saved.b64).toBe(btoa("MVSN"));
  expect(got).not.toBeNull();
  expect(got!.text).toBe("RoundTrip");
  expect(got!.size).toBe(50);
  expect(got!.color).toEqual([255, 0, 0, 255]);
  expect(got!.warp).toBe("arc");
  expect(got!.kind).toBe(2);
});

test("vertical type stacks taller than wide", async ({ page }) => {
  const m = await page.evaluate(() => {
    const mv = (window as any).__mv; const A = (window as any).__txt.analyze;
    const horiz = A(mv.text.rasterizeSpec(mv.text.defaultSpec("ABCD", { size: 48, vertical: false })));
    const vert = A(mv.text.rasterizeSpec(mv.text.defaultSpec("ABCD", { size: 48, vertical: true })));
    return { horiz, vert };
  });
  expect(m.horiz.bw).toBeGreaterThan(m.horiz.bh);
  expect(m.vert.bh).toBeGreaterThan(m.vert.bw);
});

test("point ↔ paragraph kind is stored and editable", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.text.create(mv.text.defaultSpec("Kind", { ax: 20, ay: 40 }));
    const k0 = mv.text.get(id).kind;
    mv.text.apply(id, { ...mv.text.get(id), kind: "paragraph" });
    const k1 = mv.text.get(id).kind;
    return { k0, k1 };
  });
  expect(r.k0).toBe("point");
  expect(r.k1).toBe("paragraph");
});
