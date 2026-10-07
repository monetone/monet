import test from "node:test";
import assert from "node:assert/strict";

import {
  parseChild,
  productProofExpectations,
  validateProxy,
  validateTier,
} from "./product-export-validator.mjs";

const fixture = { id: "fixture", benchmarkTier: 45, sha256: "aa".repeat(32) };
const gate = { seconds: 30, rss: 1000, profile: "srgb" };
const [width, height] = productProofExpectations.dimensions[45];
const outputDigest = "bb".repeat(32);
const outputBytes = 123;
const validPayload = {
  result: {
    state: "completed",
    durabilityError: null,
    sourceDigest: fixture.sha256,
    recipeDigest: productProofExpectations.recipeDigest,
    output: {
      width,
      height,
      profile: "srgb",
      bitsPerSample: 16,
      samplesPerPixel: 3,
      orientation: 1,
      intent: "relativeColorimetric",
      blackPointCompensation: false,
      iccDigest: productProofExpectations.iccDigests.srgb,
      outputDigest,
      bytes: outputBytes,
    },
  },
  proof: {
    width,
    height,
    profile: "srgb",
    bitsPerSample: 16,
    samplesPerPixel: 3,
    orientation: 1,
    iccDigest: productProofExpectations.iccDigests.srgb,
  },
};
const valid = () => ({
  fixture,
  gate,
  seconds: 1,
  peakResidentBytes: 500,
  payload: structuredClone(validPayload),
  sourceDigestAfter: fixture.sha256,
  actualOutputDigest: outputDigest,
  actualOutputBytes: outputBytes,
});
const validProxy = () => ({
  width: 4096,
  height: 2732,
  coldMilliseconds: 100,
  rerenderMilliseconds: 20,
  baselineSourceDigest: fixture.sha256,
  firstRecipeDigest: "01".repeat(32),
  rerenderRecipeDigest: "02".repeat(32),
  firstOutputDigest: "03".repeat(32),
  rerenderOutputDigest: "04".repeat(32),
});

test("accepts complete independently bound product and proxy evidence", () => {
  assert.equal(validateTier(valid()).tier, 45);
  assert.equal(parseChild({ status: 0, stdout: JSON.stringify(validPayload) }, "fixture").result.state, "completed");
  assert.equal(validateProxy(validProxy(), fixture.sha256).width, 4096);
});

for (const [name, run] of [
  ["null child status", () => parseChild({ status: null, stdout: "{}" }, "fixture")],
  ["nonzero child status", () => parseChild({ status: 1, stdout: "{}" }, "fixture")],
  ["malformed child JSON", () => parseChild({ status: 0, stdout: "{" }, "fixture")],
]) {
  test(`rejects ${name}`, () => assert.throws(run));
}

for (const [name, mutate] of [
  ["missing output", (value) => { delete value.payload.result.output; }],
  ["non-durable completed state", (value) => { value.payload.result.durabilityError = "sync failed"; }],
  ["bad result dimensions", (value) => { value.payload.result.output.width = 1; }],
  ["bad result profile", (value) => { value.payload.result.output.profile = "displayP3"; }],
  ["bad result RGB16 depth", (value) => { value.payload.result.output.bitsPerSample = 8; }],
  ["bad result sample count", (value) => { value.payload.result.output.samplesPerPixel = 4; }],
  ["bad result orientation", (value) => { value.payload.result.output.orientation = 6; }],
  ["perceptual result intent", (value) => { value.payload.result.output.intent = "perceptual"; }],
  ["other result intent", (value) => { value.payload.result.output.intent = "absoluteColorimetric"; }],
  ["missing result intent", (value) => { delete value.payload.result.output.intent; }],
  ["wrong-type result intent", (value) => { value.payload.result.output.intent = false; }],
  ["enabled result BPC", (value) => { value.payload.result.output.blackPointCompensation = true; }],
  ["missing result BPC", (value) => { delete value.payload.result.output.blackPointCompensation; }],
  ["wrong-type result BPC", (value) => { value.payload.result.output.blackPointCompensation = "false"; }],
  ["bad result ICC", (value) => { value.payload.result.output.iccDigest = "00".repeat(32); }],
  ["bad proof dimensions", (value) => { value.payload.proof.width = 1; }],
  ["bad proof profile", (value) => { value.payload.proof.profile = "displayP3"; }],
  ["bad proof RGB16 depth", (value) => { value.payload.proof.bitsPerSample = 8; }],
  ["bad proof sample count", (value) => { value.payload.proof.samplesPerPixel = 4; }],
  ["bad proof orientation", (value) => { value.payload.proof.orientation = 6; }],
  ["bad proof ICC", (value) => { value.payload.proof.iccDigest = "00".repeat(32); }],
  ["bad recipe", (value) => { value.payload.result.recipeDigest = "00".repeat(32); }],
  ["bad result source digest", (value) => { value.payload.result.sourceDigest = "00".repeat(32); }],
  ["source mutation", (value) => { value.sourceDigestAfter = "00".repeat(32); }],
  ["time gate failure", (value) => { value.seconds = 31; }],
  ["RSS gate failure", (value) => { value.peakResidentBytes = 1001; }],
  ["missing output digest", (value) => { delete value.payload.result.output.outputDigest; }],
  ["non-hex output digest", (value) => { value.payload.result.output.outputDigest = "z".repeat(64); }],
  ["wrong-length output digest", (value) => { value.payload.result.output.outputDigest = "bb"; }],
  ["published-file digest mismatch", (value) => { value.actualOutputDigest = "cc".repeat(32); }],
  ["missing result byte count", (value) => { delete value.payload.result.output.bytes; }],
  ["zero result byte count", (value) => { value.payload.result.output.bytes = 0; }],
  ["negative result byte count", (value) => { value.payload.result.output.bytes = -1; }],
  ["fractional result byte count", (value) => { value.payload.result.output.bytes = 1.5; }],
  ["unsafe result byte count", (value) => { value.payload.result.output.bytes = Number.MAX_SAFE_INTEGER + 1; }],
  ["non-finite result byte count", (value) => { value.payload.result.output.bytes = Infinity; }],
  ["wrong-type result byte count", (value) => { value.payload.result.output.bytes = "123"; }],
  ["published-file size mismatch", (value) => { value.actualOutputBytes = 124; }],
  ["negative elapsed time", (value) => { value.seconds = -1; }],
  ["non-finite elapsed time", (value) => { value.seconds = Infinity; }],
  ["wrong-type elapsed time", (value) => { value.seconds = "1"; }],
  ["zero peak RSS", (value) => { value.peakResidentBytes = 0; }],
  ["negative peak RSS", (value) => { value.peakResidentBytes = -1; }],
  ["non-finite peak RSS", (value) => { value.peakResidentBytes = NaN; }],
  ["wrong-type peak RSS", (value) => { value.peakResidentBytes = "500"; }],
]) {
  test(`rejects ${name}`, () => {
    const value = valid();
    mutate(value);
    assert.throws(() => validateTier(value));
  });
}

for (const [name, mutate] of [
  ["proxy dimensions", (value) => { value.width = 1; }],
  ["proxy source identity", (value) => { value.baselineSourceDigest = "00".repeat(32); }],
  ["proxy cold upper gate", (value) => { value.coldMilliseconds = 5001; }],
  ["proxy rerender upper gate", (value) => { value.rerenderMilliseconds = 2001; }],
  ["negative proxy cold timing", (value) => { value.coldMilliseconds = -1; }],
  ["non-finite proxy cold timing", (value) => { value.coldMilliseconds = Infinity; }],
  ["wrong-type proxy cold timing", (value) => { value.coldMilliseconds = "100"; }],
  ["negative proxy rerender timing", (value) => { value.rerenderMilliseconds = -1; }],
  ["non-finite proxy rerender timing", (value) => { value.rerenderMilliseconds = NaN; }],
  ["wrong-type proxy rerender timing", (value) => { value.rerenderMilliseconds = "20"; }],
  ["non-hex proxy recipe digest", (value) => { value.firstRecipeDigest = "z".repeat(64); }],
  ["wrong-length proxy recipe digest", (value) => { value.firstRecipeDigest = "01"; }],
  ["non-hex proxy output digest", (value) => { value.firstOutputDigest = "z".repeat(64); }],
  ["wrong-length proxy output digest", (value) => { value.firstOutputDigest = "03"; }],
  ["identical proxy recipes", (value) => { value.rerenderRecipeDigest = value.firstRecipeDigest; }],
  ["identical proxy outputs", (value) => { value.rerenderOutputDigest = value.firstOutputDigest; }],
]) {
  test(`rejects ${name}`, () => {
    const value = validProxy();
    mutate(value);
    assert.throws(() => validateProxy(value, fixture.sha256));
  });
}
