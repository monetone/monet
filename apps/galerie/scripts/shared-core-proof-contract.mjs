const rebaselineKeys = new Set([
  "testedOsBuild",
  "decoderBackend",
  "backendRevision",
  "decoderVersion",
]);

export function assertPinnedManifest(actual, expected) {
  for (const key of Object.keys(expected)) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
      const prefix = rebaselineKeys.has(key) ? "rebaseline required: " : "";
      throw new Error(`${prefix}${key} ${JSON.stringify(actual[key])} != ${JSON.stringify(expected[key])}`);
    }
  }
}

export function differenceStats(actual, expected) {
  if (actual.length !== expected.length) throw new Error("native/WASM sample lengths differ");
  const differences = new Uint16Array(actual.length);
  let maxDifference = 0;
  let samplesOverOne = 0;
  for (let i = 0; i < actual.length; i++) {
    const difference = Math.abs(actual[i] - expected[i]);
    differences[i] = difference;
    maxDifference = Math.max(maxDifference, difference);
    if (difference > 1) samplesOverOne++;
  }
  differences.sort();
  return {
    maxDifference,
    samplesOverOne,
    p99Difference: differences[Math.ceil(differences.length * 0.99) - 1],
  };
}
