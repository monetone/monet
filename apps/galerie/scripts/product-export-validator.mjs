const dimensions = {
  45: [8192, 5464],
  60: [9504, 6336],
  100: [11648, 8736],
};
const recipeDigest = "1063efef1994aaaaad6b073673457f9a07c690767c7d38cf26c7cbb747702c3c";
const iccDigests = {
  srgb: "3f5dc0dcf055bb1a0058e9511a16ab16506ae37b63267ac335d3fd136f8b4285",
  displayP3: "2b29c843f52c3459285d1092d6d6843e578647894b75049672f8abe144248d61",
};

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function requireSha256(value, message) {
  requireValue(typeof value === "string" && /^[0-9a-f]{64}$/i.test(value), message);
}

function requireMeasurement(value, message, positive = false) {
  requireValue(
    typeof value === "number" && Number.isFinite(value) && (positive ? value > 0 : value >= 0),
    message,
  );
}

function requireByteCount(value, message) {
  requireValue(typeof value === "number" && Number.isSafeInteger(value) && value > 0, message);
}

export function parseChild(result, label) {
  requireValue(result.status === 0, `${label}: child failed with status ${result.status}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label}: malformed child JSON`);
  }
}

export function validateTier({
  fixture,
  gate,
  seconds,
  peakResidentBytes,
  payload,
  sourceDigestAfter,
  actualOutputDigest,
  actualOutputBytes,
}) {
  const [width, height] = dimensions[fixture.benchmarkTier] ?? [];
  const profile = gate.profile === "display-p3" ? "displayP3" : gate.profile;
  requireValue(width && height, `${fixture.id}: unexpected benchmark tier`);
  requireMeasurement(seconds, `${fixture.id}: invalid elapsed time`);
  requireValue(seconds <= gate.seconds, `${fixture.id}: time gate failed`);
  requireMeasurement(peakResidentBytes, `${fixture.id}: invalid peak RSS`, true);
  requireValue(peakResidentBytes <= gate.rss, `${fixture.id}: RSS gate failed`);
  requireSha256(fixture.sha256, `${fixture.id}: invalid fixture digest`);
  requireSha256(sourceDigestAfter, `${fixture.id}: invalid final source digest`);
  requireValue(sourceDigestAfter === fixture.sha256, `${fixture.id}: source changed`);

  const { result, proof } = payload ?? {};
  requireValue(result?.state === "completed", `${fixture.id}: job did not complete`);
  requireValue(result.durabilityError === null, `${fixture.id}: completed job is not durable`);
  requireSha256(result.sourceDigest, `${fixture.id}: invalid source digest`);
  requireValue(result.sourceDigest === fixture.sha256, `${fixture.id}: source digest mismatch`);
  requireSha256(result.recipeDigest, `${fixture.id}: invalid recipe digest`);
  requireValue(result.recipeDigest === recipeDigest, `${fixture.id}: recipe digest mismatch`);
  requireValue(result.output?.width === width && result.output?.height === height, `${fixture.id}: bad dimensions`);
  requireValue(result.output.profile === profile, `${fixture.id}: bad profile`);
  requireValue(result.output.bitsPerSample === 16, `${fixture.id}: output is not RGB16`);
  requireValue(result.output.samplesPerPixel === 3, `${fixture.id}: output sample count mismatch`);
  requireValue(result.output.orientation === 1, `${fixture.id}: output orientation mismatch`);
  requireValue(result.output.intent === "relativeColorimetric", `${fixture.id}: output intent mismatch`);
  requireValue(result.output.blackPointCompensation === false, `${fixture.id}: output BPC mismatch`);
  requireSha256(result.output.iccDigest, `${fixture.id}: invalid output ICC digest`);
  requireValue(result.output.iccDigest === iccDigests[profile], `${fixture.id}: output ICC mismatch`);
  requireSha256(result.output.outputDigest, `${fixture.id}: invalid output digest`);
  requireSha256(actualOutputDigest, `${fixture.id}: invalid published-file digest`);
  requireValue(result.output.outputDigest === actualOutputDigest, `${fixture.id}: published-file digest mismatch`);
  requireByteCount(result.output.bytes, `${fixture.id}: invalid TIFF byte count`);
  requireByteCount(actualOutputBytes, `${fixture.id}: invalid published-file byte count`);
  requireValue(result.output.bytes === actualOutputBytes, `${fixture.id}: published-file size mismatch`);
  requireValue(proof?.width === width && proof?.height === height, `${fixture.id}: TIFF proof dimensions mismatch`);
  requireValue(proof.profile === profile, `${fixture.id}: TIFF proof profile mismatch`);
  requireValue(proof.bitsPerSample === 16 && proof.samplesPerPixel === 3, `${fixture.id}: TIFF proof depth mismatch`);
  requireValue(proof.orientation === 1, `${fixture.id}: TIFF proof orientation mismatch`);
  requireSha256(proof.iccDigest, `${fixture.id}: invalid TIFF proof ICC digest`);
  requireValue(proof.iccDigest === iccDigests[profile], `${fixture.id}: TIFF proof ICC mismatch`);
  return { tier: fixture.benchmarkTier, seconds, peakResidentBytes, ...payload };
}

export function validateProxy(proxy, expectedSourceDigest) {
  requireValue(proxy?.width === 4096 && proxy?.height === 2732, "proxy dimensions mismatch");
  requireMeasurement(proxy.coldMilliseconds, "proxy cold timing invalid");
  requireValue(proxy.coldMilliseconds <= 5000, "proxy cold gate failed");
  requireMeasurement(proxy.rerenderMilliseconds, "proxy rerender timing invalid");
  requireValue(proxy.rerenderMilliseconds <= 2000, "proxy rerender gate failed");
  requireSha256(expectedSourceDigest, "proxy expected source digest invalid");
  requireSha256(proxy.baselineSourceDigest, "proxy source digest invalid");
  requireValue(proxy.baselineSourceDigest === expectedSourceDigest, "proxy source digest mismatch");
  for (const field of [
    "firstRecipeDigest",
    "rerenderRecipeDigest",
    "firstOutputDigest",
    "rerenderOutputDigest",
  ]) {
    requireSha256(proxy[field], `proxy ${field} invalid`);
  }
  requireValue(proxy.firstRecipeDigest !== proxy.rerenderRecipeDigest, "proxy recipes are not distinct");
  requireValue(proxy.firstOutputDigest !== proxy.rerenderOutputDigest, "proxy outputs are not distinct");
  return proxy;
}

export const productProofExpectations = { dimensions, recipeDigest, iccDigests };
